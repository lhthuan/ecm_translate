import { GoogleGenAI } from "@google/genai";
import { LANGUAGES } from "./languages";

// gemini-2.5-flash, gemini-2.5-flash-lite and gemini-3-flash have all been
// retired by Google ahead of their published shutdown dates (returning 404
// "no longer available" instead of a normal response) — keep this list to
// models that are still actually serving.
const DEFAULT_FALLBACK_MODELS = "gemini-3.6-flash,gemini-3.1-flash-lite";

function getApiKeys(): string[] {
  const multi = process.env.GEMINI_API_KEYS;
  if (multi) {
    return multi
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  }
  const single = process.env.GEMINI_API_KEY;
  return single ? [single] : [];
}

const clients = new Map<string, GoogleGenAI>();

function getClient(apiKey: string): GoogleGenAI {
  let client = clients.get(apiKey);
  if (!client) {
    client = new GoogleGenAI({ apiKey });
    clients.set(apiKey, client);
  }
  return client;
}

function getModelChain(): string[] {
  const primary = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS || DEFAULT_FALLBACK_MODELS)
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m && m !== primary);
  return [primary, ...fallbacks];
}

// Transient/quota errors are worth retrying (same key+model) or falling back to
// another model / API key. Anything else (bad request, invalid key, etc.) should
// fail fast instead of masking the real problem.
function isTransientError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /"code":\s*(503|429)|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|quota/i.test(message);
}

// Google periodically retires models ahead of their published shutdown date
// (seen with gemini-2.5-flash / gemini-2.5-flash-lite in July 2026). That
// shows up as a 404 rather than a 429/503, so it needs its own check: no
// point retrying the same dead model, but it should NOT abort the whole
// chain — just move straight on to the next model/key.
function isModelUnavailableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /"code":\s*404|NOT_FOUND|no longer available/i.test(message);
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 500): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isTransientError(err)) {
        throw err;
      }
      const wait = baseDelayMs * 2 ** attempt;
      console.log(
        `[gemini] transient error on attempt ${attempt + 1}/${retries + 1}, retrying in ${wait}ms:`,
        err instanceof Error ? err.message : err
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

async function generateWithModelFallback(promptText: string): Promise<string> {
  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) {
    throw new Error("Missing GEMINI_API_KEY (or GEMINI_API_KEYS) env var");
  }
  const models = getModelChain();
  let lastErr: unknown;

  for (const [keyIndex, apiKey] of apiKeys.entries()) {
    for (const model of models) {
      try {
        const response = await withRetry(() =>
          getClient(apiKey).models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: promptText }] }],
          })
        );
        const text = response.text?.trim();
        if (text) {
          return text;
        }
        lastErr = new Error(`Gemini model ${model} returned an empty response`);
      } catch (err) {
        lastErr = err;
        if (!isTransientError(err) && !isModelUnavailableError(err)) {
          throw err;
        }
        console.log(
          `[gemini] key #${keyIndex + 1} model ${model} unavailable, trying next fallback if any:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  throw lastErr;
}

export async function translateText(text: string, targetLangCode: string): Promise<string> {
  const targetLangName = LANGUAGES[targetLangCode]?.english ?? targetLangCode;
  return generateWithModelFallback(
    `Translate the text below into ${targetLangName}. ` +
      `Reply with only the translated text, no explanations, no quotes, no extra commentary.\n\n${text}`
  );
}

export async function translateForPair(text: string, langCodeA: string, langCodeB: string): Promise<string> {
  const nameA = LANGUAGES[langCodeA]?.english ?? langCodeA;
  const nameB = LANGUAGES[langCodeB]?.english ?? langCodeB;
  return generateWithModelFallback(
    `This is a two-language group chat: ${nameA} and ${nameB}. ` +
      `If the text below is written in ${nameA}, translate it into ${nameB}. ` +
      `If it is written in ${nameB} (or any other language), translate it into ${nameA}. ` +
      `Reply with only the translated text, no explanations, no quotes, no extra commentary.\n\n${text}`
  );
}

export async function pingGemini(): Promise<{ model: string; sample: string }> {
  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) {
    throw new Error("Missing GEMINI_API_KEY (or GEMINI_API_KEYS) env var");
  }
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const response = await getClient(apiKeys[0]).models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: "Reply with exactly one word: OK" }] }],
  });
  return { model, sample: response.text?.trim() ?? "" };
}
