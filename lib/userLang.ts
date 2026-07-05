import { Redis } from "@upstash/redis";
import { DEFAULT_TARGET_LANG } from "./languages";

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

const keyFor = (userId: string) => `lang:${userId}`;

export async function getUserLang(userId: string): Promise<string> {
  const lang = await getClient().get<string>(keyFor(userId));
  return lang ?? DEFAULT_TARGET_LANG;
}

export async function setUserLang(userId: string, langCode: string): Promise<void> {
  await getClient().set(keyFor(userId), langCode);
}

export async function pingRedis(): Promise<string> {
  const key = "healthcheck:ping";
  const value = `ping-${Date.now()}`;
  await getClient().set(key, value);
  const readBack = await getClient().get<string>(key);
  if (readBack !== value) {
    throw new Error(`Redis round-trip mismatch: wrote ${value}, read ${readBack}`);
  }
  return "set/get round-trip ok";
}
