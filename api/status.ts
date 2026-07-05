import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getMe } from "../lib/zalo";
import { pingGemini } from "../lib/gemini";
import { pingRedis } from "../lib/userLang";
import { getRecentWebhookLogs } from "../lib/webhookLog";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

async function runCheck(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, detail, ms: Date.now() - start };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { name, ok: false, detail, ms: Date.now() - start };
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!process.env.ZALO_WEBHOOK_SECRET_TOKEN || token !== process.env.ZALO_WEBHOOK_SECRET_TOKEN) {
    res.status(403).send("Unauthorized. Truy cập kèm query param ?token=<ZALO_WEBHOOK_SECRET_TOKEN>");
    return;
  }

  const results = await Promise.all([
    runCheck("Zalo Bot API (getMe)", async () => JSON.stringify(await getMe())),
    runCheck("Gemini API", async () => {
      const r = await pingGemini();
      return `model=${r.model} sample="${r.sample}"`;
    }),
    runCheck("Upstash Redis", () => pingRedis()),
  ]);

  const rows = results
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.name)}</td>
        <td class="${r.ok ? "ok" : "fail"}">${r.ok ? "OK" : "LỖI"}</td>
        <td>${r.ms}ms</td>
        <td><pre>${escapeHtml(r.detail)}</pre></td>
      </tr>`
    )
    .join("\n");

  let webhookLogs;
  let webhookLogsError: string | undefined;
  try {
    webhookLogs = await getRecentWebhookLogs();
  } catch (err) {
    webhookLogsError = err instanceof Error ? err.message : String(err);
  }

  const logRows = (webhookLogs ?? [])
    .map(
      (l) => `<tr>
        <td>${escapeHtml(l.time)}</td>
        <td>${escapeHtml(l.eventName ?? "")}</td>
        <td>${escapeHtml(l.chatId ?? "")}</td>
        <td>${escapeHtml(l.text ?? "")}</td>
        <td>${escapeHtml(l.translated ?? "")}</td>
        <td class="${l.ok ? "ok" : "fail"}">${l.ok ? "OK" : "LỖI"}</td>
        <td><pre>${escapeHtml(l.error ?? "")}</pre></td>
        <td><pre>${escapeHtml(JSON.stringify(l.sendResult ?? ""))}</pre></td>
        <td><pre>${escapeHtml(JSON.stringify(l.rawBody))}</pre></td>
      </tr>`
    )
    .join("\n");

  const logsSection = webhookLogsError
    ? `<p class="fail">Không đọc được log: ${escapeHtml(webhookLogsError)}</p>`
    : webhookLogs && webhookLogs.length > 0
      ? `<table>
          <tr><th>Thời gian</th><th>Event</th><th>Chat ID</th><th>Nội dung</th><th>Đã dịch</th><th>Trạng thái</th><th>Lỗi</th><th>Kết quả gửi Zalo</th><th>Raw body</th></tr>
          ${logRows}
        </table>`
      : `<p>Chưa có webhook nào được ghi nhận. Hãy thử nhắn tin cho bot rồi tải lại trang này.</p>`;

  const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>ecm_translate - Status</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 24px; max-width: 1100px; margin: 0 auto; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
  th, td { border: 1px solid #ccc; padding: 8px 12px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; }
  .ok { color: #0a7d2c; font-weight: bold; }
  .fail { color: #c62828; font-weight: bold; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-all; font-size: 12px; }
</style>
</head>
<body>
  <h1>ecm_translate - Kiểm tra kết nối</h1>
  <table>
    <tr><th>Dịch vụ</th><th>Trạng thái</th><th>Thời gian</th><th>Chi tiết / Lỗi</th></tr>
    ${rows}
  </table>

  <h2>Webhook gần đây (tối đa 30, mới nhất trước)</h2>
  ${logsSection}

  <p>Tải lại trang để kiểm tra lại.</p>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
