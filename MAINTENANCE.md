# MAINTENANCE.md — ghi chú vận hành / sửa lỗi

Tài liệu này ghi lại kiến trúc thật của hệ thống, toàn bộ biến môi trường, và
lịch sử sự cố + cách xử lý — để lần sau đọc lại code hoặc debug sự cố mới
không phải dò lại từ đầu. Cập nhật file này mỗi khi có thay đổi kiến trúc
hoặc phát hiện thêm một "bẫy" mới của hệ thống.

Cập nhật lần cuối: 2026-08-19 (migrate từ Vercel sang Cloudflare Workers).

## 1. Tổng quan hệ thống

- **Chức năng**: middleware nhận webhook từ Zalo Bot, dịch tin nhắn qua Gemini
  API, gửi kết quả lại qua Zalo Bot API.
- **GitHub**: `github.com/lhthuan/ecm_translate`, nhánh `main`.
- **Hosting**: **Cloudflare Workers** (từ 2026-08-19; trước đó là Vercel — xem
  mục 5 vì sao đổi). Account Cloudflare: `36de4119b7e5ccbc132e847e833d5193`
  ("Lamhieuthuan@gmail.com's Account"). Script name: `ecm-translate`.
  Subdomain: `lamhieuthuan.workers.dev` → URL production
  `https://ecm-translate.lamhieuthuan.workers.dev`.
- **Zalo webhook đang trỏ về**: `https://ecm-translate.lamhieuthuan.workers.dev/api/webhook`
  (đổi bằng `setWebhook` ngày 2026-08-19; trước đó trỏ về Vercel).

## 2. Cấu trúc project (thật, khớp code hiện tại)

```
src/index.ts            Entry point Worker. Routing theo pathname:
                         /api/webhook, /api/status. Cũng patch global
                         fetch() để bỏ field "cache" — xem mục 5.3.
src/webhook.ts           Webhook chính. Lệnh: /start, /help,
                         /pair <mã1> <mã2>, /setlang <mã>, /status. Hỗ trợ
                         nhóm (bóc @mention bot), dedupe theo message_id,
                         ghi log mỗi webhook.
src/status.ts             Trang debug: GET /api/status?token=<ZALO_WEBHOOK_SECRET_TOKEN>
                         — ping Zalo/Gemini/Redis + xem 30 webhook log gần
                         nhất. Dùng cái này đầu tiên khi nghi bot bị lỗi,
                         KHÔNG cần nhắn tin Zalo thật để test.
src/env.ts               Kiểu `Env` — danh sách bindings/secrets Worker đọc.
src/lib/gemini.ts         Gọi Gemini **trực tiếp** (fetch thẳng tới
                         generativelanguage.googleapis.com, không qua SDK,
                         không qua proxy nào — xem mục 5). Multi-key +
                         multi-model fallback chain, phân loại lỗi
                         transient/model-not-found vẫn giữ nguyên logic cũ.
src/lib/zalo.ts           Client gọi Zalo Bot API (fetch thuần, không dùng
                         axios nữa). Các hàm nhận `token` làm tham số đầu
                         thay vì đọc `process.env` (Workers không có
                         process.env mặc định).
src/lib/chatPair.ts       Lưu cấu hình /pair (dịch 2 chiều) theo chat_id.
src/lib/dedupe.ts         Đánh dấu message_id đã xử lý, tránh dịch/gửi trùng.
src/lib/webhookLog.ts     Ghi/đọc log webhook gần đây (hiển thị ở status.ts).
src/lib/userLang.ts       Ngôn ngữ đích theo user + pingRedis().
src/lib/redis.ts          Helper `redisClient(config)` dùng chung bởi 4 lib
                         Redis ở trên (trước đây mỗi file tự lặp lại).
src/lib/languages.ts      Danh sách ngôn ngữ hỗ trợ.
src/lib/types.ts          Kiểu dữ liệu webhook/API Zalo.
scripts/                 set-webhook.ts, delete-webhook.ts, webhook-info.ts
                         — chạy bằng Node thật (`tsx`) qua `.env` local,
                         import từ `src/lib/zalo.ts`.
wrangler.toml             Cấu hình Worker (name, compatibility flags,
                         GEMINI_MODEL/GEMINI_FALLBACK_MODELS mặc định).
tsconfig.json             Cho `src/` (Workers runtime, types
                         `@cloudflare/workers-types`).
tsconfig.scripts.json     Cho `scripts/` + `src/lib/` khi chạy bằng Node
                         thật (types `node`).
tsconfig.build.json       Emit thật (không noEmit) dùng khi build thủ công
                         — xem mục 5.2.
```

