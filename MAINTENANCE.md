# MAINTENANCE.md — ghi chú vận hành / sửa lỗi

Tài liệu này ghi lại kiến trúc thật của hệ thống, toàn bộ biến môi trường, và
lịch sử sự cố + cách xử lý — để lần sau đọc lại code hoặc debug sự cố mới
không phải dò lại từ đầu. Cập nhật file này mỗi khi có thay đổi kiến trúc
hoặc phát hiện thêm một "bẫy" mới của hệ thống.

Cập nhật lần cuối: 2026-08-13.

## 1. Tổng quan hệ thống

- **Chức năng**: middleware nhận webhook từ Zalo Bot, dịch tin nhắn qua Gemini
  API, gửi kết quả lại qua Zalo Bot API.
- **GitHub**: `github.com/lhthuan/ecm_translate`, nhánh `main`.
- **Vercel project**: `ecm-translate` (id `prj_qNH4e3Vz1BxqCIAk3zIFzDcTV0RK`,
  scope `lhthuans-projects`), domain production `ecm-translate.vercel.app`.
  Auto-deploy khi push lên `main` (GitHub integration, repoId `1289087772`).
- **Function region**: `sin1` (Singapore) — đổi từ mặc định `iad1` ngày
  2026-08-13, xem mục 4.3.

## 2. Cấu trúc project (thật, khớp code hiện tại)

```
api/webhook.ts   Webhook chính. Lệnh: /start, /help, /pair <mã1> <mã2>,
                 /setlang <mã>, /status. Hỗ trợ nhóm (bóc @mention bot),
                 dedupe theo message_id, ghi log mỗi webhook.
api/status.ts    Trang debug: GET /api/status?token=<ZALO_WEBHOOK_SECRET_TOKEN>
                 — ping Zalo/Gemini/Redis + xem 30 webhook log gần nhất.
                 Dùng cái này đầu tiên khi nghi bot bị lỗi, KHÔNG cần nhắn
                 tin Zalo thật để test.
lib/gemini.ts    Gọi Gemini: multi-key + multi-model fallback chain, phân
                 loại lỗi transient/model-not-found, và (tuỳ chọn) route
                 qua Apps Script proxy — xem mục 4.
lib/zalo.ts      Client gọi Zalo Bot API (sendMessage, sendChatAction,
                 getMe, getCachedBotInfo, setWebhook...).
lib/chatPair.ts  Lưu cấu hình /pair (dịch 2 chiều) theo chat_id (Redis).
lib/dedupe.ts    Đánh dấu message_id đã xử lý, tránh dịch/gửi trùng khi
                 Zalo retry webhook.
lib/webhookLog.ts Ghi/đọc log webhook gần đây (hiển thị ở api/status.ts).
lib/userLang.ts  Lưu ngôn ngữ đích theo user (Redis) + pingRedis().
lib/languages.ts Danh sách ngôn ngữ hỗ trợ.
lib/types.ts     Kiểu dữ liệu webhook/API Zalo.
scripts/         set-webhook.ts, delete-webhook.ts, webhook-info.ts.
vercel.json      maxDuration cho api/webhook.ts.
```

> `README.md` mô tả một phiên bản cũ/đơn giản hơn (thiếu `/pair`, `/status`,
> proxy...) — bảng trên trong `MAINTENANCE.md` là bản khớp thực tế.

## 3. Biến môi trường (Vercel → Settings → Environment Variables)

| Biến | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `ZALO_BOT_TOKEN` | Có | Token từ Zalo Bot Creator |
| `ZALO_WEBHOOK_SECRET_TOKEN` | Có | Xác thực header `X-Bot-Api-Secret-Token`; cũng dùng làm `?token=` cho `/api/status` |
| `GEMINI_API_KEY` | Có (trừ khi dùng `GEMINI_API_KEYS`) | Key từ aistudio.google.com |
| `GEMINI_API_KEYS` | Không | Nhiều key, phân cách bởi dấu phẩy, thử lần lượt. **Ưu tiên hơn `GEMINI_API_KEY`** nếu cả 2 cùng có giá trị — kiểm tra biến này rỗng trước khi nghi `GEMINI_API_KEY` không có tác dụng |
| `GEMINI_MODEL` | Không | Model chính, mặc định `gemini-3.5-flash` nếu bỏ trống |
| `GEMINI_FALLBACK_MODELS` | Không | Danh sách model dự phòng, phân cách dấu phẩy. Mặc định `gemini-3.6-flash,gemini-3.1-flash-lite` |
| `GEMINI_PROXY_URL` | Không (đang bật) | Xem mục 4. Khi có giá trị, mọi lời gọi `generateContent` đi qua Apps Script relay thay vì gọi Google trực tiếp |
| `GEMINI_PROXY_SECRET` | Đi kèm `GEMINI_PROXY_URL` | Secret để relay xác thực request từ Vercel |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Có | Tự set khi gắn Upstash Redis integration. Có thể thay bằng `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` |
| `PUBLIC_WEBHOOK_URL` | Chỉ cho local | Dùng bởi `npm run set-webhook` |

