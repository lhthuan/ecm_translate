export interface Env {
  ZALO_BOT_TOKEN: string;
  ZALO_WEBHOOK_SECRET_TOKEN: string;
  GEMINI_API_KEY?: string;
  GEMINI_API_KEYS?: string;
  GEMINI_MODEL?: string;
  GEMINI_FALLBACK_MODELS?: string;
  KV_REST_API_URL?: string;
  KV_REST_API_TOKEN?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  // Comma-separated Zalo user ids allowed to use /admin. Get a user's id
  // from a webhook log entry's "from" field (or the api/status raw body).
  ADMIN_USER_IDS?: string;
  // Purely informational label shown in the /admin report — Google doesn't
  // expose which account/quota an API key belongs to via any API call
  // (verified 2026-08-19: no rate-limit headers on generateContent
  // responses, and quota is only visible via the AI Studio/Cloud Console
  // dashboards), so this is just a note to self, update by hand when the
  // key changes.
  GEMINI_ACCOUNT_LABEL?: string;
}
