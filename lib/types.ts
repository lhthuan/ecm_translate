export interface ZaloChat {
  id: string;
  chat_type?: "PRIVATE" | "GROUP";
}

export interface ZaloUser {
  id: string;
  display_name?: string;
  is_bot?: boolean;
}

export type ZaloEventName =
  | "message.text.received"
  | "message.image.received"
  | "message.sticker.received"
  | "message.voice.received"
  | "message.unsupported.received";

export interface ZaloMessage {
  message_id?: string;
  from: ZaloUser;
  chat: ZaloChat;
  date?: number;
  text?: string;
  photo?: string;
  caption?: string;
  sticker?: string;
  url?: string;
  voice_url?: string;
}

export interface ZaloWebhookBody {
  event_name: ZaloEventName;
  message?: ZaloMessage;
}

export interface ZaloApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}
