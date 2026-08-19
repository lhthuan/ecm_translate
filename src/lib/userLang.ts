import { redisClient, type RedisConfig } from "./redis.js";
import { DEFAULT_TARGET_LANG } from "./languages.js";

const keyFor = (userId: string) => `lang:${userId}`;

export async function getUserLang(config: RedisConfig, userId: string): Promise<string> {
  const lang = await redisClient(config).get<string>(keyFor(userId));
  return lang ?? DEFAULT_TARGET_LANG;
}

export async function setUserLang(config: RedisConfig, userId: string, langCode: string): Promise<void> {
  await redisClient(config).set(keyFor(userId), langCode);
}

export async function pingRedis(config: RedisConfig): Promise<string> {
  const key = "healthcheck:ping";
  const value = `ping-${Date.now()}`;
  const client = redisClient(config);
  await client.set(key, value);
  const readBack = await client.get<string>(key);
  if (readBack !== value) {
    throw new Error(`Redis round-trip mismatch: wrote ${value}, read ${readBack}`);
  }
  return "set/get round-trip ok";
}
