import { chromium } from "playwright";
import { PATHS, SETTINGS } from "../shared/config.mjs";
import path from "node:path";
import { readJson, writeJson, readAllDoneIds, sleep, findLatestLinksFiles } from "../shared/utils.mjs";
import { buildScopusUrl, resolveScopusSort } from "../core/build-url.mjs";
import { log } from "../shared/logger.mjs";
import { fmt } from "../shared/formatter.mjs";
import { acceptCookies, ensureSession, checkSession, isOnScopus } from "../browser/session.mjs";

async function waitForResults(page) {
  await page.waitForSelector(
    'a[href*="/pages/publications/"], a[href*="record/display"], a[href*="/record/"]',
    { timeout: 10000 }
  ).catch(() => {});
  await sleep(800);
}

async function extractPubsFromPage(page) {
  await waitForResults(page);
  return page.evaluate(() => {
    const CONTAINER_SELECTORS = [
      '[data-testid="results-list"]', '#resultDataList',
      '.resultsList', 'ol[class*="result"]', 'ul[class*="result"]',
    ];
    let root = document.body;
    for (const sel of CONTAINER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) { root = el; break; }
    }

    function parseCitedBy(linkEl) {
      let row = linkEl;
      while (row && row.tagName !== "TR") row = row.parentElement;
      if (!row) return 0;
      const lastTd = [...row.querySelectorAll("td")].at(-1);
      if (!lastTd) return 0;
      const btn = lastTd.querySelector('button[title*="Cited by"]');
      if (btn) {
        const m = btn.getAttribute("title").match(/([\d,]+)/);
        if (m) return parseInt(m[1].replace(/,/g, ""), 10) || 0;
      }
      const n = parseInt((lastTd.textContent ?? "").trim().replace(/,/g, ""), 10);
      return !isNaN(n) ? n : 0;
    }

    function parseYear(linkEl) {
      let row = linkEl;
      while (row && row.tagName !== "TR") row = row.parentElement;
      if (row) {
        const yearEl = row.querySelector('[data-testid="document-publication-year"]');
        if (yearEl) { const n = parseInt(yearEl.textContent ?? ""); if (!isNaN(n) && n >= 1900) return n; }
      }
      let node = linkEl;
      for (let i = 0; i < 8; i++) {
        node = node.parentElement;
        if (!node || (node.textContent ?? "").length > 2000) break;
        const years = (node.textContent ?? "").match(/\b(20\d{2}|19\d{2})\b/g);
        if (years) return Math.max(...years.map(Number));
      }
      return null;
    }

    const allLinks = [...document.querySelectorAll("a[href]")]
      .map(a => a.href)
      .filter(h => h && !h.startsWith("javascript") && h.length > 10);
    const _sample = allLinks.slice(0, 20);

    const pubLinks = [
      ...root.querySelectorAll(
        'a[href*="/pages/publications/"], a[href*="record/display"], a[href*="/record/display.uri"]'
      )
    ];

    if (pubLinks.length === 0) {
      return { __debug__: _sample };
    }

    return pubLinks
      .map(a => {
        const m = a.href.match(/\/pages\/publications\/(\d+)/);
        if (!m || !a.innerText.trim()) return null;
        return { id: m[1], title: a.innerText.trim(), url: a.href, year: parseYear(a), citedBy: parseCitedBy(a) };
      })
      .filter(Boolean)
      .filter((x, i, arr) => arr.findIndex(y => y.id === x.id) === i);
  });
}

async function setDisplayPerPage(page, maxResults) {
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(2000);
    const select = page.locator('select:has(option[value="200"])').first();
    await select.waitFor({ state: "visible", timeout: 5000 });
    const options = await select.evaluate(el =>
      [...el.options].map(o => parseInt(o.value)).filter(v => !isNaN(v)).sort((a, b) => a - b)
    );
    const best = [...options].reverse().find(v => v <= maxResults) ?? options.at(-1);
    await select.scrollIntoViewIfNeeded();
    await select.selectOption(String(best));
    await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
    await sleep(2000);
    return best;
  } catch { return null; }
}

function addUniquePublications(target, incoming, seenIds, maxResults, excludeIds = new Set()) {
  const addedPubs = [];
  for (const pub of incoming) {
    const id = String(pub.id || "");
    if (!id || seenIds.has(id) || excludeIds.has(id)) continue;
    seenIds.add(id);
    target.push(pub);
    addedPubs.push(pub);
    if (target.length >= maxResults) break;
  }
  return addedPubs;
}

