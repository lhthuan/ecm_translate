import { redisClient, type RedisConfig } from "./redis.js";

export interface ChatPair {
  langA: string;
  langB: string;
}

const keyFor = (chatId: string) => `pair:${chatId}`;

export async function getChatPair(config: RedisConfig, chatId: string): Promise<ChatPair | null> {
  const pair = await redisClient(config).get<ChatPair>(keyFor(chatId));
  return pair ?? null;
}

export async function setChatPair(config: RedisConfig, chatId: string, langA: string, langB: string): Promise<void> {
  await redisClient(config).set(keyFor(chatId), { langA, langB });
}
