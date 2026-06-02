import { SETTINGS } from "../shared/config.mjs";
import { sleep } from "../shared/utils.mjs";
import { log } from "../shared/logger.mjs";

const INSTITUTION_FORM_SELECTOR     = ".acesso-cafe-form";
const INSTITUTION_INPUT_SELECTOR    = "#select-simple";
const INSTITUTION_TRIGGER_SELECTOR  = 'button[data-trigger], button[aria-label*="Exibir lista" i]';
const INSTITUTION_SUBMIT_SELECTOR   = "#enviarInstituicaoCafe";

function cssAttrValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function openInstitutionDropdown(form) {
  const trigger = form.locator(INSTITUTION_TRIGGER_SELECTOR).first();
  if (await trigger.isVisible({ timeout: 500 }).catch(() => false)) {
    await trigger.click().catch(() => {});
    await sleep(SETTINGS.cafeStepDelayMs);
  }
}

async function fillInstitutionSearch(form, text) {
  if (!text) return;
  const input = form.locator(INSTITUTION_INPUT_SELECTOR).first();
  if (!await input.isVisible({ timeout: 700 }).catch(() => false)) return;
  try {
    await input.click();
    await input.fill("");
    await input.type(text, { delay: 80 });
    await input.press("ArrowDown").catch(() => {});
    await sleep(SETTINGS.cafeStepDelayMs);
    log.step(`Institution search: ${text}`);
  } catch {
    log.warn("Failed to fill institution search field.");
  }
}

async function selectInstitutionById(form, institutionId) {
  if (!institutionId) return false;

  const id = cssAttrValue(institutionId);
  const label = form.locator(`label[for="${id}"]`).first();

  if (await label.isVisible({ timeout: 700 }).catch(() => false)) {
    await label.click().catch(() => {});
    await sleep(SETTINGS.cafeStepDelayMs);
  }

  const selected = await form.evaluate((root, rawId) => {
    const radio = root.querySelector(`input[id="${rawId}"]`);
    if (!radio) return false;
    if (!radio.checked) {
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      radio.dispatchEvent(new Event("input",  { bubbles: true }));
    }
    return radio.checked;
  }, institutionId).catch(() => false);

  if (!selected) return false;

  const selectedLabel = form.locator(`label[for="${id}"]`).first();
  const txt = await selectedLabel.textContent().then(t => t?.trim()).catch(() => null);
  log.ok(txt ? `Selected: ${txt}` : `Selected by ID: ${institutionId}`);
  return true;
}

async function clickInstitutionSubmit(page) {
  const submit = page.locator(INSTITUTION_SUBMIT_SELECTOR).first();
  if (!await submit.isVisible({ timeout: 1200 }).catch(() => false)) return false;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const clicked = await submit.click({ force: true }).then(() => true).catch(() => false);
    if (!clicked) {
      await page.evaluate(sel => document.querySelector(sel)?.click(), INSTITUTION_SUBMIT_SELECTOR).catch(() => {});
    }
    log.step(`Submit clicked (attempt ${attempt}/3)...`);

    try {
      await page.waitForSelector(INSTITUTION_FORM_SELECTOR, { state: "hidden", timeout: 8000 });
      log.ok("Institution confirmed → login page loaded");
      return true;
    } catch {
      const stillVisible = await page.locator(INSTITUTION_FORM_SELECTOR).first()
        .isVisible({ timeout: 500 }).catch(() => false);
      if (!stillVisible) { log.ok("Institution confirmed → navigation detected"); return true; }
    }

    log.warn(`Submit click had no effect (attempt ${attempt}/3)`);
    await sleep(SETTINGS.cafeStepDelayMs);
  }
  return false;
}

