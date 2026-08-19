import type { Env } from "../env.js";
import { getMe } from "./zalo.js";
import { pingGemini, type GeminiConfig } from "./gemini.js";
import { pingRedis } from "./userLang.js";
import type { RedisConfig } from "./redis.js";

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

async function runCheck(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, detail, ms: Date.now() - start };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { name, ok: false, detail, ms: Date.now() - start };
  }
}

// Shared by the /api/status debug page and the /admin chat command so
// there's one place that knows how to check Zalo/Gemini/Redis health.
export async function runHealthChecks(
  env: Env,
  redisConfig: RedisConfig,
  geminiConfig: GeminiConfig
): Promise<CheckResult[]> {
  return Promise.all([
    runCheck("Zalo Bot API (getMe)", async () => JSON.stringify(await getMe(env.ZALO_BOT_TOKEN))),
    runCheck("Gemini API", async () => {
      const r = await pingGemini(geminiConfig);
      return `model=${r.model} sample="${r.sample}"`;
    }),
    runCheck("Upstash Redis", () => pingRedis(redisConfig)),
  ]);
}