Toàn bộ code cũ kiểu Vercel (`api/*.ts`, `lib/*.ts` ở root, `vercel.json`)
đã bị xoá ngày 2026-08-19 khi migrate. Nếu thấy nhắc tới các file đó ở
lịch sử git/mục 4 bên dưới — đó là kiến trúc **cũ, đã ngừng dùng**, chỉ giữ
lại để hiểu bối cảnh sự cố.

## 3. Biến môi trường / secrets (Cloudflare Worker)

Set bằng `npx wrangler secret put <NAME>` (cần `wrangler login` trước) hoặc
qua Cloudflare Dashboard → Workers & Pages → `ecm-translate` → Settings →
Variables and Secrets. Đã set thủ công qua Cloudflare API ngày 2026-08-19
(xem mục 5.2) vì `wrangler` không cài được trên máy dev lúc đó.

| Biến | Loại | Ghi chú |
| --- | --- | --- |
| `ZALO_BOT_TOKEN` | Secret | Token từ Zalo Bot Creator |
| `ZALO_WEBHOOK_SECRET_TOKEN` | Secret | Xác thực header `X-Bot-Api-Secret-Token`; cũng dùng làm `?token=` cho `/api/status` |
| `GEMINI_API_KEY` | Secret | Key từ aistudio.google.com. `GEMINI_API_KEYS` (số nhiều, phân cách dấu phẩy, ưu tiên hơn) cũng được hỗ trợ trong code nếu cần nhiều key nhưng chưa set |
| `GEMINI_MODEL` | Var (`wrangler.toml`) | Mặc định `gemini-3.5-flash` |
| `GEMINI_FALLBACK_MODELS` | Var (`wrangler.toml`) | Mặc định `gemini-3.6-flash,gemini-3.1-flash-lite` |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Secret | REST URL/token của Upstash Redis database (lấy từ Upstash console hoặc — lúc migrate — copy lại từ Vercel dashboard vì `.env` local không có giá trị thật) |
| `PUBLIC_WEBHOOK_URL` | Chỉ `.env` local | Dùng bởi `npm run set-webhook`, không phải Worker secret |

**Đổi secret/var xong phải deploy lại** thì Worker mới dùng giá trị mới
(giống Vercel — bindings được "chốt" vào từng deployment).

## 4. [LỊCH SỬ — đã xử lý xong bằng cách migrate, mục 5] Vụ "Xin lỗi, hệ thống dịch đang gặp sự cố tạm thời" (2026-08-11 → 08-19, trên Vercel)

> Toàn bộ mục này mô tả kiến trúc **Vercel cũ, đã ngừng dùng** từ
> 2026-08-19. Giữ lại vì lý do migrate (mục 5) chính là hệ quả trực tiếp của
> chuỗi sự cố này, và logic phân loại lỗi (transient/model-not-found) viết
> ra ở đây vẫn còn nguyên trong `src/lib/gemini.ts` hiện tại.

Sự cố có **3 nguyên nhân xếp chồng lên nhau**, sửa từng lớp mới lộ ra lớp
sau.

### 4.1. Model bị Google rút sớm

`gemini-2.5-flash` bắt đầu trả 404 `"no longer available to new users"` cho
key/project mới (dù `models.list` vẫn liệt kê nó là "Stable" — chỉ
`generateContent` mới chặn). Code đã có sẵn cơ chế fallback nhiều model
nhưng có bug: **bất kỳ lỗi non-transient nào (kể cả 404 này) đều làm dừng
toàn bộ chuỗi fallback ngay lập tức** thay vì thử model kế tiếp.