async function trySelectInstitution(page) {
  const form = page.locator(INSTITUTION_FORM_SELECTOR).first();
  if (!await form.isVisible({ timeout: 900 }).catch(() => false)) return false;

  await openInstitutionDropdown(form);
  await fillInstitutionSearch(form, SETTINGS.cafeInstitutionId);

  let selected = SETTINGS.cafeInstitutionId
    ? await selectInstitutionById(form, SETTINGS.cafeInstitutionId)
    : false;

  if (!selected) {
    const selectedLabel = form.locator(".br-list .br-item.selected > div > label").first();
    if (await selectedLabel.isVisible({ timeout: 700 }).catch(() => false)) {
      await selectedLabel.click().catch(() => {});
      await sleep(SETTINGS.cafeStepDelayMs);
      log.ok("Selected item from list clicked");
      selected = true;
    }
  }

  return selected ? clickInstitutionSubmit(page) : false;
}

async function tryFillInstitutionLogin(page) {
  const { cafeUsername: username, cafePassword: password, cafeLoginAutofillMode: mode, cafeAutoClickLogin } = SETTINGS;
  const fillUsername = mode === "username" || mode === "both";
  const fillPassword = mode === "password" || mode === "both";

  const passwordField = page.locator('input#password, input[name="j_password"], input[name="password"]').first();
  if (!await passwordField.isVisible({ timeout: 700 }).catch(() => false)) return false;

  const USER_SELECTORS = [
    'input[name="j_username"]',
    'input[name="username"]',
    'input[id="username"]',
    'input[name="uid"]',
    'input[autocomplete="username"]',
  ];

  let filledAny = false;

  if (fillUsername && username) {
    for (const sel of USER_SELECTORS) {
      const el = page.locator(sel).first();
      if (!await el.isVisible({ timeout: 400 }).catch(() => false)) continue;
      await el.fill(username).catch(() => {});
      await sleep(SETTINGS.cafeStepDelayMs);
      log.ok(`Username filled (${sel})`);
      filledAny = true;
      break;
    }
  }

  let hasPasswordField = false;
  if (fillPassword && password) {
    hasPasswordField = await passwordField.isVisible({ timeout: 700 }).catch(() => false);
    if (hasPasswordField) {
      await passwordField.fill(password).catch(() => {});
      await sleep(SETTINGS.cafeStepDelayMs);
      log.ok("Password filled");
      filledAny = true;
    }
  }

  if (filledAny && hasPasswordField) {
    await tryClickLoginButton(page, cafeAutoClickLogin);
  } else if (filledAny) {
    log.step('Field filled per config. Complete and click "Login".');
  }

  return filledAny;
}

async function tryClickLoginButton(page, autoClick) {
  const LOGIN_BUTTON_SELECTORS = [
    "#btn-login", "#login",
    "input[type='submit']", "button[type='submit']",
    'button:has-text("Entrar")', 'button:has-text("Login")',
    'button:has-text("Acessar")', 'button:has-text("Continuar")',
    'input[value="Entrar"]', 'input[value="Login"]', 'input[value="Acessar"]',
  ];

  let loginButton = null;
  for (const sel of LOGIN_BUTTON_SELECTORS) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      loginButton = btn;
      log.step(`Login button found: ${sel}`);
      break;
    }
  }

  if (!loginButton) { log.step('Fields filled. Click "Login" manually.'); return; }

  if (autoClick) {
    await loginButton.click().catch(() => {});
    log.ok("Login button clicked");
    await sleep(3000);
    const targetUrl = SETTINGS.scopusResultsUrl || SETTINGS.scopusHomeUrl;
    if (targetUrl && !page.url().includes("scopus")) {
      log.step("Navigating to Scopus Results...");
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    }
  } else {
    log.step('Fields filled. Click login button manually.');
    log.step("Scopus Results will open in 5 seconds after login...");
    await sleep(5000);
    const targetUrl = SETTINGS.scopusResultsUrl || SETTINGS.scopusHomeUrl;
    if (targetUrl && !page.url().includes("scopus")) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    }
  }
}

export function cafeLoadHandler(page) {
  const handler = () => {
    if (handler.disabled) return;
    trySelectInstitution(page).catch(() => {});
    tryFillInstitutionLogin(page).catch(() => {});
  };
  handler.disabled = false;
  return handler;
}
