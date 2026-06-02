import { chromium } from "playwright";
import { PATHS, SETTINGS } from "../shared/config.mjs";
import { sleep } from "../shared/utils.mjs";
import { logger } from "../shared/logger.mjs";
import { acceptCookies, waitForScopus, saveSessionCookies } from "../browser/session.mjs";
import { cafeLoadHandler } from "../browser/cafe-auth.mjs";

async function main() {
  logger.header("CAFe Login → Scopus Session");

  if (!SETTINGS.cafeAccessUrl) throw new Error("CAFE_ACCESS_URL não definido no ambiente.");

  logger.step(`Chromium headless=${SETTINGS.headless}`);

  const launchOptions = {
    headless: SETTINGS.headless,
    slowMo: SETTINGS.slowMo,
    viewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
  };

  if (SETTINGS.executablePath) {
    logger.step(`Executable: ${SETTINGS.executablePath}`);
    launchOptions.executablePath = SETTINGS.executablePath;
  }

  const context = await chromium.launchPersistentContext(PATHS.userDataDir, launchOptions);
  const page = await context.newPage();
  logger.ok("Browser launched");

  logger.header("Opening CAFe");
  await page.goto(SETTINGS.cafeAccessUrl, { waitUntil: "load", timeout: SETTINGS.navigationTimeoutMs });
  await acceptCookies(page);

  const onLoad = cafeLoadHandler(page);
  page.on("load", onLoad);
  onLoad();

  logger.header("Waiting for Scopus session");
  const ok = await waitForScopus(page, 300_000);
  onLoad.disabled = true;
  page.off("load", onLoad);

  if (!ok) throw new Error("Timeout aguardando sessão no Scopus.");

  await acceptCookies(page);

  logger.header("Login Complete");
  logger.done(`Session saved to ${PATHS.userDataDir}.`);
  logger.step("npm run collect  ·  npm run extract");
  logger.divider();

  await saveSessionCookies(context);

  await sleep(2000);
  await context.close().catch(() => {});
  process.exit(0);
}

main().catch(err => { logger.error(String(err?.message || err)); process.exit(1); });
