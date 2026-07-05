import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendMessage, sendChatAction, getCachedBotInfo } from "../lib/zalo";
import { translateText, translateForPair } from "../lib/gemini";
import { getUserLang, setUserLang } from "../lib/userLang";
import { getChatPair, setChatPair } from "../lib/chatPair";
import { isSupportedLang, listSupportedLangs, LANGUAGES } from "../lib/languages";
import { logWebhookEvent } from "../lib/webhookLog";
import { markProcessedOnce } from "../lib/dedupe";
import type { ZaloChat, ZaloWebhookBody } from "../lib/types";

const HELP_TEXT =
  "Xin chào! Gửi bất kỳ tin nhắn văn bản nào, mình sẽ dịch sang ngôn ngữ đích đã đặt.\n\n" +
  "/setlang <mã> - đặt ngôn ngữ đích cho tin nhắn của bạn, ví dụ: /setlang en\n\n" +
  "/pair <mã1> <mã2> - bật chế độ dịch 2 chiều cho chat này (dùng được cả nhóm lẫn chat riêng), ví dụ: /pair ko vi\n" +
  "  (ai nhắn tiếng Hàn sẽ tự dịch ra tiếng Việt, ai nhắn tiếng Việt sẽ tự dịch ra tiếng Hàn)\n" +
  "  Khi /pair đã bật cho chat này, nó được ưu tiên dùng thay cho /setlang.\n" +
  "  Trong nhóm, hãy @mention bot hoặc reply tin nhắn của bot để bot nhận được tin.\n\n" +
  "/status - xem cấu hình hiện tại (pair của chat này + ngôn ngữ đích cá nhân của bạn)\n\n" +
  "/help - hiển thị hướng dẫn này\n\n" +
  "Các mã ngôn ngữ hỗ trợ:\n" +
  listSupportedLangs();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const secretToken = req.headers["x-bot-api-secret-token"];
  if (secretToken !== process.env.ZALO_WEBHOOK_SECRET_TOKEN) {
    res.status(403).json({ message: "Unauthorized" });
    return;
  }

  const body = req.body as ZaloWebhookBody;
  const message = body?.message;
  const eventName = body?.event_name;

  let ok = true;
  let error: string | undefined;
  let translated: string | undefined;
  let sendResult: unknown;

  console.log("[webhook] received:", JSON.stringify(body));

  if (eventName === "message.text.received" && message?.text) {
    const isNew = message.message_id ? await markProcessedOnce(message.message_id) : true;
    if (!isNew) {
      console.log(`[webhook] duplicate delivery for message_id=${message.message_id}, skipping`);
    } else {
      try {
        const stepResult = await handleTextMessage(message.chat, message.from.id, message.text);
        translated = stepResult.translated;
        sendResult = stepResult.sendResult;
      } catch (err) {
        ok = false;
        error = err instanceof Error ? err.message : String(err);
        console.error("[webhook] failed to handle message:", err);
        try {
          await sendMessage(
            message.chat.id,
            "Xin lỗi, hệ thống dịch đang gặp sự cố tạm thời (server Gemini quá tải). Vui lòng thử lại sau ít phút."
          );
        } catch (sendErr) {
          console.error("[webhook] also failed to send error notice:", sendErr);
        }
      }
    }
  } else {
    console.log("[webhook] ignored: event_name not message.text.received or missing text");
  }

  await logWebhookEvent({
    eventName,
    chatId: message?.chat?.id,
    userId: message?.from?.id,
    text: message?.text,
    translated,
    sendResult,
    ok,
    error,
    rawBody: body,
  });

  res.status(200).json({ message: "Success" });
}

async function stripMention(chat: ZaloChat, text: string): Promise<string> {
  if (chat.chat_type !== "GROUP") {
    return text.trim();
  }
  const trimmed = text.trim();
  try {
    const bot = await getCachedBotInfo();
    const mentionNames = [bot.display_name, bot.account_name].filter((n): n is string => Boolean(n));
    for (const name of mentionNames) {
      const prefix = `@${name}`;
      if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
        return trimmed.slice(prefix.length).trim();
      }
    }
  } catch (err) {
    console.error("[webhook] failed to fetch bot info for mention stripping:", err);
  }
  return trimmed;
}

