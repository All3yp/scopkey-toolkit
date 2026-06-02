import path from "node:path";
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import fs from "node:fs";
import DetectLanguage from "detectlanguage";
import googleTranslate from 'google-translate-api-next';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

export function resolveSecret(
  value,
  {
    platform = process.platform,
    exec = execSync,
    warn = console.warn,
  } = {}
) {
  const strValue = String(value || "").trim();

  if (platform === "win32" || !strValue.startsWith("PASS:")) {
    return strValue;
  }

  try {
    const passPath = strValue.replace("PASS:", "");
    return exec(`pass ${passPath}`, { stdio: ["pipe", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch (error) {
    warn(`[Config] ⚠ Falha ao resolver '${strValue}' via pass. Usando valor bruto.`);
    return strValue;
  }
}

function timestampedPath(dir, name, ext) {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}m${pad(d.getSeconds())}s`;
  return path.join(dir, `${name}-${ts}.${ext}`);
}

const TRANSLATE_TARGET_LANG = "en";

function getTranslate(translateModule = googleTranslate) {
  // Supports both ESM default exports and direct function exports.
  // Keeps runtime behavior identical while making tests deterministic.
  // eslint-disable-next-line no-unsafe-optional-chaining
  const translate = translateModule.default || translateModule;
  return translate;
}

export function resolveChromiumExecutablePath(
  env,
  { platform = process.platform, exec = execSync, exists = fs.existsSync } = {}
) {
  const explicit = String(env.CHROMIUM_EXECUTABLE_PATH || "").trim();
  if (explicit) return explicit;

  const commonPaths = platform === "darwin"
    ? [
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      ]
    : platform === "win32"
      ? [
          "C:\\Program Files\\Chromium\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe",
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ]
    : [
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/snap/bin/chromium",
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chrome",
          "/opt/google/chrome/chrome",
        ];

  for (const candidate of commonPaths) {
    if (candidate.includes("\\")) {
      if (exists(candidate)) return candidate;
      continue;
    }
    if (exists(candidate)) return candidate;
  }

  const probes = platform === "win32"
    ? ["chromium", "chrome", "chrome.exe"]
    : ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"];

  for (const probe of probes) {
    try {
      const found = String(exec(platform === "win32" ? `where ${probe}` : `command -v ${probe}`, {
        stdio: ["ignore", "pipe", "ignore"],
      })).trim().split(/\r?\n/).find(Boolean);
      if (found && exists(found)) return found;
    } catch {
      // Try the next candidate.
    }
  }

  return undefined;
}

export function buildRuntimeConfig({
  env = process.env,
  platform = process.platform,
  exec = execSync,
  exists = fs.existsSync,
  warn = console.warn,
  DetectLanguageCtor = DetectLanguage,
  translateModule = googleTranslate,
} = {}) {
  const detectLanguageApiKey = resolveSecret(env.DETECTLANGUAGE_API_KEY || "", {
    platform,
    exec,
    warn,
  });

  const languageDetector = detectLanguageApiKey
    ? new DetectLanguageCtor(detectLanguageApiKey)
    : null;

  async function detectLang(text) {
    if (!languageDetector) return "en";
    try {
      const results = await languageDetector.detect(text);
      return results?.[0]?.language ?? "en";
    } catch {
      return "en";
    }
  }

  async function translateIfNeeded(text) {
    const lang = await detectLang(text);
    if (lang === "en" || lang === "un") return text;
    try {
      const translate = getTranslate(translateModule);
      const res = await translate(text, { from: lang, to: TRANSLATE_TARGET_LANG });
      return res.text || text;
    } catch {
      return text;
    }
  }

  const SETTINGS = {
    headless: false,
    executablePath: resolveChromiumExecutablePath(env, { platform, exec, exists }),
    slowMo: Number(env.SLOW_MO || 50),
    navigationTimeoutMs: 120000,
    delayBetweenArticlesMs: Number(env.DELAY_MS || 800),
    cafeStepDelayMs: Number(env.CAFE_STEP_DELAY_MS || 1200),

    cafeUsername: resolveSecret(env.CAFE_USERNAME || "mock_username", {
      platform,
      exec,
      warn,
    }),
    cafePassword: resolveSecret(env.CAFE_PASSWORD || "mock_password", {
      platform,
      exec,
      warn,
    }),

    cafeInstitutionId: String(env.CAFE_INSTITUTION_ID || "IFCE").trim(),
    cafeLoginAutofillMode: String(env.CAFE_LOGIN_AUTOFILL_MODE || "username").toLowerCase(),
    cafeAutoClickLogin: String(env.CAFE_AUTO_CLICK_LOGIN || "").toLowerCase() === "true",

    cafeAccessUrl: env.CAFE_ACCESS_URL || "",
    scopusHomeUrl: env.SCOPUS_HOME_URL || "",
    scopusResultsUrl: env.SCOPUS_RESULTS_URL || "",
  };

  return { detectLang, translateIfNeeded, SETTINGS };
}

const runtime = buildRuntimeConfig();

export const detectLang = runtime.detectLang;
export const translateIfNeeded = runtime.translateIfNeeded;

const ARTIFACTS_DIR = path.join(ROOT, "artifacts");
const OUTPUT_DIR = path.join(ARTIFACTS_DIR, "output");
const BROWSER_DIR = path.join(ARTIFACTS_DIR, "browser");
const SESSION_DIR = path.join(ARTIFACTS_DIR, "session");
const SORTED_DIR = path.join(OUTPUT_DIR, "sorted");

function buildSessionPaths(sessionTs) {
  const COLLECT_DIR = path.join(OUTPUT_DIR, "collect", sessionTs);
  const EXTRACT_DIR = path.join(OUTPUT_DIR, "extract", sessionTs);
  const RESULTS_DIR = path.join(EXTRACT_DIR, "results");
  const FAILURES_DIR = path.join(EXTRACT_DIR, "failures");
  const NO_KW_DIR = path.join(EXTRACT_DIR, "no-keywords");
  const CLEAN_DIR = path.join(EXTRACT_DIR, "clean");
  const DOWNLOADS_DIR = path.join(EXTRACT_DIR, "downloads");
  const ABSTRACTS_DIR = path.join(EXTRACT_DIR, "abstracts");

  return {
    collectDir: COLLECT_DIR,
    extractDir: EXTRACT_DIR,
    resultsDir: RESULTS_DIR,
    failuresDir: FAILURES_DIR,
    noKeywordsDir: NO_KW_DIR,
    cleanDir: CLEAN_DIR,
    downloadsDir: DOWNLOADS_DIR,
    abstractsDir: ABSTRACTS_DIR,
    abstracts: path.join(ABSTRACTS_DIR, `abstracts-${sessionTs}.jsonl`),
    links: path.join(COLLECT_DIR, `links-${sessionTs}.json`),
    results: path.join(RESULTS_DIR, `results-${sessionTs}.jsonl`),
    noKeywords: path.join(NO_KW_DIR, `no-keywords-${sessionTs}.jsonl`),
    failures: path.join(FAILURES_DIR, `failures-${sessionTs}.jsonl`),
    downloads: path.join(DOWNLOADS_DIR, `downloads-${sessionTs}.jsonl`),
  };
}

const _d = new Date();
const _pad = n => String(n).padStart(2, "0");
const SESSION_TS = process.env.SESSION_TS ||
  `${_d.getFullYear()}-${_pad(_d.getMonth() + 1)}-${_pad(_d.getDate())}_${_pad(_d.getHours())}h${_pad(_d.getMinutes())}m${_pad(_d.getSeconds())}s`;

export const PATHS = {
  root: ROOT,
  artifactsDir: ARTIFACTS_DIR,
  userDataDir: path.join(BROWSER_DIR, "user-data"),
  authCookies: path.join(SESSION_DIR, "auth-cookies.json"),
  searches: path.join(ROOT, "config", "searches.json"),
  outputDir: OUTPUT_DIR,
  sortedDir: SORTED_DIR,
  rawDir: path.join(OUTPUT_DIR, "raw"),
  sessionTs: SESSION_TS,
  ...buildSessionPaths(SESSION_TS),
};

export const SETTINGS = runtime.SETTINGS;
