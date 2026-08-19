import { Redis } from "@upstash/redis";

export interface RedisConfig {
  url?: string;
  token?: string;
}

// @upstash/redis talks over plain HTTPS REST calls (no TCP socket), so it
// works unmodified on Cloudflare Workers — this one helper is shared by
// userLang.ts, chatPair.ts, dedupe.ts and webhookLog.ts instead of each
// duplicating the same client-construction/error-message logic.
export function redisClient(config: RedisConfig): Redis {
  if (!config.url || !config.token) {
    throw new Error(
      "Missing Redis env vars: set KV_REST_API_URL/KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN)"
    );
  }
  return new Redis({ url: config.url, token: config.token });
}
