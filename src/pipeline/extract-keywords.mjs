import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { PATHS, SETTINGS, translateIfNeeded } from "../shared/config.mjs";
import { readJson, appendJsonl, readAllDoneIds, readAllDoneIdsFromAllSessions, countFailures, findLatestLinksFiles, sleep } from "../shared/utils.mjs";
import { log } from "../shared/logger.mjs";
import { extractFromDOM, extractFromText } from "../core/keyword-extract.mjs";
import { extractAbstractFromDOM } from "../core/abstract-extract.mjs";
import { acceptCookies, ensureSession, checkSession } from "../browser/session.mjs";

const MAX_RETRIES = 2;
const DEFAULT_CONCURRENCY = 2;

function releaseStaleLock(userDataDir) {
  const lockPath = path.join(userDataDir, "SingletonLock");
  let target;
  try { target = fs.readlinkSync(lockPath); } catch { return; }

  const pid = Number(target.split("-").at(-1));
  if (!pid) return;

  try {
    process.kill(pid, 0);
    log.warn(`Atenção: o browser ainda está aberto (pid ${pid}).`);
    log.warn("Feche a janela do Chromium antes de continuar.");
    process.exit(1);
  } catch {
    fs.unlinkSync(lockPath);
    log.info(`Lock stale removido (pid ${pid} já encerrado).`);
  }
}

export async function extractKeywordsForArticle(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: SETTINGS.navigationTimeoutMs });
  await acceptCookies(page);

  await page
    .waitForSelector('#document-details-author-keywords, #document-details-indexed-keywords, [data-testid*="keyword" i]', { timeout: 5000 })
    .catch(() => sleep(1000));

  const abstract = await page.evaluate(extractAbstractFromDOM).catch(() => null);

  const domResult = await page.evaluate(extractFromDOM);
  if (domResult?.keywords.length > 0) return { keywords: domResult.keywords, source: domResult.source, groups: domResult.groups, abstract };

  const bodyText = await page.locator("body").innerText();
  const textKws = extractFromText(bodyText);
  if (textKws.length > 0) return { keywords: textKws, source: "text-fallback", abstract };

  const hasKeywordSection = await page.evaluate(() =>
    !!document.querySelector('[data-testid*="keyword" i], [id*="keyword" i]')
  );
  return { keywords: [], source: hasKeywordSection ? "empty-section" : "no-section", abstract };
}

async function translateKeywords(keywords) {
  const translated = [];
  for (const kw of keywords) {
    const result = await translateIfNeeded(kw);
    if (result !== kw) log.step(`Translated: "${kw}" → "${result}"`);
    translated.push(result);
  }
  return translated;
}

async function saveArticleResult(item, translatedKeywords, originalKeywords, source, groups, abstract) {
  appendJsonl(PATHS.results, {
    id: item.id,
    title: item.title,
    abstract: abstract ?? undefined,
    keywords: translatedKeywords,
    originalKeywords: originalKeywords.some((k, i) => k !== translatedKeywords[i]) ? originalKeywords : undefined,
    groups: groups?.length ? groups : undefined,
    source,
    sourceLink: item.url,
  });
}

async function saveArticleFailure(item, source, attempt) {
  appendJsonl(PATHS.failures, {
    id: item.id,
    title: item.title,
    url: item.url,
    error: source === "no-section" ? "no-keyword-section" : "empty-keyword-section",
    attempt,
    timestamp: new Date().toISOString(),
  });
}

async function saveArticleError(item, err) {
  appendJsonl(PATHS.failures, {
    id: item.id,
    title: item.title,
    url: item.url,
    error: String(err),
    timestamp: new Date().toISOString(),
  });
}