Đã sửa: thêm `isModelUnavailableError()` (bắt 404/NOT_FOUND/"no longer
available"), coi nó như lỗi transient cho mục đích fallback — chuyển sang
model/key kế tiếp thay vì throw ngay. **Logic này vẫn còn trong
`src/lib/gemini.ts` hiện tại.**

### 4.2. API key bị chặn ở cấp Google Cloud project

Key cũ (chủ tài khoản Google `dvrslara@gmail.com`) trả `403
PERMISSION_DENIED: "Your project has been denied access. Please contact
support."` cho **mọi** model. Chặn ở cấp project/account, không phải model.
Test bằng cách gọi `models.list` trực tiếp — nếu 200 OK thì key hợp lệ,
vấn đề nằm ở `generateContent`/billing/policy chứ không phải key sai định
dạng.

Đã xử lý: tạo key mới từ project Google Cloud sạch, tài khoản
`lamhieuthuan@gmail.com` — **key này vẫn đang dùng** (là `GEMINI_API_KEY`
hiện tại trên Cloudflare).

### 4.3. Google chặn theo dải IP egress của Vercel

Ngay cả **key mới, hoàn toàn hợp lệ** vẫn bị 403 y hệt — nhưng **chỉ khi
gọi từ chính hạ tầng Vercel**. Bằng chứng lúc đó:

- Gọi trực tiếp bằng `curl` (từ mạng khác) với đúng key + đúng model →
  200 OK, có kết quả.
- Gọi qua Vercel function → 403, lặp lại y hệt qua nhiều lần test.
- Đổi function region `iad1` → `sin1` → vẫn 403 y hệt (loại trừ khả năng
  chặn riêng 1 region — tức là chặn cả dải IP Vercel nói chung, không phải
  1 vùng cụ thể).

Khớp với báo cáo trên forum Google AI Developers về hệ thống chống-lạm-dụng
gắn cờ nhầm project/key mới gọi từ IP hosting/cloud dùng chung:
[thread 1](https://discuss.ai.google.dev/t/403-permission-denied-project-denied-access-for-gemini-developer-api/177820),
[thread 2](https://discuss.ai.google.dev/t/403-permission-denied-your-project-has-been-denied-access-on-workspace-owned-project-gen-lang-client-01776000/147150),
[thread 3](https://discuss.ai.google.dev/t/403-permission-denied-on-new-gemini-api-projects-and-keys/140734).

**Workaround tạm thời lúc đó (đã gỡ bỏ)**: proxy qua Google Apps Script Web
App (chạy trên hạ tầng Google nên không bị chặn IP). Có 2 sự cố phát sinh
từ chính proxy này trước khi bị thay hẳn:

- Apps Script thỉnh thoảng trả về **HTML lỗi thay vì JSON** — code lúc đó
  gọi thẳng `res.json()`, parse lỗi không được phân loại transient nên bung
  lỗi thẳng ra người dùng thay vì fallback.
- Lời gọi proxy **không có timeout** — có lần mất tới 17.3 giây, cộng dồn
  qua nhiều lần retry/model dễ vượt `maxDuration` của Vercel function
  (30s), Vercel giết function giữa chừng → người dùng thấy **im lặng hoàn
  toàn** (không cả tin nhắn báo lỗi), sự cố không để lại log.

Cả 2 vấn đề trên **không còn liên quan** từ khi bỏ hẳn proxy (mục 5) — gọi
thẳng Gemini từ Cloudflare không cần workaround này nữa. Chỉ ghi lại phòng
khi có nhu cầu dựng lại kiểu proxy tương tự trong tương lai.

## 5. Migrate sang Cloudflare Workers (2026-08-19)

### 5.1. Vì sao migrate

Việc phải vòng qua Apps Script (mục 4.3) chậm (5-17s/lần dịch) và không ổn
định (2 sự cố kể trên). Thay vì tiếp tục vá proxy, kiểm chứng giả thuyết:
**đổi hẳn nền tảng hosting sang mạng khác** có né được chặn IP của Google
không.

**Đã test trước khi migrate toàn bộ** (đúng quy trình nên làm khi không
chắc chắn giả thuyết): deploy 1 Cloudflare Worker tối giản gọi thẳng
Gemini `generateContent` — kết quả **200 OK, không bị 403** — xác nhận
Google **không** chặn dải IP của Cloudflare (ít nhất tại thời điểm test).
Sau đó mới tiến hành viết lại toàn bộ bot.

**Kết quả sau migrate**: gọi Gemini trực tiếp từ Cloudflare mất
**~1-1.5 giây** (so với 5-17s+ qua Apps Script) — nhanh hơn hẳn, và bỏ được
toàn bộ lớp phức tạp của proxy.

Nếu tương lai Google **cũng chặn IP Cloudflare**: quay lại đọc mục 4.3 để
hiểu cách chẩn đoán (test `models.list` trước, so sánh gọi trực tiếp vs
qua Worker, thử đổi vài thứ trước khi kết luận là chặn diện rộng).

### 5.2. Deploy khi `wrangler` không chạy được (máy trong thư mục Drive sync)

Máy dev lúc migrate gặp 2 lớp vấn đề của môi trường, không phải lỗi code:

1. **`npm install` trong thư mục Google Drive sync bị lỗi** (`EPERM`,
   `ENOTEMPTY`, `EBADF` khi npm cố ghi/xoá file — driver ổ ảo của Drive
   xung đột với npm). Cách né: **copy toàn bộ `src/`, `scripts/`,
   `package*.json`, `tsconfig*.json`, `wrangler.toml` ra một thư mục trên ổ
   đĩa thật** (vd thư mục scratchpad của Claude, hoặc bất kỳ đâu ngoài
   Drive sync), `npm install` ở đó, rồi build/deploy từ đó. Sửa code thì
   vẫn sửa trong repo (Drive), chỉ *copy sang* để build.
2. **`wrangler` cài được nhưng lệnh `wrangler deploy`/`wrangler dev` không
   chạy được** vì gói `esbuild` (dependency của wrangler) tải binary native
   (`esbuild.exe`) bị lỗi khi cài (`npm install` báo lỗi `spawnSync ...
   esbuild.exe`, và file thực ra không hề tồn tại sau khi cài — tải/giải
   nén hỏng). Không rõ nguyên nhân gốc (registry glitch? sandbox chặn
   spawn file mới tải?) — cài `esbuild` **độc lập** (`npm install esbuild
   --no-save`, không qua wrangler) lại thành công bình thường, nên khả
   năng cao là vấn đề cụ thể của phiên bản esbuild mà `wrangler` khi đó
   pin theo, không phải chặn toàn diện.

**Quy trình deploy thủ công đã dùng** (khi gặp lại tình huống tương tự,
làm lại y hệt các bước này thay vì `wrangler deploy`):

```bash
# Trong thư mục build (ngoài Drive sync), đã npm install --ignore-scripts:
npx tsc -p tsconfig.build.json          # TS -> JS, giữ nguyên cấu trúc file,
                                          # import phải có đuôi .js (xem dưới)
npx esbuild dist/index.js --bundle --format=esm --platform=neutral \
  --target=es2022 --outfile=dist-bundle/worker.js
                                          # gộp @upstash/redis + mọi lib vào
                                          # 1 file duy nhất, không cần
                                          # wrangler resolve node_modules

# Upload qua Cloudflare API (thay <TOKEN>, <ACCOUNT>, cần metadata.json
# {"main_module":"worker.js","compatibility_date":"2024-09-23",
#  "compatibility_flags":["nodejs_compat"]}):
curl -X PUT -H "Authorization: Bearer <TOKEN>" \
  -F "metadata=@metadata.json;type=application/json" \
  -F "worker.js=@dist-bundle/worker.js;type=application/javascript+module" \
  "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT>/workers/scripts/ecm-translate"

# Set secrets (1 lần/khi đổi giá trị) — PUT tới .../scripts/ecm-translate/secrets
# body {"name":"...","text":"...","type":"secret_text"}

# Bật route workers.dev (1 lần, nếu chưa bật) — POST tới
# .../scripts/ecm-translate/subdomain, body {"enabled":true}
```

**Quan trọng**: mọi import tương đối trong `src/**/*.ts` đều viết **có
đuôi `.js`** (vd `import { X } from "./lib/gemini.js"`, dù file thật là
`.ts`) — đây là cú pháp TS chuẩn cho ESM (`moduleResolution: "bundler"`
trong `tsconfig.json` cho phép), và **bắt buộc** để bước `tsc -p
tsconfig.build.json` emit ra `.js` với import path đúng, `esbuild` mới
resolve được. Thiếu đuôi `.js` ở bất kỳ import nào sẽ làm bundle lỗi hoặc
thiếu module.

Nếu máy dev sau này KHÔNG còn nằm trong thư mục Drive sync và
`wrangler`/`esbuild` cài bình thường, chỉ cần `npm run deploy` (tức
`wrangler deploy`) — không cần quy trình thủ công ở trên.

### 5.3. Bug tương thích `@upstash/redis` trên Cloudflare Workers

`@upstash/redis` (kể cả bản `@upstash/redis/cloudflare` dành riêng cho
Workers) luôn set field `cache` trên `RequestInit` khi gọi `fetch()` (dù
giá trị là `undefined`) — Cloudflare Workers runtime báo lỗi **"The
'cache' field on 'RequestInitializerDict' is not implemented."** vì chưa
hỗ trợ field này, kể cả khi giá trị là `undefined` (bug ở version SDK
1.38.0 dùng lúc migrate — kiểm tra lại nếu upgrade version, có thể họ đã
fix).

Đã sửa trong `src/index.ts`: patch `globalThis.fetch` ngay đầu file, tự
động bóc field `cache` ra khỏi mọi `RequestInit` trước khi gọi fetch thật.
Áp dụng toàn cục (Gemini, Zalo, Upstash đều đi qua) nhưng an toàn vì code
của mình không tự set `cache` ở đâu cả — chỉ là lớp phòng thủ cho thư viện
ngoài.

### 5.4. Việc cần làm thêm (chưa làm ngay lúc migrate)

- **Vercel project `ecm-translate`**: có thể xoá hoặc để nguyên (không tốn
  phí thêm nếu không có traffic — Zalo đã hết trỏ webhook về đây). Nếu xoá,
  nhớ trước đó archive lại giá trị `KV_REST_API_URL`/`KV_REST_API_TOKEN`
  nếu còn dùng chung Redis database đó cho việc khác.
- **Google Apps Script proxy** (deployment ID
  `AKfycbw26-_ioH8sNTw136L2en7832FSaQZ3ER6AsMxVwFOD-kHPR1NbtcGWnzG0AnzgGh_eLg`):
  không còn được gọi tới, có thể xoá deployment trên script.google.com.
  Chứa `GEMINI_API_KEY` cũ trong Script Properties — nên xoá hẳn thay vì
  chỉ để im, tránh key bị lộ/dùng lẫn.
- **Cloudflare API Token** dùng để deploy thủ công nên **revoke** sau khi
  xác nhận mọi thứ ổn định (Settings → API Tokens trên
  dash.cloudflare.com), theo đúng thói quen revoke token tạm thời đã áp
  dụng với Vercel token trước đó.

## 6. Cách debug nhanh khi bot lại báo lỗi

1. Mở `https://ecm-translate.lamhieuthuan.workers.dev/api/status?token=<ZALO_WEBHOOK_SECRET_TOKEN>`
   — xem 3 dòng Zalo/Gemini/Redis OK hay LỖI, và bảng log webhook gần nhất
   (có nội dung tin, kết quả dịch, lỗi nếu có, raw body).
2. Nếu Gemini LỖI: đọc message trả về —
   - `429`/`503`/`quota`/`overload` → tự phục hồi, không cần làm gì.
   - `404`/`no longer available` → model bị Google rút, thêm model mới vào
     đầu `GEMINI_FALLBACK_MODELS` hoặc đổi `GEMINI_MODEL`.
   - `403 PERMISSION_DENIED` → so sánh gọi trực tiếp (`curl` từ máy khác)
     với gọi qua Worker; nếu chỉ Worker bị chặn, khả năng Google đã bắt đầu
     chặn cả IP Cloudflare (xem mục 5.1) — cần tìm hướng khác. Nếu cả 2 đều
     403 thì là vấn đề thật của key/billing.
3. Cloudflare Dashboard → Workers & Pages → `ecm-translate` → tab **Logs**
   (Real-time Logs hoặc Tail) để xem `console.log`/`console.error` chi
   tiết từ `src/webhook.ts`, `src/lib/gemini.ts`.
4. Đổi secret/var xong phải **deploy lại** mới có hiệu lực (mục 3).

## 7. Ghi chú môi trường dev (máy đang code hiện tại)

- **Repo nằm trong thư mục Google Drive sync** (`G:\My Drive\...`). Drive
  desktop client thỉnh thoảng nhét file `desktop.ini` vào **mọi thư mục**,
  kể cả bên trong `.git/refs`, `.git/objects`, `.git/logs` — làm git đọc
  nhầm ref, lỗi `fatal: bad object refs/desktop.ini`. `desktop.ini` đã được
  thêm vào `.gitignore`, nhưng nếu gặp lại lỗi git kiểu "bad object": tìm
  và xoá `find .git -iname desktop.ini -delete`, rồi `git fsck --full` để
  xác nhận repo không hỏng.
- **`npm install`/`wrangler` không chạy tin cậy được trong thư mục Drive
  sync này** — xem quy trình copy-ra-ổ-thật ở mục 5.2. Về lâu dài nên
  chuyển hẳn repo ra khỏi thư mục Drive sync (hoặc ít nhất loại trừ `.git/`
  và `node_modules/` khỏi đồng bộ) để tránh phải lặp lại quy trình vòng
  này mỗi lần cần build/deploy.
