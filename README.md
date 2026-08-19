# ecm_translate

API trung gian (Cloudflare Worker, TypeScript) nhận webhook từ **Zalo Bot**, dịch nội dung tin nhắn qua **Gemini API** (gọi trực tiếp, không qua proxy), rồi gửi kết quả trả lời lại người dùng qua Zalo Bot API.

> Xem [MAINTENANCE.md](./MAINTENANCE.md) để biết kiến trúc đầy đủ, toàn bộ
> biến môi trường, và lịch sử sự cố (model bị Google rút, key bị chặn, Vercel
> IP bị chặn, migrate sang Cloudflare Workers). README này chỉ là hướng dẫn
> cài đặt nhanh.

## Luồng hoạt động

1. Người dùng nhắn tin cho Zalo Bot.
2. Zalo gọi `POST /api/webhook` (đã đăng ký qua `setWebhook`), kèm header `X-Bot-Api-Secret-Token`.
3. Worker xác thực secret token, đọc `message`.
4. Nếu là lệnh (`/start`, `/help`, `/setlang`, `/pair`, `/status`) thì xử lý lệnh.
5. Nếu là tin nhắn thường: lấy ngôn ngữ đích đã lưu cho user (Upstash Redis, mặc định `en`) hoặc cấu hình `/pair` của chat nếu có, gọi Gemini để dịch, gửi lại kết quả qua `sendMessage`.

## Cấu trúc project

```
src/index.ts           Entry point Worker — routing /api/webhook, /api/status
src/webhook.ts          Xử lý webhook chính (lệnh, dịch, dedupe, log)
src/status.ts           Trang debug /api/status
src/env.ts              Kiểu Env (bindings/secrets)
src/lib/gemini.ts        Gọi Gemini API trực tiếp, multi-key/multi-model fallback
src/lib/zalo.ts          Client gọi Zalo Bot API
src/lib/userLang.ts      Ngôn ngữ đích theo user (Upstash Redis)
src/lib/chatPair.ts      Cấu hình /pair (dịch 2 chiều) theo chat
src/lib/dedupe.ts        Chống xử lý trùng webhook
src/lib/webhookLog.ts    Log webhook gần đây (hiển thị ở /api/status)
src/lib/redis.ts         Helper dùng chung cho các lib trên
src/lib/languages.ts     Danh sách ngôn ngữ hỗ trợ
src/lib/types.ts         Kiểu dữ liệu webhook/API Zalo
scripts/                Script tiện ích chạy bằng Node thật: set-webhook, delete-webhook, webhook-info
wrangler.toml           Cấu hình Cloudflare Worker
```

## Cài đặt

> **Không chạy `npm install`/`wrangler` trong thư mục Google Drive/OneDrive
> đồng bộ dạng ổ ảo** (vd `G:\My Drive\...`) — driver ổ ảo làm hỏng thao tác
> file của npm (đã gặp lỗi thật khi setup). Nếu code đang nằm trong thư mục
> Drive sync, hãy copy ra ổ đĩa thật để chạy `npm install`/build/deploy, chỉ
> dùng thư mục Drive để lưu source & git.

```bash
npm install
```

Tạo file `.env` từ `.env.example` và điền (dùng cho `scripts/*.ts` chạy local — Worker thật đọc secrets từ Cloudflare, xem bên dưới):

| Biến | Mô tả |
| --- | --- |
| `ZALO_BOT_TOKEN` | Token bot lấy từ Zalo Bot Creator |
| `ZALO_WEBHOOK_SECRET_TOKEN` | Chuỗi bí mật tự chọn (8-256 ký tự), dùng để xác thực request Zalo gửi tới webhook |
| `GEMINI_API_KEY` | API key lấy từ Google AI Studio |
| `GEMINI_MODEL` / `GEMINI_FALLBACK_MODELS` | Model chính + danh sách dự phòng |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | REST URL/token của Upstash Redis database |
| `PUBLIC_WEBHOOK_URL` | URL webhook sau khi deploy, chỉ dùng cho script `set-webhook` |