export async function runExtractor(page, items, { doneIds, concurrency = DEFAULT_CONCURRENCY } = {}) {
  const done = doneIds ?? readAllDoneIds(PATHS.resultsDir, PATHS.noKeywordsDir);
  const failCounts = countFailures(PATHS.failuresDir);
  const pending = items.filter(item => !done.has(String(item.id)));

  let successCount = 0;
  let failCount = 0;
  let cursor = 0;

  function nextItem() {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      if (!done.has(String(item.id))) return item;
    }
    return null;
  }

  async function processItem(workerPage, item) {
    log.article(cursor, pending.length, item.title, item.url);
    try {
      const { keywords, source, groups, abstract } = await extractKeywordsForArticle(workerPage, item.url);
      const translatedKeywords = await translateKeywords(keywords);

      if (translatedKeywords.length === 0) {
        const attempts = (failCounts.get(String(item.id)) || 0) + 1;
        failCounts.set(String(item.id), attempts);

        if (attempts >= MAX_RETRIES) {
          log.warn(`Sem keywords após ${attempts} tentativas — marcando como concluído (${source})`);
          appendJsonl(PATHS.noKeywords, { id: item.id, title: item.title, source, sourceLink: item.url });
          done.add(String(item.id));
        } else {
          log.empty(source);
        }

        await saveArticleFailure(item, source, attempts);
        failCount++;
      } else {
        log.success(translatedKeywords);
        await saveArticleResult(item, translatedKeywords, keywords, source, groups, abstract);
        done.add(String(item.id));
        successCount++;
      }
    } catch (err) {
      log.error(err.message);
      await saveArticleError(item, err);
      failCount++;
    }
  }

  const workers = Math.min(concurrency, pending.length);

  if (workers <= 1) {
    const SESSION_CHECK_INTERVAL = 50;
    let item;
    while ((item = nextItem())) {
      if (cursor > 1 && cursor % SESSION_CHECK_INTERVAL === 0) {
        log.step(`Session check (${cursor} articles processed)...`);
        await checkSession(page);
      }
      await processItem(page, item);
      await sleep(SETTINGS.delayBetweenArticlesMs);
    }
    return { successCount, failCount };
  }

  log.info(`⚡ Extração paralela: ${workers} abas`);
  const context = page.context();
  const pages = [page];
  for (let w = 1; w < workers; w++) pages.push(await context.newPage());

  await Promise.all(pages.map(async workerPage => {
    let item;
    while ((item = nextItem())) {
      await processItem(workerPage, item);
      await sleep(SETTINGS.delayBetweenArticlesMs);
    }
  }));

  for (let w = 1; w < pages.length; w++) await pages[w].close().catch(() => {});

  return { successCount, failCount };
}

function parseConcurrencyArg() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--concurrency" && args[i + 1]) {
      return Math.max(1, parseInt(args[++i], 10) || DEFAULT_CONCURRENCY);
    }
  }
  return DEFAULT_CONCURRENCY;
}

function deduplicateByField(items, field) {
  const seen = new Set();
  return items.filter(item => {
    const key = String(item[field] || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const concurrency = parseConcurrencyArg();

  // Load all links files across ALL collect sessions (parent dir)
  const allCollectDir = path.join(PATHS.collectDir, "..");
  const collectFiles = findLatestLinksFiles(allCollectDir, Infinity);

  if (collectFiles.length === 0) {
    log.error(`Nenhum arquivo links-*.json encontrado em ${allCollectDir}. Execute \`npm run collect\` primeiro.`);
    process.exit(1);
  }

  log.info(`Lendo ${collectFiles.length} arquivo(s) de links de todas as sessões de coleta`);
  const linksData = collectFiles.map(file => readJson(file, null)).filter(Boolean);
  const allItems = deduplicateByField(linksData.flatMap(s => (Array.isArray(s) ? s : [s]).flatMap(r => r.publications ?? [])), "id");

  if (allItems.length === 0) {
    log.error("Nenhum artigo encontrado. Execute `npm run collect` primeiro.");
    process.exit(1);
  }

  const extractParentDir = path.join(PATHS.extractDir, "..");
  const doneIds = readAllDoneIdsFromAllSessions(extractParentDir);
  const pendingCount = allItems.filter(item => !doneIds.has(String(item.id))).length;
  log.info(`Total: ${allItems.length}  |  Já processados: ${doneIds.size}  |  A processar: ${pendingCount}`);

  if (pendingCount === 0) { log.info("Todos os artigos já foram processados."); return; }

  releaseStaleLock(PATHS.userDataDir);

  const browser = await chromium.launchPersistentContext(PATHS.userDataDir, {
    headless: SETTINGS.headless,
    slowMo: SETTINGS.slowMo,
    viewport: null,
    executablePath: SETTINGS.executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
  });

  try {
    const page = await browser.newPage();
    await ensureSession(page);
    const { successCount, failCount } = await runExtractor(page, allItems, { doneIds, concurrency });
    log.summary(successCount, failCount, PATHS.results);
  } finally {
    await browser.close();
  }
}

main().catch(err => { log.error(String(err?.message || err)); process.exit(1); });
