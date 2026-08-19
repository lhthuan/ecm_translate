import type { Env } from "./env.js";
import { handleWebhook } from "./webhook.js";
import { handleStatus } from "./status.js";

// @upstash/redis unconditionally sets `cache` (even `cache: undefined`) on
// its RequestInit, which Cloudflare Workers' fetch implementation rejects
// with "The 'cache' field on 'RequestInitializerDict' is not implemented."
// Strip it globally rather than patching the SDK.
const nativeFetch = fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (init && "cache" in init) {
    const { cache: _cache, ...rest } = init;
    return nativeFetch(input, rest);
  }
  return nativeFetch(input, init);
}) as typeof fetch;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/webhook") {
      return handleWebhook(request, env);
    }
    if (pathname === "/api/status") {
      return handleStatus(request, env);
    }
    return new Response("Not found", { status: 404 });
  },
};