async function goToNextResultsPage(page) {
  const NAV_SELECTORS = [
    "div.document-results-list-layout nav",
    ".DocumentSearchResultsPage_documentSearchResultsPage__kIrPt nav",
    "nav[aria-label*='pagination' i]", "nav[class*='pagination' i]", "#main nav",
  ];
  let nav = null;
  for (const sel of NAV_SELECTORS) {
    const candidate = page.locator(sel).first();
    if (await candidate.isVisible({ timeout: 600 }).catch(() => false)) { nav = candidate; break; }
  }
  if (!nav) return false;

  const nextButton = nav.locator([
    'button[aria-label*="next" i]', 'a[aria-label*="next" i]',
    'button:has-text("Next")', 'a:has-text("Next")',
    'button:has-text("Próx")', 'a:has-text("Próx")',
  ].join(", ")).first();

  if (!await nextButton.isVisible({ timeout: 800 }).catch(() => false)) return false;

  const isDisabled = await nextButton.evaluate(el =>
    el.getAttribute("disabled") !== null ||
    String(el.getAttribute("aria-disabled") || "").toLowerCase() === "true" ||
    String(el.className || "").toLowerCase().includes("disabled")
  ).catch(() => true);
  if (isDisabled) return false;

  const beforeUrl = page.url();
  const beforeFirstId = (await extractPubsFromPage(page))[0]?.id ?? null;

  await nextButton.scrollIntoViewIfNeeded().catch(() => { });
  await sleep(SETTINGS.cafeStepDelayMs);
  await nextButton.click({ force: true }).catch(async () => nextButton.dispatchEvent("click").catch(() => { }));

  await page.waitForLoadState("domcontentloaded", { timeout: SETTINGS.navigationTimeoutMs }).catch(() => { });
  await sleep(3000);

  const afterFirstId = (await extractPubsFromPage(page))[0]?.id ?? null;
  return page.url() !== beforeUrl || afterFirstId !== beforeFirstId;
}

async function extractTotalDocuments(page) {
  try {
    const total = await page.evaluate(() => {
      const SELECTORS = [
        '[data-testid="results-count"]', '.results-count', '#resultCount',
        '[class*="resultCount" i]', '[class*="results-count" i]', 'span.resultsCount',
        '.docResultsCount', '#totalResultCount',
      ];
      for (const sel of SELECTORS) {
        const el = document.querySelector(sel);
        if (el) { const n = parseInt((el.textContent ?? "").replace(/[^\d]/g, "")); if (n > 0) return n; }
      }
      const m = document.body.innerText.match(/([\d,]+)\s+document/i);
      if (m) { const n = parseInt(m[1].replace(/,/g, "")); if (n > 0) return n; }
      return null;
    });
    return Number.isInteger(total) ? total : null;
  } catch { return null; }
}

async function extractNumberOfPages(page) {
  try {
    const n = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Pagination"], nav[aria-label*="pagination" i], nav[class*="pagination" i]');
      if (!nav) return null;
      const numbers = [...nav.querySelectorAll("button, a, span")]
        .map(el => (el.textContent ?? "").trim())
        .filter(t => /^\d+$/.test(t))
        .map(Number)
        .filter(n => Number.isFinite(n) && n > 0);
      return numbers.length ? Math.max(...numbers) : null;
    });
    return Number.isInteger(n) ? n : null;
  } catch { return null; }
}

function queryKey(s) {
  return [
    (s.query || "").trim().toLowerCase(),
    s.yearFrom || "",
    s.yearTo || "",
    (s.docTypes || []).sort().join(","),
    (s.categoryIds || []).sort().join(","),
    (s.sourceTitle || "").trim().toLowerCase(),
    (s.authors || []).sort().join(","),
    (s.affiliations || []).sort().join(","),
    (s.countries || []).sort().join(","),
    (s.conferences || []).sort().join(","),
    (s.publishers || []).sort().join(","),
    (s.language || "").trim().toLowerCase()
  ].join("|");
}

