export interface LanguageInfo {
  display: string;
  english: string;
}

export const LANGUAGES: Record<string, LanguageInfo> = {
  vi: { display: "Tiếng Việt", english: "Vietnamese" },
  en: { display: "English", english: "English" },
  ja: { display: "日本語", english: "Japanese" },
  ko: { display: "한국어", english: "Korean" },
  zh: { display: "中文", english: "Chinese" },
  fr: { display: "Français", english: "French" },
  de: { display: "Deutsch", english: "German" },
  es: { display: "Español", english: "Spanish" },
  th: { display: "ภาษาไทย", english: "Thai" },
  ru: { display: "Русский", english: "Russian" },
};

export const DEFAULT_TARGET_LANG = "en";

export function isSupportedLang(code: string): boolean {
  return code in LANGUAGES;
}

export function listSupportedLangs(): string {
  return Object.entries(LANGUAGES)
    .map(([code, info]) => `${code} - ${info.display}`)
    .join("\n");
}
