import { LANGUAGES } from "./languages.js";

export interface GeminiConfig {
  apiKey?: string;
  apiKeys?: string;
  model?: string;
  fallbackModels?: string;
}

// gemini-2.5-flash, gemini-2.5-flash-lite and gemini-3-flash have all been
// retired by Google ahead of their published shutdown dates (returning 404
// "no longer available" instead of a normal response) — keep this list to
// models that are still actually serving.
const DEFAULT_FALLBACK_MODELS = "gemini-3.6-flash,gemini-3.1-flash-lite";

function getApiKeys(config: GeminiConfig): string[] {
  if (config.apiKeys) {
    return config.apiKeys
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  }
  return config.apiKey ? [config.apiKey] : [];
}

function getModelChain(config: GeminiConfig): string[] {
  const primary = config.model || "gemini-3.5-flash";
  const fallbacks = (config.fallbackModels || DEFAULT_FALLBACK_MODELS)
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m && m !== primary);
  return [primary, ...fallbacks];
}

// Calls generativelanguage.googleapis.com directly. Historically (2026-08)
// this went through a Vercel deployment, which Google's abuse-detection
// system blocked with 403 PERMISSION_DENIED regardless of key/model
// validity — confirmed specific to Vercel's serverless IP range (same
// key/model worked fine from other networks/regions). Moving the whole
// bot to Cloudflare Workers avoids that: Google does not block Cloudflare's
// network the same way. See MAINTENANCE.md for the full incident history —
// if 403 PERMISSION_DENIED "Your project has been denied access" ever
// reappears, that's the first thing to check.
async function callGenerateContent(apiKey: string, model: string, promptText: string): Promise<string | undefined> {
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: promptText }] }] }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error(`Gemini request failed or timed out: UNAVAILABLE (${err instanceof Error ? err.message : err})`);
  }

  const raw = await res.text();
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 200)}`);
  }
  if (json.error) {
    throw new Error(JSON.stringify(json.error));
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" ? text.trim() : undefined;
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

async function generateWithModelFallback(config: GeminiConfig, promptText: string): Promise<string> {
  const apiKeys = getApiKeys(config);
  if (apiKeys.length === 0) {
    throw new Error("Missing GEMINI_API_KEY (or GEMINI_API_KEYS) env var");
  }
  const models = getModelChain(config);
  let lastErr: unknown;

  for (const [keyIndex, apiKey] of apiKeys.entries()) {
    for (const model of models) {
      try {
        const text = await withRetry(() => callGenerateContent(apiKey, model, promptText));
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

// Pull URLs out of the text before sending it to Gemini and put the exact
// original strings back afterward, instead of letting the model translate
// (and risk mangling/truncating) them. `[[URL0]]`-style tokens survive
// translation reliably in practice; the prompt also tells the model not to
// touch them, as a second layer.
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

function maskUrls(text: string): { masked: string; urls: string[] } {
  const urls: string[] = [];
  const masked = text.replace(URL_RE, (match) => {
    urls.push(match);
    return `[[URL${urls.length - 1}]]`;
  });
  return { masked, urls };
}

function restoreUrls(text: string, urls: string[]): string {
  return text.replace(/\[\[URL(\d+)\]\]/g, (whole, idx) => urls[Number(idx)] ?? whole);
}

export async function translateText(config: GeminiConfig, text: string, targetLangCode: string): Promise<string> {
  const targetLangName = LANGUAGES[targetLangCode]?.english ?? targetLangCode;
  const { masked, urls } = maskUrls(text);
  const translated = await generateWithModelFallback(
    config,
    `Translate the text below into ${targetLangName}. ` +
      `Reply with only the translated text, no explanations, no quotes, no extra commentary. ` +
      `Tokens like [[URL0]], [[URL1]] stand in for links — copy them through completely unchanged, do not translate or alter them.\n\n${masked}`
  );
  return restoreUrls(translated, urls);
}

export async function translateForPair(
  config: GeminiConfig,
  text: string,
  langCodeA: string,
  langCodeB: string
): Promise<string> {
  const nameA = LANGUAGES[langCodeA]?.english ?? langCodeA;
  const nameB = LANGUAGES[langCodeB]?.english ?? langCodeB;
  const { masked, urls } = maskUrls(text);
  const translated = await generateWithModelFallback(
    config,
    `This is a two-language group chat: ${nameA} and ${nameB}. ` +
      `If the text below is written in ${nameA}, translate it into ${nameB}. ` +
      `If it is written in ${nameB} (or any other language), translate it into ${nameA}. ` +
      `Reply with only the translated text, no explanations, no quotes, no extra commentary. ` +
      `Tokens like [[URL0]], [[URL1]] stand in for links — copy them through completely unchanged, do not translate or alter them.\n\n${masked}`
  );
  return restoreUrls(translated, urls);
}

export async function pingGemini(config: GeminiConfig): Promise<{ model: string; sample: string }> {
  const apiKeys = getApiKeys(config);
  if (apiKeys.length === 0) {
    throw new Error("Missing GEMINI_API_KEY (or GEMINI_API_KEYS) env var");
  }
  const model = config.model || "gemini-3.5-flash";
  const sample = await callGenerateContent(apiKeys[0], model, "Reply with exactly one word: OK");
  return { model, sample: sample ?? "" };
}
