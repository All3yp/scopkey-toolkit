import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { chromium } from "playwright";
import { PATHS, SETTINGS } from "../shared/config.mjs";
import { readJson, appendJsonl, sleep } from "../shared/utils.mjs";
import { log } from "../shared/logger.mjs";
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

export async function extractAbstractForArticle(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: SETTINGS.navigationTimeoutMs });
  await acceptCookies(page);

  await page
    .waitForSelector('[id="document-details-abstract"]', { timeout: 5000 })
    .catch(() => sleep(1000));

  const abstract = await page.evaluate(extractAbstractFromDOM);
  if (abstract) return { abstract, source: "dom" };

  return { abstract: null, source: "no-abstract" };
}

function readExistingResults(extractParentDir) {
  const items = [];
  const seenIds = new Set();
  try {
    for (const sessionEntry of fs.readdirSync(extractParentDir, { withFileTypes: true })) {
      if (!sessionEntry.isDirectory()) continue;
      const resultsDir = path.join(extractParentDir, sessionEntry.name, "results");
      let files;
      try { files = fs.readdirSync(resultsDir).filter(f => /^results-.*\.jsonl$/i.test(f)).map(f => path.join(resultsDir, f)); }
      catch { continue; }
      for (const file of files) {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed);
            if (obj.id && obj.sourceLink && !seenIds.has(String(obj.id))) {
              seenIds.add(String(obj.id));
              items.push({ id: String(obj.id), title: obj.title, url: obj.sourceLink });
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    log.error(`Erro lendo resultados: ${err.message}`);
  }
  return items;
}

function readDoneAbstractIds(extractParentDir) {
  const ids = new Set();
  try {
    for (const sessionEntry of fs.readdirSync(extractParentDir, { withFileTypes: true })) {
      if (!sessionEntry.isDirectory()) continue;
      const abstractsDir = path.join(extractParentDir, sessionEntry.name, "abstracts");
      let files;
      try { files = fs.readdirSync(abstractsDir).filter(f => /^abstracts-.*\.jsonl$/i.test(f)).map(f => path.join(abstractsDir, f)); }
      catch { continue; }
      for (const file of files) {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try { const obj = JSON.parse(trimmed); if (obj.id) ids.add(String(obj.id)); } catch {}
        }
      }
    }
  } catch {}
  return ids;
}

async function saveAbstractResult(item, abstract) {
  appendJsonl(PATHS.abstracts, {
    id: item.id,
    title: item.title,
    abstract,
    sourceLink: item.url,
    extractedAt: new Date().toISOString(),
  });
}

async function saveAbstractFailure(item, source, attempt) {
  appendJsonl(PATHS.failures, {
    id: item.id,
    title: item.title,
    url: item.url,
    error: source === "no-abstract" ? "no-abstract-section" : "abstract-extraction-failed",
    attempt,
    timestamp: new Date().toISOString(),
  });
}

export async function runAbstractExtractor(page, items, { doneIds, concurrency = DEFAULT_CONCURRENCY } = {}) {
  const done = doneIds ?? readDoneAbstractIds(PATHS.abstractsDir);
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
      const { abstract, source } = await extractAbstractForArticle(workerPage, item.url);

      if (!abstract) {
        log.empty(source);
        await saveAbstractFailure(item, source, 1);
        failCount++;
      } else {
        log.success(`Abstract: ${abstract.slice(0, 100)}...`);
        await saveAbstractResult(item, abstract);
        done.add(String(item.id));
        successCount++;
      }
    } catch (err) {
      log.error(err.message);
      await saveAbstractFailure(item, "error", 1);
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

async function main() {
  log.header("Extract Abstracts (Incremental)");

  releaseStaleLock(PATHS.userDataDir);

  const extractParentDir = path.join(PATHS.extractDir, "..");
  const items = readExistingResults(extractParentDir);
  if (items.length === 0) {
    log.error("Nenhum resultado encontrado. Execute a extração de keywords primeiro.");
    process.exit(1);
  }

  log.info(`Artigos com keywords extraídas: ${items.length}`);

  const doneIds = readDoneAbstractIds(extractParentDir);
  log.info(`Abstracts já extraídos: ${doneIds.size}`);

  const pending = items.filter(item => !doneIds.has(String(item.id)));
  log.info(`Pendentes: ${pending.length}`);

  if (pending.length === 0) {
    log.done("Todos os artigos já possuem abstracts extraídos.");
    return;
  }

  const context = await chromium.launchPersistentContext(PATHS.userDataDir, {
    headless: SETTINGS.headless,
    slowMo: SETTINGS.slowMo,
    viewport: null,
    executablePath: SETTINGS.executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
  });

  try {
    const page = await context.newPage();
    await ensureSession(page);

    const { successCount, failCount } = await runAbstractExtractor(page, items, { doneIds, concurrency: DEFAULT_CONCURRENCY });

    log.header("Abstract Extraction Complete");
    log.done(`${successCount} abstracts extraídos`);
    if (failCount > 0) log.warn(`${failCount} falhas`);
    log.step(`Abstracts salvos em: ${PATHS.abstracts}`);
    log.divider();
  } finally {
    await context.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    log.error(err.message);
    process.exit(1);
  });
}