Mỗi biến có 3 target riêng trên Vercel: **Production / Preview /
Development** — sửa nhầm target là nguyên nhân phổ biến khiến "tôi đổi rồi
mà vẫn lỗi y hệt". Luôn kiểm tra đang sửa đúng **Production**.

**Đổi env var không tự redeploy.** Vercel bake env var vào lúc build; phải
tạo deployment mới (Dashboard bấm Redeploy, hoặc API `POST
/v13/deployments` với `gitSource.sha` = commit hiện tại) thì giá trị mới
mới có hiệu lực.

## 4. Vụ "Xin lỗi, hệ thống dịch đang gặp sự cố tạm thời" (2026-08-11 → 08-13)

Sự cố có **3 nguyên nhân xếp chồng lên nhau**, sửa từng lớp mới lộ ra lớp
sau. Ghi lại đầy đủ vì rất dễ tái diễn một phần trong tương lai.

### 4.1. Model bị Google rút sớm

`gemini-2.5-flash` bắt đầu trả 404 `"no longer available to new users"` cho
key/project mới (dù `models.list` vẫn liệt kê nó là "Stable" — chỉ
`generateContent` mới chặn). Code đã có sẵn cơ chế fallback nhiều model
nhưng có bug: **bất kỳ lỗi non-transient nào (kể cả 404 này) đều làm dừng
toàn bộ chuỗi fallback ngay lập tức** thay vì thử model kế tiếp.

Đã sửa trong `lib/gemini.ts`: thêm `isModelUnavailableError()` (bắt
404/NOT_FOUND/"no longer available"), coi nó như lỗi transient cho mục
đích fallback — chuyển sang model/key kế tiếp thay vì throw ngay.

### 4.2. API key bị chặn ở cấp Google Cloud project

Key cũ (chủ tài khoản Google `dvrslara@gmail.com`, ghi chú lịch sử — nay đã
thay) trả `403 PERMISSION_DENIED: "Your project has been denied access.
Please contact support."` cho **mọi** model, kể cả model còn hoạt động.
Đây là chặn ở cấp project/account, không phải model. Test bằng cách gọi
`models.list` trực tiếp — nếu 200 OK thì key hợp lệ, vấn đề nằm ở
`generateContent`/billing/policy chứ không phải key sai định dạng.

Đã xử lý: tạo key mới từ project Google Cloud sạch, tài khoản
`lamhieuthuan@gmail.com`.

### 4.3. Google chặn theo dải IP egress của Vercel (đang dùng workaround)

Ngay cả **key mới, hoàn toàn hợp lệ** vẫn bị 403 y hệt — nhưng **chỉ khi
gọi từ chính hạ tầng Vercel**. Bằng chứng:

- Gọi trực tiếp bằng `curl` (từ mạng khác) với đúng key + đúng model →
  200 OK, có kết quả.
- Gọi qua Vercel function → 403, lặp lại y hệt qua nhiều lần test.
- Đổi function region `iad1` → `sin1` → vẫn 403 y hệt (loại trừ khả năng
  chặn riêng 1 region).

