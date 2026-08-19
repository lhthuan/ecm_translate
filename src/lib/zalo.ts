import type { ZaloApiResponse } from "./types.js";

function apiUrl(token: string, method: string): string {
  return `https://bot-api.zaloplatforms.com/bot${token}/${method}`;
}

async function call<T = unknown>(token: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(apiUrl(token, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ZaloApiResponse<T>;
  if (!data.ok) {
    throw new Error(`Zalo API ${method} failed: ${data.description ?? "unknown error"} (code ${data.error_code})`);
  }
  return data.result as T;
}

export interface SendMessageOptions {
  parse_mode?: "markdown" | "html";
}

const MAX_MESSAGE_LENGTH = 2000;

// Zalo's sendMessage caps `text` at 2000 chars; split on the nearest line/word
// break so long translations still arrive intact as consecutive messages.
function splitMessage(text: string, maxLen = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) {
    return [text];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitAt <= 0) {
      splitAt = maxLen;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

export async function sendMessage(token: string, chatId: string, text: string, options: SendMessageOptions = {}) {
  const chunks = splitMessage(text);
  const results: unknown[] = [];
  for (const chunk of chunks) {
    results.push(await call(token, "sendMessage", { chat_id: chatId, text: chunk, ...options }));
  }
  return chunks.length === 1 ? results[0] : results;
}

export function sendChatAction(token: string, chatId: string, action: "typing" | "upload_photo") {
  return call(token, "sendChatAction", { chat_id: chatId, action });
}

export function setWebhook(token: string, url: string, secretToken: string) {
  return call(token, "setWebhook", { url, secret_token: secretToken });
}

export function deleteWebhook(token: string) {
  return call(token, "deleteWebhook");
}

export function getWebhookInfo(token: string) {
  return call(token, "getWebhookInfo");
}

export interface BotInfo {
  id: string;
  account_name: string;
  account_type: string;
  can_join_groups: boolean;
  display_name?: string;
}

export function getMe(token: string) {
  return call<BotInfo>(token, "getMe");
}

let cachedBotInfo: BotInfo | undefined;

export async function getCachedBotInfo(token: string): Promise<BotInfo> {
  if (!cachedBotInfo) {
    cachedBotInfo = await getMe(token);
  }
  return cachedBotInfo;
}
