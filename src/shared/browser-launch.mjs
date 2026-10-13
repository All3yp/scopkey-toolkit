import { chromium } from "playwright";
import { SETTINGS } from "./config.mjs";

export function isFirefoxExecutable(executablePath) {
  return Boolean(executablePath) && /firefox/i.test(executablePath);
}

export function launchBrowser(userDataDir) {
  const firefox = isFirefoxExecutable(SETTINGS.executablePath);
  const launchOptions = {
    headless: SETTINGS.headless,
    slowMo: SETTINGS.slowMo,
    viewport: null,
    // Firefox ignores Chromium flags; passing them risks a failed launch.
    args: firefox
      ? []
      : ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
  };
  if (SETTINGS.executablePath) {
    launchOptions.executablePath = SETTINGS.executablePath;
  }
  return chromium.launchPersistentContext(userDataDir, launchOptions);
}
