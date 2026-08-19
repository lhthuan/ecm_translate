import { redisClient, type RedisConfig } from "./redis.js";

const LOG_KEY = "webhook:logs";
const MAX_LOGS = 30;

export interface WebhookLogEntry {
  time: string;
  eventName?: string;
  chatId?: string;
  userId?: string;
  text?: string;
  translated?: string;
  sendResult?: unknown;
  ok: boolean;
  error?: string;
  rawBody: unknown;
}

export async function logWebhookEvent(config: RedisConfig, entry: Omit<WebhookLogEntry, "time">): Promise<void> {
  try {
    const full: WebhookLogEntry = { time: new Date().toISOString(), ...entry };
    const client = redisClient(config);
    await client.lpush(LOG_KEY, JSON.stringify(full));
    await client.ltrim(LOG_KEY, 0, MAX_LOGS - 1);
  } catch (err) {
    console.error("Failed to write webhook log:", err);
  }
}

export async function getRecentWebhookLogs(config: RedisConfig): Promise<WebhookLogEntry[]> {
  const raw = await redisClient(config).lrange<string>(LOG_KEY, 0, MAX_LOGS - 1);
  return raw
    .map((item) => {
      try {
        return typeof item === "string" ? (JSON.parse(item) as WebhookLogEntry) : (item as WebhookLogEntry);
      } catch {
        return null;
      }
    })
    .filter((entry): entry is WebhookLogEntry => entry !== null);
}
