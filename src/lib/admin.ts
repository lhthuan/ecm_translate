import type { Env } from "../env.js";
import type { GeminiConfig } from "./gemini.js";
import type { RedisConfig } from "./redis.js";
import { runHealthChecks } from "./health.js";
import { getRecentWebhookLogs } from "./webhookLog.js";

export function isAdmin(env: Env, userId: string): boolean {
  const admins = (env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return admins.includes(userId);
}

function formatVietnamTime(iso: string): string {
  // Cheap "giờ Việt Nam" formatting without pulling in Intl timezone data —
  // just shift UTC by +7h and format manually.
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
}

// Compact, chat-friendly system report for admins — same three health
// checks as /api/status (Zalo/Gemini/Redis) plus a rollup of the last N
// webhook deliveries, without needing to open a browser.
export async function buildAdminReport(
  env: Env,
  redisConfig: RedisConfig,
  geminiConfig: GeminiConfig
): Promise<string> {
  const [checks, logsResult] = await Promise.all([
    runHealthChecks(env, redisConfig, geminiConfig),
    getRecentWebhookLogs(redisConfig).then(
      (logs) => ({ logs, error: undefined as string | undefined }),
      (err) => ({ logs: [] as Awaited<ReturnType<typeof getRecentWebhookLogs>>, error: err instanceof Error ? err.message : String(err) })
    ),
  ]);

  const checkLines = checks
    .map((c) => `${c.ok ? "✅" : "❌"} ${c.name}: ${c.ok ? "OK" : "LỖI"} (${c.ms}ms)${c.ok ? "" : ` — ${c.detail}`}`)
    .join("\n");

  const { logs, error: logsError } = logsResult;
  let logSummary: string;
  let lastErrorLine = "";
  if (logsError) {
    logSummary = `Không đọc được log webhook: ${logsError}`;
  } else if (logs.length === 0) {
    logSummary = "Chưa có webhook nào được ghi nhận.";
  } else {
    let translatedCount = 0;
    let unsupportedCount = 0;
    let commandCount = 0;
    let errorCount = 0;
    let lastError: { time: string; error: string } | undefined;
    for (const log of logs) {
      if (!log.ok) {
        errorCount++;
        if (!lastError) lastError = { time: log.time, error: log.error ?? "(không rõ)" };
        continue;
      }
      if (log.translated) translatedCount++;
      else if (log.eventName && log.eventName !== "message.text.received") unsupportedCount++;
      else commandCount++;
    }
    logSummary =
      `${logs.length} webhook gần nhất (${formatVietnamTime(logs[logs.length - 1].time)} → ${formatVietnamTime(logs[0].time)}):\n` +
      `  ${translatedCount} dịch thành công, ${commandCount} lệnh, ` +
      `${unsupportedCount} không hỗ trợ (link/ảnh/sticker/voice), ${errorCount} lỗi`;
    if (lastError) {
      lastErrorLine = `\n\nLỗi gần nhất (${formatVietnamTime(lastError.time)}): ${lastError.error.slice(0, 300)}`;
    }
  }

  return (
    `📊 Trạng thái hệ thống — ${formatVietnamTime(new Date().toISOString())}\n\n` +
    `${checkLines}\n\n` +
    `${logSummary}` +
    lastErrorLine
  );
}