Đây khớp với các báo cáo trên forum chính thức của Google AI Developers về
hệ thống chống-lạm-dụng gắn cờ nhầm project/key mới, đặc biệt khi gọi từ
dải IP hosting/cloud dùng chung — xem
[thread 1](https://discuss.ai.google.dev/t/403-permission-denied-project-denied-access-for-gemini-developer-api/177820),
[thread 2](https://discuss.ai.google.dev/t/403-permission-denied-your-project-has-been-denied-access-on-workspace-owned-project-gen-lang-client-01776000/147150),
[thread 3](https://discuss.ai.google.dev/t/403-permission-denied-on-new-gemini-api-projects-and-keys/140734).

**Workaround đang chạy: Google Apps Script làm proxy.**

Vì Apps Script chạy trên hạ tầng của chính Google, request gọi Gemini từ đó
không dính chặn IP. Luồng hiện tại:

```
Vercel (lib/gemini.ts) --POST {secret, model, contents}--> Apps Script Web App
Apps Script -- x-goog-api-key --> generativelanguage.googleapis.com
Apps Script <-- JSON response (nguyên văn, cả lỗi lẫn thành công) --
Vercel <-- JSON --
```

- Code: `callGenerateContent()` trong `lib/gemini.ts`. Nếu
  `GEMINI_PROXY_URL` rỗng → gọi thẳng SDK `@google/genai` như bình thường
  (không có gì thay đổi). Nếu có giá trị → `fetch()` tới Apps Script thay
  vì gọi Google trực tiếp.
- Key Gemini **thật** nằm trong **Apps Script Script Properties**
  (`GEMINI_API_KEY`, `PROXY_SECRET`), **không phải** biến `GEMINI_API_KEY`
  trên Vercel. Biến đó trên Vercel giờ chỉ dùng để `getApiKeys()` trả về
  mảng không rỗng (điều kiện vòng lặp key), giá trị thật của nó bị bỏ qua
  khi proxy đang bật.
- Script nguồn: `scripts note` — file gốc từng gửi cho người dùng dán vào
  script.google.com, không lưu trong repo (Apps Script không phải Node/TS
  project, không build/deploy qua Vercel). **Nếu cần sửa proxy, xem lại nội
  dung hàm `doPost`/`jsonOutput` mô tả ở trên, viết lại thủ công trên
  script.google.com.**

**Bẫy khi sửa/deploy lại Apps Script** (đã dính khi setup lần đầu):

1. Sửa code trong editor **không tự áp dụng vào deployment đang chạy**.
   Deployment "đóng băng" ở version lúc bấm Deploy. Phải vào **Deploy →
   Manage deployments → (bút chì) Edit → Version: chọn "New version" →
   Deploy** thì thay đổi code mới có hiệu lực trên cùng 1 URL/deployment ID.
2. Bấm **"New deployment"** (thay vì Edit deployment cũ) sẽ ra **URL khác**
   — phải cập nhật lại `GEMINI_PROXY_URL` trên Vercel nếu việc này xảy ra.
3. "Who has access" phải là **Anyone** (không phải "Only myself"/"Anyone
   with Google account"), nếu không request sẽ bị redirect tới trang đăng
   nhập Google (HTML, không phải JSON).
4. Test bằng `curl` thủ công: POST tới URL `/exec` trả về **302 redirect**
   tới `script.googleusercontent.com/macros/echo?...` — phải **GET** theo
   redirect đó (không resend POST) mới lấy được JSON thật.
   `fetch()` chuẩn của Node.js/trình duyệt tự làm đúng việc này (spec bắt
   chuyển POST→GET khi follow redirect 302), nên code trong `lib/gemini.ts`
   không cần xử lý gì thêm — chỉ là gotcha khi debug bằng `curl -L`
   (dùng `-L` mặc định là đủ, **đừng** thêm `--post302`).

**Giới hạn cần nhớ**: Apps Script free (tài khoản Gmail cá nhân) có quota
~20.000 lượt gọi UrlFetch/ngày — dư dùng ở quy mô hiện tại, nhưng là điểm
nghẽn nếu lượng tin nhắn tăng mạnh sau này.

**Cập nhật 2026-08-19 — Apps Script thỉnh thoảng trả HTML thay vì JSON.**
Log webhook cho thấy 1 request bị lỗi `Unexpected token '<', "<!DOCTYPE
"... is not valid JSON` — Apps Script trả về trang HTML lỗi/interstitial
thay vì JSON (các request ngay trước/sau đó đều thành công bình thường,
nên đây là chập chờn nền tảng, không phải lỗi cấu hình). Bug ở chỗ:
`callGenerateContent()` lúc đó gọi thẳng `res.json()`, parse lỗi thì crash
với message không khớp `isTransientError()` → **không được retry, không
fallback sang model khác** → bung thẳng ra ngoài. Đã sửa: đọc response
bằng `res.text()` trước, nếu `JSON.parse` lỗi thì throw error có chứa từ
khoá `UNAVAILABLE` để nó được coi là lỗi tạm thời (tự retry + fallback)
thay vì báo lỗi ngay cho người dùng.

**Cập nhật 2026-08-19 (2) — "im ru", không có phản hồi gì (nặng hơn báo
lỗi).** Người dùng báo có lúc nhắn bot mà hoàn toàn im lặng — không phải
báo lỗi, mà **không gì cả**. Test trực tiếp `pingGemini()` lúc đó mất
**17.3 giây** cho 1 lần gọi (Apps Script cold start/chậm) rồi mới fail.
Nguyên nhân: lời gọi `fetch()` tới proxy **không có timeout**, và
`withRetry` mặc định thử tối đa 3 lần/model × nhiều model trong
`GEMINI_FALLBACK_MODELS` — nếu mỗi lần đều chậm, tổng thời gian dễ vượt
`maxDuration` của Vercel function (`vercel.json`, lúc đó là 30s). Khi
Vercel giết function giữa chừng vì timeout, code **không kịp chạy tới cả
khối `catch` gửi tin nhắn lỗi lẫn `logWebhookEvent`** → người dùng thấy im
lặng hoàn toàn, và sự cố đó **không để lại dấu vết gì trong log** ở
`/api/status` (khác với các lỗi khác luôn có dòng log LỖI).

Đã sửa trong `lib/gemini.ts`:
- Thêm `signal: AbortSignal.timeout(6000)` cho `fetch()` gọi proxy — chặn
  đứng ở 6s thay vì treo vô thời hạn, lỗi timeout được phân loại là
  transient (chứa `UNAVAILABLE`) để tự fallback thay vì treo cả function.
- Giảm `withRetry` từ mặc định 2 (3 lần thử) xuống `retries=1` (2 lần thử)
  tại nơi gọi trong `generateWithModelFallback()`.
- Tăng `maxDuration` trong `vercel.json` từ 30 lên 60 giây làm lớp đệm an
  toàn thêm.
- Ngân sách thời gian tệ nhất sau khi sửa: ~12.5s/model (2 lần thử × 6s +
  0.5s backoff) × 2 model trong `DEFAULT_FALLBACK_MODELS` ≈ 25s — nằm
  trong giới hạn 60s mới, đủ dư để luôn kịp gửi tin nhắn báo lỗi nếu vẫn
  fail hoàn toàn.

**Nếu "im ru" lại xảy ra**: kiểm tra dòng "Gemini API" ở `/api/status` —
nếu nó mất >15-20s để trả lời (cột "Thời gian"), đó là dấu hiệu Apps
Script đang chậm bất thường, cân nhắc giảm số model trong
`GEMINI_FALLBACK_MODELS` hoặc tăng thêm `maxDuration` (nếu gói Vercel cho
phép).

**Nếu Google gỡ chặn IP Vercel trong tương lai**: chỉ cần xoá
`GEMINI_PROXY_URL` khỏi Vercel env vars rồi redeploy — code tự quay lại gọi
SDK trực tiếp, không cần sửa gì khác.

## 5. Cách debug nhanh khi bot lại báo lỗi

1. Mở `https://ecm-translate.vercel.app/api/status?token=<ZALO_WEBHOOK_SECRET_TOKEN>`
   — xem 3 dòng Zalo/Gemini/Redis OK hay LỖI, và bảng log webhook gần nhất
   (có nội dung tin, kết quả dịch, lỗi nếu có, raw body).
2. Nếu Gemini LỖI: đọc message trả về —
   - `429`/`503`/`quota`/`overload` → tự phục hồi, không cần làm gì.
   - `404`/`no longer available` → model bị Google rút, thêm model mới vào
     đầu `GEMINI_FALLBACK_MODELS` hoặc đổi `GEMINI_MODEL`.
   - `403 PERMISSION_DENIED` → kiểm tra lại xem có phải quay lại vụ IP-block
     mục 4.3 không (test bằng `curl` trực tiếp ngoài Vercel để so sánh), hoặc
     key/billing có vấn đề thật.
3. Vercel Dashboard → project `ecm-translate` → tab **Logs** — xem log chi
   tiết (`console.log`/`console.error` trong `api/webhook.ts`, `lib/gemini.ts`).
4. Nhớ: sửa env var xong phải **redeploy** mới có hiệu lực (mục 3).

## 6. Ghi chú môi trường dev (máy đang code hiện tại)

- **Repo nằm trong thư mục Google Drive sync** (`G:\My Drive\...`). Drive
  desktop client thỉnh thoảng nhét file `desktop.ini` vào **mọi thư mục**,
  kể cả bên trong `.git/refs`, `.git/objects`, `.git/logs` — làm git đọc
  nhầm ref, lỗi `fatal: bad object refs/desktop.ini`. `desktop.ini` đã được
  thêm vào `.gitignore`, nhưng nếu gặp lại lỗi git kiểu "bad object": tìm
  và xoá `find .git -iname desktop.ini -delete`, rồi `git fsck --full` để
  xác nhận repo không hỏng. Về lâu dài nên chuyển repo ra khỏi thư mục Drive
  sync (hoặc loại trừ `.git/` khỏi đồng bộ).
- `node_modules/` chưa được cài trong môi trường dev hiện tại —
  `npm install` trước khi chạy `npm run build` (typecheck).
