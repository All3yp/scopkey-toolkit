import { launchBrowser } from "../shared/browser-launch.mjs";
import { PATHS, SETTINGS } from "../shared/config.mjs";
import { appendJsonl, readAllDoneIds, countFailures, parseSearchesArg, sleep } from "../shared/utils.mjs";
import { log } from "../shared/logger.mjs";
import { fmt } from "../shared/formatter.mjs";
import { ensureSession } from "../browser/session.mjs";
import { runCollector } from "./collect-links.mjs";
import { processArticle } from "./extract-keywords.mjs";

const queue = [];
let collectingDone = false;

async function extractorLoop(page, doneIds) {
  let extracted = 0;
  const failCounts = countFailures(PATHS.failuresDir);
  while (true) {
    const item = queue.shift() ?? null;
    if (!item) {
      if (collectingDone && queue.length === 0) break;
      await sleep(500);
      continue;
    }
    if (doneIds.has(String(item.id))) continue;

    log.article(extracted + 1, "?", item.title, item.url);
    try {
      const { status } = await processArticle(page, item, { failCounts, doneIds });
      if (status === "ok") extracted++;
    } catch (err) {
      log.error(err.message);
      appendJsonl(PATHS.failures, {
        id: String(item.id), title: item.title, url: item.url,
        error: String(err), timestamp: new Date().toISOString(),
      });
    }
    await sleep(SETTINGS.delayBetweenArticlesMs);
  }
  return extracted;
}

async function main() {
  log.header("Collect + Extract (parallel)");

  const searchesFile = parseSearchesArg() ?? PATHS.searches;
  if (searchesFile !== PATHS.searches) log.info(`Arquivo de buscas customizado: ${searchesFile}`);

  const context = await launchBrowser(PATHS.userDataDir);

  try {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    await ensureSession(page1);
    await sleep(3000);

    const doneIds = readAllDoneIds(PATHS.resultsDir, PATHS.noKeywordsDir);

    const collectorPromise = runCollector(page1, { onBatch: pubs => queue.push(...pubs), searchesFile })
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
