import { redisClient, type RedisConfig } from "./redis.js";

const keyFor = (messageId: string) => `processed:${messageId}`;

/**
 * Returns true the first time a message_id is seen (caller should process it),
 * false on any subsequent call for the same id within the TTL window (duplicate delivery).
 */
export async function markProcessedOnce(config: RedisConfig, messageId: string, ttlSeconds = 600): Promise<boolean> {
  const result = await redisClient(config).set(keyFor(messageId), "1", { ex: ttlSeconds, nx: true });
  return result === "OK";
}