async function handleTextMessage(
  chat: ZaloChat,
  userId: string,
  rawText: string
): Promise<{ translated?: string; sendResult: unknown }> {
  const chatId = chat.id;
  const trimmed = await stripMention(chat, rawText);
  const command = trimmed.split(/\s+/)[0]?.toLowerCase();

  if (command === "/start" || command === "/help") {
    const sendResult = await sendMessage(chatId, HELP_TEXT);
    return { sendResult };
  }

  if (command === "/pair") {
    const [codeA, codeB] = trimmed.split(/\s+/).slice(1).map((c) => c.toLowerCase());
    if (!codeA || !codeB || !isSupportedLang(codeA) || !isSupportedLang(codeB) || codeA === codeB) {
      const sendResult = await sendMessage(
        chatId,
        `Cú pháp: /pair <mã1> <mã2>, ví dụ: /pair ko vi\nCác mã hỗ trợ:\n${listSupportedLangs()}`
      );
      return { sendResult };
    }
    await setChatPair(chatId, codeA, codeB);
    const sendResult = await sendMessage(
      chatId,
      `Đã bật dịch 2 chiều cho chat này: ${LANGUAGES[codeA].display} <-> ${LANGUAGES[codeB].display}.\n` +
        (chat.chat_type === "GROUP"
          ? `Từ giờ hãy @mention bot hoặc reply tin bot khi nhắn để được dịch.`
          : `Từ giờ mọi tin bạn nhắn sẽ tự dịch qua lại giữa 2 ngôn ngữ này.`)
    );
    return { sendResult };
  }

  if (command === "/setlang") {
    const code = trimmed.split(/\s+/)[1]?.toLowerCase();
    if (!code || !isSupportedLang(code)) {
      const sendResult = await sendMessage(
        chatId,
        `Ngôn ngữ không hợp lệ. Dùng: /setlang <mã>\nCác mã hỗ trợ:\n${listSupportedLangs()}`
      );
      return { sendResult };
    }
    await setUserLang(userId, code);
    const sendResult = await sendMessage(chatId, `Đã đặt ngôn ngữ đích: ${LANGUAGES[code].display}`);
    return { sendResult };
  }

  if (command === "/status") {
    const [pair, personalLang] = await Promise.all([getChatPair(chatId), getUserLang(userId)]);
    const statusText =
      `Trạng thái cấu hình:\n` +
      `- Chat này (/pair): ${
        pair ? `đã bật, ${LANGUAGES[pair.langA].display} <-> ${LANGUAGES[pair.langB].display}` : "chưa bật"
      }\n` +
      `- Ngôn ngữ đích cá nhân của bạn (/setlang): ${LANGUAGES[personalLang].display}` +
      (pair ? " (đang không dùng vì /pair của chat này được ưu tiên)" : "");
    const sendResult = await sendMessage(chatId, statusText);
    return { sendResult };
  }

  const pair = await getChatPair(chatId);
  if (pair) {
    sendChatAction(chatId, "typing").catch((err) => console.error("[webhook] typing indicator failed:", err));
    console.log(`[webhook] pair-translating in chat ${chatId} (${pair.langA}<->${pair.langB}): "${trimmed}"`);
    const translated = await translateForPair(trimmed, pair.langA, pair.langB);
    console.log(`[webhook] gemini pair-translated: "${translated}"`);
    const sendResult = await sendMessage(chatId, translated);
    return { translated, sendResult };
  }

  sendChatAction(chatId, "typing").catch((err) => console.error("[webhook] typing indicator failed:", err));
  const targetLang = await getUserLang(userId);
  console.log(`[webhook] translating for user ${userId} to ${targetLang}: "${trimmed}"`);
  const translated = await translateText(trimmed, targetLang);
  console.log(`[webhook] gemini translated: "${translated}"`);

  const sendResult = await sendMessage(chatId, translated);
  console.log("[webhook] zalo sendMessage result:", JSON.stringify(sendResult));

  return { translated, sendResult };
}
