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

export interface ChatPair {
  langA: string;
  langB: string;
}

const keyFor = (chatId: string) => `pair:${chatId}`;

export async function getChatPair(chatId: string): Promise<ChatPair | null> {
  const pair = await getClient().get<ChatPair>(keyFor(chatId));
  return pair ?? null;
}

export async function setChatPair(chatId: string, langA: string, langB: string): Promise<void> {
  await getClient().set(keyFor(chatId), { langA, langB });
}