## Deploy lên Cloudflare Workers

Cách chuẩn (máy không nằm trong thư mục Drive sync):

```bash
npx wrangler login          # 1 lần, mở browser xác thực
npx wrangler secret put ZALO_BOT_TOKEN
npx wrangler secret put ZALO_WEBHOOK_SECRET_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put KV_REST_API_URL
npx wrangler secret put KV_REST_API_TOKEN
npm run deploy               # wrangler deploy
```

`GEMINI_MODEL`/`GEMINI_FALLBACK_MODELS` đã có giá trị mặc định trong `wrangler.toml` (`[vars]`), không bắt buộc phải set riêng.

Endpoint webhook mặc định sẽ có dạng `https://<worker-name>.<subdomain>.workers.dev/api/webhook`.

> **Bắt buộc dùng custom domain, không dùng `*.workers.dev` cho Zalo
> webhook.** Zalo bị Cloudflare **Browser Integrity Check** chặn client
> Java của họ ở tầng edge (không tới được code) — setting này chỉ chỉnh
> được trên zone/domain riêng, không chỉnh được trên domain dùng chung
> `*.workers.dev`. Thêm custom domain: Cloudflare Dashboard → domain của
> bạn → Workers Routes/Custom Domains → trỏ về Worker `ecm-translate`, rồi
> tắt **Security → Settings → Browser Integrity Check** cho domain đó. Chi
> tiết đầy đủ: [MAINTENANCE.md § 5.4](./MAINTENANCE.md#54-webhook-zalo-im-lặng-hoàn-toàn-trên-workersdev--nguyên-nhân-thật-cloudflare-browser-integrity-check).

Đăng ký webhook (dùng URL custom domain) với Zalo:

```bash
# .env cần có PUBLIC_WEBHOOK_URL=https://<your-custom-domain>/api/webhook
npm run set-webhook
npm run webhook-info   # kiểm tra lại
```

Nếu máy đang nằm trong thư mục Drive sync (như repo này) và `wrangler`
không cài/chạy được (lỗi tải binary esbuild), xem mục "Deploy khi
wrangler không chạy được" trong [MAINTENANCE.md](./MAINTENANCE.md) — cách
build + deploy thủ công qua Cloudflare API đã dùng để deploy lần đầu.

## Lệnh cho người dùng Zalo Bot

- `/help` hoặc `/start` — xem hướng dẫn.
- `/setlang <mã>` — đặt ngôn ngữ đích cá nhân, ví dụ `/setlang en`.
- `/pair <mã1> <mã2>` — bật dịch 2 chiều cho cả chat (ưu tiên hơn `/setlang`), dùng được cả nhóm lẫn chat riêng. Trong nhóm cần @mention bot hoặc reply tin bot.
- `/status` — xem cấu hình hiện tại của chat/user.
- `/admin` — (ẩn, chỉ user trong `ADMIN_USER_IDS`) xem chỉ số hệ thống: Zalo/Gemini/Redis OK hay LỖI + thời gian phản hồi, thống kê 30 webhook gần nhất, lỗi gần nhất nếu có. Cùng dữ liệu với `/api/status` nhưng gọn hơn, xem ngay trong chat.
- Tin nhắn thường khác sẽ được dịch tự động theo cấu hình trên.

Danh sách mã ngôn ngữ hỗ trợ: `src/lib/languages.ts`.

## Scripts

- `npm run typecheck` — typecheck cả Worker (`tsconfig.json`) lẫn scripts Node (`tsconfig.scripts.json`).
- `npm run dev` — `wrangler dev` (chạy Worker local).
- `npm run deploy` — `wrangler deploy`.
- `npm run set-webhook` / `npm run delete-webhook` / `npm run webhook-info` — quản lý webhook Zalo Bot.
- Trang debug: `https://<worker-url>/api/status?token=<ZALO_WEBHOOK_SECRET_TOKEN>`.
