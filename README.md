# ecm_translate

API trung gian (Node.js/TypeScript, deploy trên Vercel) nhận webhook từ **Zalo Bot**, dịch nội dung tin nhắn qua **Gemini API**, rồi gửi kết quả trả lời lại người dùng qua Zalo Bot API.

## Luồng hoạt động

1. Người dùng nhắn tin cho Zalo Bot.
2. Zalo gọi `POST /api/webhook` (đã đăng ký qua `setWebhook`), kèm header `X-Bot-Api-Secret-Token`.
3. Server xác thực secret token, đọc `result.message`.
4. Nếu là lệnh (`/start`, `/help`, `/setlang <mã>`) thì xử lý lệnh.
5. Nếu là tin nhắn thường: lấy ngôn ngữ đích đã lưu cho user (Upstash Redis, mặc định `en`), gọi Gemini để dịch, gửi lại kết quả qua `sendMessage`.

## Cấu trúc project

```
api/webhook.ts        Vercel serverless function - endpoint webhook chính
lib/zalo.ts            Client gọi Zalo Bot API (sendMessage, setWebhook, ...)
lib/gemini.ts           Gọi Gemini API để dịch văn bản
lib/userLang.ts         Lưu/đọc ngôn ngữ đích theo user (Upstash Redis)
lib/languages.ts        Danh sách ngôn ngữ hỗ trợ
lib/types.ts            Kiểu dữ liệu webhook/API response của Zalo Bot
scripts/                Script tiện ích: set-webhook, delete-webhook, webhook-info
```

## Cài đặt

> Lưu ý: không chạy `npm install` trong thư mục được Google Drive/OneDrive đồng bộ dạng ổ ảo (vd `G:\My Drive\...`) — các driver ổ ảo này chặn thao tác file của npm và làm hỏng `node_modules`. Hãy code trong một thư mục ổ đĩa thật, dùng Git/GitHub để backup và chia sẻ.

```bash
npm install
```

Tạo file `.env` từ `.env.example` và điền:

| Biến | Mô tả |
| --- | --- |
| `ZALO_BOT_TOKEN` | Token bot lấy từ Zalo Bot Creator |
| `ZALO_WEBHOOK_SECRET_TOKEN` | Chuỗi bí mật tự chọn (8-256 ký tự), dùng để xác thực request Zalo gửi tới webhook |
| `GEMINI_API_KEY` | API key lấy từ Google AI Studio |
| `GEMINI_MODEL` | Mặc định `gemini-2.5-flash` |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Lấy tự động khi gắn Redis integration (Upstash) từ Vercel Marketplace |
| `PUBLIC_WEBHOOK_URL` | URL webhook sau khi deploy, chỉ dùng cho script `set-webhook` |

## Deploy lên Vercel

1. Push code lên GitHub, import repo vào Vercel.
2. Vào **Storage → Marketplace → Redis** để gắn Upstash Redis cho project (tự set `KV_REST_API_URL`/`KV_REST_API_TOKEN`).
3. Khai báo các biến môi trường còn lại (`ZALO_BOT_TOKEN`, `ZALO_WEBHOOK_SECRET_TOKEN`, `GEMINI_API_KEY`, `GEMINI_MODEL`) trong Project Settings → Environment Variables.
4. Deploy. Endpoint webhook sẽ có dạng `https://<project>.vercel.app/api/webhook`.
5. Đăng ký webhook với Zalo (một lần, chạy local):

```bash
# .env cần có PUBLIC_WEBHOOK_URL=https://<project>.vercel.app/api/webhook
npm run set-webhook
npm run webhook-info   # kiểm tra lại
```

## Lệnh cho người dùng Zalo Bot

- `/help` hoặc `/start` — xem hướng dẫn.
- `/setlang <mã>` — đặt ngôn ngữ đích, ví dụ `/setlang en`. Xem danh sách mã hỗ trợ trong `lib/languages.ts`.
- Bất kỳ tin nhắn văn bản nào khác sẽ được dịch sang ngôn ngữ đích đã đặt (mặc định `en` nếu chưa đặt).

## Scripts

- `npm run build` — typecheck bằng `tsc --noEmit`.
- `npm run set-webhook` / `npm run delete-webhook` / `npm run webhook-info` — quản lý webhook Zalo Bot.
