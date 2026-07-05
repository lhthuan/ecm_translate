import { Redis } from "@upstash/redis";

let client: Redis | undefined;

function getClient(): Redis {
  if (!client) {
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error(
        "Missing Redis env vars: set KV_REST_API_URL/KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN)"
      );
    }
    client = new Redis({ url, token });
  }
  return client;
}

const keyFor = (messageId: string) => `processed:${messageId}`;

/**
 * Returns true the first time a message_id is seen (caller should process it),
 * false on any subsequent call for the same id within the TTL window (duplicate delivery).
 */
export async function markProcessedOnce(messageId: string, ttlSeconds = 600): Promise<boolean> {
  const result = await getClient().set(keyFor(messageId), "1", { ex: ttlSeconds, nx: true });
  return result === "OK";
}
