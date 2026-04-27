import { chromium } from "playwright";
import { PATHS, SETTINGS } from "../shared/config.mjs";
import { readJson, writeJson, sleep, findLatestLinks } from "../shared/utils.mjs";
import { buildScopusUrl, resolveScopusSort } from "../core/build-url.mjs";
import { log } from "../shared/logger.mjs";
import { fmt } from "../shared/formatter.mjs";
import { acceptCookies, ensureSession } from "../browser/session.mjs";

async function waitForResults(page) {
  await page.waitForSelector('a[href*="/pages/publications/"]', { timeout: 10000 }).catch(async () => {
    await ensureSession(page);
    await page.goto(SETTINGS.cafeAccessUrl, {
      waitUntil: "load",
      timeout: SETTINGS.navigationTimeoutMs
    });
  });
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

    return [...root.querySelectorAll('a[href*="/pages/publications/"]')]
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

function addUniquePublications(target, incoming, seenIds, maxResults) {
  let added = 0;
  for (const pub of incoming) {
    const id = String(pub.id || "");
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    target.push(pub);
    added++;
    if (target.length >= maxResults) break;
  }
  return added;
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
  return [(s.query || "").trim().toLowerCase(), s.yearFrom || "", s.yearTo || "", (s.docTypes || []).sort().join(",")].join("|");
}

export async function runCollector(page, { onBatch, existingResults = [], outputFile } = {}) {
  const searches = readJson(PATHS.searches, []);
  if (!searches.length) throw new Error("Arquivo data/input/searches.json não encontrado ou vazio.");

  const groups = new Map();
  for (const s of searches) {
    const key = queryKey(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const doneNames = new Set(existingResults.map(r => r.name));
  const results = [...existingResults];

  for (const [, group] of groups) {
    const pending = group.filter(s => !doneNames.has(s.name));
    if (!pending.length) { log.info(`⏩ Query "${group[0].query}" já coletada — pulando`); continue; }

    const maxOfGroup = Math.max(...group.map(s => s.maxResults ?? 100));
    const primary = group[0];
    const searchUrl = primary.url ?? buildScopusUrl({ ...primary, sortBy: "relevance" });

    if (group.length > 1) log.info(`Query "${primary.query}" aparece em ${group.length} buscas — coletando uma vez`);
    fmt.searchStart(primary.name, maxOfGroup, searchUrl);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: SETTINGS.navigationTimeoutMs });
    await sleep(3000);
    await acceptCookies(page);

    const perPage = await setDisplayPerPage(page, maxOfGroup);
    perPage ? fmt.displayAdjusted(perPage) : fmt.displayWarning();

    const totalDocs = await extractTotalDocuments(page);
    const effectiveMax = totalDocs && totalDocs > maxOfGroup ? totalDocs : maxOfGroup;
    if (totalDocs) log.info(`Scopus found ${totalDocs} documents${totalDocs > maxOfGroup ? ` (maxResults=${maxOfGroup} → collecting all ${totalDocs})` : ""}`);

    const collected = [];
    const seenIds = new Set();
    let pageNumber = 1;

    while (collected.length < effectiveMax) {
      const pubs = await extractPubsFromPage(page);
      const added = addUniquePublications(collected, pubs, seenIds, effectiveMax);
      fmt.pageProgress(pageNumber, pubs.length, added, collected.length, effectiveMax);

      if (onBatch && added > 0) {
        const newPubs = pubs.filter(p => seenIds.has(String(p.id)));
        if (newPubs.length > 0) onBatch(newPubs);
      }

      if (collected.length >= effectiveMax) break;
      if (!await goToNextResultsPage(page)) { fmt.paginationDone(); break; }
      pageNumber++;
      await sleep(1500);
    }

    const numberOfPages = await extractNumberOfPages(page);
    for (const s of group) {
      if (doneNames.has(s.name)) continue;
      const max = s.maxResults ?? 100;
      fmt.searchSummary(Math.min(collected.length, max), numberOfPages, max);
      results.push({
        name: s.name,
        url: s.url ?? buildScopusUrl(s),
        sort: resolveScopusSort(s),
        count: Math.min(collected.length, max),
        metadata: { numberOfPages },
        publications: collected.slice(0, max),
      });
    }

    if (outputFile) {
      writeJson(outputFile, results);
      log.step(`Progresso salvo (${results.length} buscas) → ${outputFile}`);
    }
  }

  return results;
}

async function main() {
  const existingFile = findLatestLinks(PATHS.collectDir);
  const existingResults = existingFile ? readJson(existingFile, []) : [];
  if (existingResults.length > 0) {
    log.info(`Resumindo — ${existingResults.length} buscas já coletadas: ${existingResults.map(r => r.name).join(", ")}`);
  }

  const context = await chromium.launchPersistentContext(PATHS.userDataDir, {
    headless: SETTINGS.headless, slowMo: SETTINGS.slowMo, viewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
  });

  try {
    const page = await context.newPage();
    await ensureSession(page);
    await sleep(3000);
    const results = await runCollector(page, { existingResults, outputFile: PATHS.links });
    writeJson(PATHS.links, results);
    fmt.finalSummary(results, PATHS.links);
  } finally {
    await context.close();
  }
}

main().catch(err => { log.error(String(err?.message || err)); process.exit(1); });
