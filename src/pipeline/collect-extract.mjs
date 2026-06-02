import { chromium } from "playwright";
import { PATHS, SETTINGS, translateIfNeeded } from "../shared/config.mjs";
import { appendJsonl, readAllDoneIds, sleep } from "../shared/utils.mjs";
import { log } from "../shared/logger.mjs";
import { fmt } from "../shared/formatter.mjs";
import { ensureSession } from "../browser/session.mjs";
import { runCollector } from "./collect-links.mjs";
import { extractKeywordsForArticle } from "./extract-keywords.mjs";

const queue = [];
let collectingDone = false;

async function translateKeywords(keywords) {
  const translated = [];
  for (const kw of keywords) {
    const result = await translateIfNeeded(kw);
    if (result !== kw) log.step(`Translated: "${kw}" → "${result}"`);
    translated.push(result);
  }
  return translated;
}

async function extractorLoop(page, doneIds) {
  let extracted = 0;
  while (true) {
    const item = queue.shift() ?? null;
    if (!item) {
      if (collectingDone && queue.length === 0) break;
      await sleep(500);
      continue;
    }
    const id = String(item.id);
    if (doneIds.has(id)) continue;

    log.article(extracted + 1, "?", item.title, item.url);
    try {
      const { keywords, source } = await extractKeywordsForArticle(page, item.url);
      const translatedKeywords = await translateKeywords(keywords);

      if (translatedKeywords.length === 0) {
        log.empty(source);
      } else {
        log.success(translatedKeywords);
        appendJsonl(PATHS.results, {
          id, title: item.title, keywords: translatedKeywords,
          originalKeywords: keywords.some((k, i) => k !== translatedKeywords[i]) ? keywords : undefined,
          source, sourceLink: item.url,
        });
        doneIds.add(id);
        extracted++;
      }
    } catch (err) {
      log.error(err.message);
      appendJsonl(PATHS.failures, {
        id, title: item.title, url: item.url,
        error: String(err), timestamp: new Date().toISOString(),
      });
    }
    await sleep(SETTINGS.delayBetweenArticlesMs);
  }
  return extracted;
}

async function main() {
  log.header("Collect + Extract (parallel)");

  const context = await chromium.launchPersistentContext(PATHS.userDataDir, {
    headless: SETTINGS.headless, slowMo: SETTINGS.slowMo, viewport: null,
    executablePath: SETTINGS.executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
  });

  try {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    await ensureSession(page1);
    await sleep(3000);

    const doneIds = readAllDoneIds(PATHS.resultsDir, PATHS.noKeywordsDir);

    const collectorPromise = runCollector(page1, { onBatch: pubs => queue.push(...pubs) })
      .catch(err => { log.error(`Collector error: ${err.message}`); return []; })
      .then(results => { collectingDone = true; return results; });

    const [collectResults, extractCount] = await Promise.all([
      collectorPromise,
      extractorLoop(page2, doneIds),
    ]);

    if (collectResults.length > 0) {
      fmt.finalSummary(collectResults, PATHS.collectDir);
    }

    log.header("Extraction Complete");
    log.done(`Extracted keywords from ${extractCount} articles`);
    log.step(`Results: ${PATHS.results}`);
    log.divider();
  } finally {
    await context.close();
  }
}

main().catch(err => { log.error(String(err?.message || err)); process.exit(1); });
