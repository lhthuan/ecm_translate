import { Redis } from "@upstash/redis";

const LOG_KEY = "webhook:logs";
const MAX_LOGS = 30;

let client: Redis | undefined;

function getClient(): Redis {
  if (!client) {
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error("Missing Redis env vars for webhook logging");
    }
    client = new Redis({ url, token });
  }
  return client;
}

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

export async function logWebhookEvent(entry: Omit<WebhookLogEntry, "time">): Promise<void> {
  try {
    const full: WebhookLogEntry = { time: new Date().toISOString(), ...entry };
    await getClient().lpush(LOG_KEY, JSON.stringify(full));
    await getClient().ltrim(LOG_KEY, 0, MAX_LOGS - 1);
  } catch (err) {
    console.error("Failed to write webhook log:", err);
  }
}

export async function getRecentWebhookLogs(): Promise<WebhookLogEntry[]> {
  const raw = await getClient().lrange<string>(LOG_KEY, 0, MAX_LOGS - 1);
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