export async function runCollector(page, { onBatch, existingResults = [], excludeIds } = {}) {
  const searches = readJson(PATHS.searches, []);
  if (!searches.length) throw new Error("Arquivo data/input/searches.json não encontrado ou vazio.");
  const knownIds = excludeIds ?? readAllDoneIds(PATHS.resultsDir, PATHS.noKeywordsDir);

  const groups = new Map();
  for (const s of searches) {
    const key = queryKey(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const doneIds = new Set(existingResults.map(r => r.id));
  const results = [...existingResults];

  for (const [, group] of groups) {
    const pending = group.filter(s => !doneIds.has(s.id));
    if (!pending.length) { log.info(`⏩ Query "${group[0].query}" já coletada — pulando`); continue; }

    const primary = group[0];
    const searchUrl = primary.url ?? buildScopusUrl(primary);

    if (group.length > 1) log.info(`Query "${primary.query}" aparece em ${group.length} buscas — coletando uma vez`);
    fmt.searchStart(primary.id, "?", searchUrl);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: SETTINGS.navigationTimeoutMs });
    await sleep(3000);
    await acceptCookies(page);

    const currentUrl = page.url();
    if (!isOnScopus(currentUrl) || currentUrl.includes("signIn") || currentUrl.includes("signin") || currentUrl.includes("login")) {
      log.warn("Sessão perdida após navegação — re-autenticando...");
      await ensureSession(page);
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: SETTINGS.navigationTimeoutMs });
      await sleep(3000);
    }

    const perPage = await setDisplayPerPage(page, 200);
    perPage ? fmt.displayAdjusted(perPage) : fmt.displayWarning();

    const totalDocs = await extractTotalDocuments(page);
    if (totalDocs) log.info(`Scopus encontrou ${totalDocs} documentos`);

    const collected = [];
    const seenIds = new Set();
    let pageNumber = 1;

    while (true) {
      const raw = await extractPubsFromPage(page);
      if (raw?.__debug__) {
        log.warn("Seletor de artigos não encontrou resultados. Sample de links na página:");
        for (const href of raw.__debug__) log.info("  " + href);
        break;
      }
      const pubs = Array.isArray(raw) ? raw : [];
      const addedPubs = addUniquePublications(collected, pubs, seenIds, Infinity, knownIds);
      fmt.pageProgress(pageNumber, pubs.length, addedPubs.length, collected.length, totalDocs ?? "?");

      if (onBatch && addedPubs.length > 0) onBatch(addedPubs);
      if (!await goToNextResultsPage(page)) { fmt.paginationDone(); break; }
      pageNumber++;
      await sleep(1500);
    }

    const numberOfPages = await extractNumberOfPages(page);
    for (const s of group) {
      if (doneIds.has(s.id)) continue;
      const displayTotal = totalDocs ?? collected.length;
      fmt.searchSummary(collected.length, numberOfPages, displayTotal);
      const builtUrl = s.url ?? buildScopusUrl(s);
      const entry = {
        id: s.id,
        query: s.query,
        exclusion: s.exclusion,
        url: builtUrl,
        sort: resolveScopusSort(s),
        count: collected.length,
        total: displayTotal,
        metadata: { numberOfPages },
        publications: collected,
      };
      results.push(entry);
      doneIds.add(s.id);

      if (collected.length === 0) {
        log.warn(`Nenhum artigo coletado para "${s.id}" — arquivo não salvo.`);
        continue;
      }
      const searchFile = path.join(PATHS.collectDir, `links-${s.id}-${PATHS.sessionTs}.json`);
      writeJson(searchFile, entry);
      log.step(`Salvo → ${searchFile}`);
    }
  }

  return results;
}

async function main() {
  const existingFiles = findLatestLinksFiles(PATHS.collectDir, Infinity);
  const existingResults = existingFiles.flatMap(f => {
    const data = readJson(f, null);
    return data ? [data] : [];
  });
  if (existingResults.length > 0) {
    log.info(`Resumindo — ${existingResults.length} buscas já coletadas: ${existingResults.map(r => r.id).join(", ")}`);
  }

  const context = await chromium.launchPersistentContext(PATHS.userDataDir, {
    headless: SETTINGS.headless, slowMo: SETTINGS.slowMo, viewport: null,
    executablePath: SETTINGS.executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
  });

  try {
    const page = await context.newPage();
    await ensureSession(page);
    await sleep(3000);
    const results = await runCollector(page, { existingResults });
    fmt.finalSummary(results, PATHS.collectDir);
  } finally {
    await context.close();
  }
}

main().catch(err => { log.error(String(err?.message || err)); process.exit(1); });
