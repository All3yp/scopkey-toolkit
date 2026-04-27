import fs from "node:fs";
import path from "node:path";
import { PATHS, SETTINGS } from "../shared/config.mjs";
import { sleep } from "../shared/utils.mjs";
import { log } from "../shared/logger.mjs";
import { fmt } from "../shared/formatter.mjs";
import { cafeLoadHandler } from "./cafe-auth.mjs";

const COOKIE_TTL_MS = 8 * 60 * 60 * 1000;

export async function saveSessionCookies(context) {
  try {
    const cookies = await context.cookies();
    const now = Date.now();
    const persisted = cookies.map(c => ({
      ...c,
      expires: c.expires <= 0 ? Math.floor((now + COOKIE_TTL_MS) / 1000) : c.expires,
    }));
    fs.mkdirSync(path.dirname(PATHS.authCookies), { recursive: true });
    fs.writeFileSync(PATHS.authCookies, JSON.stringify(persisted, null, 2), "utf8");
    log.ok("Sessão salva em disco");
  } catch (err) {
    log.warn(`Falha ao salvar cookies: ${err.message}`);
  }
}

export async function restoreSessionCookies(context) {
  try {
    if (!fs.existsSync(PATHS.authCookies)) return;
    const raw = fs.readFileSync(PATHS.authCookies, "utf8");
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies) || cookies.length === 0) return;
    const now = Math.floor(Date.now() / 1000);
    const valid = cookies.filter(c => c.expires <= 0 || c.expires > now);
    if (valid.length === 0) return;
    await context.addCookies(valid);
    log.ok(`Sessão restaurada (${valid.length} cookies)`);
  } catch (err) {
    log.warn(`Falha ao restaurar cookies: ${err.message}`);
  }
}

const COOKIE_CSS_SELECTORS = [
  "#onetrust-accept-btn-handler",
  "#_evidon-accept-button",
  "#accept-recommended-btn-handler",
  'button[id*="accept-all" i]',
  'button[data-testid*="accept" i]',
  'button[aria-label*="accept all" i]',
  'button[aria-label*="aceitar" i]',
  ".ot-sdk-container button",
  '[class*="cookie"] button:first-of-type',
  '[id*="cookie"] button:first-of-type',
  '[class*="consent"] button',
];

const COOKIE_TEXT_PATTERNS = ["Accept", "Aceitar", "Aceito", "Concordo", "I agree"];

export async function acceptCookies(page) {
  try {
    await sleep(600);

    for (const sel of COOKIE_CSS_SELECTORS) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click({ force: true });
          if (fmt?.cookieAccepted) fmt.cookieAccepted();
          await sleep(1000);
          return;
        }
      } catch {}
    }

    for (const text of COOKIE_TEXT_PATTERNS) {
      for (const role of ["button", "link"]) {
        try {
          const el = page.getByRole(role, { name: text, exact: false }).first();
          if (await el.isVisible({ timeout: 800 })) {
            await el.click({ force: true });
            if (fmt?.cookieAccepted) fmt.cookieAccepted();
            await sleep(1000);
            return;
          }
        } catch {}
      }
    }
  } catch {}
}

export function isOnScopus(url) {
  const scopusBase = String(SETTINGS.scopusHomeUrl || "").toLowerCase();
  if (scopusBase) {
    try {
      const host = new URL(scopusBase).hostname.toLowerCase();
      return String(url || "").toLowerCase().includes(host);
    } catch {}
  }
  return String(url || "").toLowerCase().includes("scopus");
}

async function isSessionAuthenticated(page) {
  try {
    if (!isOnScopus(page.url())) return false;
    return await page.evaluate(() => {
      for (const link of document.querySelectorAll('a[href*="login"], a[href*="signin"], a[href*="authenticate"]')) {
        const text = (link.textContent || "").toLowerCase();
        if (text.includes("sign in") || text.includes("login") || text.includes("entrar")) return false;
      }
      return !!(
        document.querySelector('input[type="search"], input[name="query"], #search-input, [data-testid*="search"]') ||
        document.querySelector('[data-testid="header"], .nav-container, header nav')
      );
    }).catch(() => false);
  } catch {
    return false;
  }
}

async function navigateToScopus(page) {
  await page.goto(SETTINGS.scopusHomeUrl, {
    waitUntil: "load",
    timeout: SETTINGS.navigationTimeoutMs,
  });
}

export async function tryRedirectToScopus(page) {
  if (!SETTINGS.scopusHomeUrl) return false;
  try {
    await navigateToScopus(page);
    await sleep(2000);
    return isOnScopus(page.url());
  } catch {
    return false;
  }
}

export async function waitForScopus(page, timeoutMs = 300_000) {
  const start = Date.now();
  let lastLogAt = 0;
  let lastRedirectAttempt = 0;

  while (Date.now() - start < timeoutMs) {
    if (isOnScopus(page.url())) return true;
    await sleep(1500);

    const elapsed = Date.now() - start;

    if (elapsed - lastLogAt >= 20_000) {
      fmt.waitingScopus(page.url(), Math.round((timeoutMs - elapsed) / 1000));
      lastLogAt = elapsed;
    }

    if (elapsed >= 30_000 && elapsed - lastRedirectAttempt >= 30_000) {
      fmt.redirectAttempt();
      if (await tryRedirectToScopus(page)) return true;
      lastRedirectAttempt = elapsed;
    }
  }

  return false;
}

export async function checkSession(page) {
  try {
    await navigateToScopus(page);
    await sleep(3000);
    if (isOnScopus(page.url()) && await isSessionAuthenticated(page)) return true;
  } catch {}
  log.warn("Sessão expirada durante extração — re-autenticando...");
  await ensureSession(page);
  return true;
}

export async function ensureSession(page) {
  if (!SETTINGS.scopusHomeUrl || !SETTINGS.cafeAccessUrl) {
    throw new Error("SCOPUS_HOME_URL e CAFE_ACCESS_URL devem estar definidos no ambiente.");
  }

  fmt.session("checking");

  await restoreSessionCookies(page.context());

  try {
    await navigateToScopus(page);
    await sleep(5000);
  } catch {
    fmt.session("expired");
  }

  if (isOnScopus(page.url()) && await isSessionAuthenticated(page)) {
    fmt.session("active");
    await acceptCookies(page);
    return;
  }

  fmt.session("expired");

  await page.goto(SETTINGS.cafeAccessUrl, {
    waitUntil: "load",
    timeout: SETTINGS.navigationTimeoutMs,
  });

  await acceptCookies(page);

  const onLoad = cafeLoadHandler(page);
  page.on("load", onLoad);
  onLoad();

  fmt.loginInstructions();

  const redirected = await waitForScopus(page, 300_000);
  page.off("load", onLoad);

  if (!redirected) throw new Error("Timeout aguardando sessão no Scopus. Tente novamente.");

  fmt.session("active");
  await acceptCookies(page);
  await saveSessionCookies(page.context());
}
