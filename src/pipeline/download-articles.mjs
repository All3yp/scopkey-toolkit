import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { chromium } from "playwright";
import { PATHS, SETTINGS } from "../shared/config.mjs";
import { readJson, appendJsonl, sleep } from "../shared/utils.mjs";
import { log } from "../shared/logger.mjs";
import { acceptCookies, ensureSession, checkSession } from "../browser/session.mjs";

const MAX_RETRIES = 2;
const DEFAULT_CONCURRENCY = 1;

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

async function extractDOIFromPage(page) {
  return page.evaluate(() => {
    const doiEl = document.querySelector('[data-testid="document-details-doi"] a, a[href*="doi.org"]');
    if (!doiEl) return null;
    const match = doiEl.href.match(/doi\.org\/(10\.\d{4,}\/.+)/);
    return match ? match[1] : null;
  });
}

async function clickFullTextAndGetPublisherPage(context, page) {
  log.step("Aguardando renderização completa...");
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => sleep(3000));

  const allImgs = await page.evaluate(() =>
    [...document.querySelectorAll('img')].map(i => ({
      src: i.getAttribute('src') || '',
      alt: i.getAttribute('alt') || '',
      parentTag: i.parentElement?.tagName,
      closestBtn: !!i.closest('button'),
    }))
  );
  const relevant = allImgs.filter(i => i.src.includes('capes') || i.alt.toLowerCase().includes('full text') || i.closestBtn);
  log.step(`Imagens relevantes na página: ${JSON.stringify(relevant.slice(0, 5))}`);

  log.step("Procurando botão Full Text...");

  // Seletores baseados no HTML real do Scopus/CAPES:
  // <button><img src="...scopusbutton_capesbr.gif" alt="Full Text (opens in new window)"></button>
  const candidates = [
    page.locator('button:has(img[src*="capesbr"])').first(),
    page.locator('button:has(img[src*="capes"])').first(),
    page.locator('button:has(img[alt*="Full Text"])').first(),
    page.locator('button:has(img[alt="Full Text (opens in new window)"])').first(),
    page.locator('img[src*="capesbr"]').first(),
    page.locator('img[alt*="Full Text"]').first(),
  ];

  let btn = null;
  for (const candidate of candidates) {
    const visible = await candidate.isVisible({ timeout: 2000 }).catch(() => false);
    if (visible) {
      btn = candidate;
      const src = await candidate.getAttribute('src').catch(async () =>
        await candidate.locator('img').getAttribute('src').catch(() => '')
      );
      log.step(`Botão encontrado: src="${src}"`);
      break;
    }
  }

  if (!btn) {
    log.warn("Botão Full Text (CAPES) não encontrado");
    return null;
  }

  const popupPromise = context.waitForEvent('page', { timeout: 20000 }).catch(() => null);

  await btn.click();
  log.step("Clicado via Playwright, aguardando nova aba...");

  const popup = await popupPromise;
  if (popup) {
    log.step(`Nova aba: ${popup.url()}`);
    await popup.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await sleep(3000);
    return popup;
  }

  await sleep(5000);
  const pagesAfter = context.pages().length;
  log.step(`Pages após click: ${pagesAfter}`);

  const urlAfter = page.url();
  if (!urlAfter.includes('scopus.com')) {
    log.step(`Navegação na mesma aba: ${urlAfter}`);
    return page;
  }

  if (pagesAfter > 2) {
    const latest = context.pages()[context.pages().length - 1];
    log.step(`Aba extra detectada: ${latest.url()}`);
    return latest;
  }

  log.warn("Nenhuma navegação detectada");
  return null;
}

async function clickPDFAndDownload(publisherPage, downloadsDir, filename) {
  await publisherPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await sleep(2000);

  const pdfSelectors = [
    'a.xpl-btn-pdf',
    'a[href*="/stamp/stamp.jsp"]',
    '.xpl-btn-pdf',
    '[class*="pdf-btn"] a',
    'a[class*="pdf"]',
  ];

  let pdfHref = null;
  let pdfEl = null;

  for (const sel of pdfSelectors) {
    const el = publisherPage.locator(sel).first();
    const visible = await el.isVisible({ timeout: 3000 }).catch(() => false);
    if (visible) {
      pdfHref = await el.getAttribute('href').catch(() => null);
      pdfEl = el;
      log.step(`PDF button found: ${sel} href="${pdfHref}"`);
      break;
    }
  }

  if (!pdfHref && !pdfEl) {
    return { success: false, error: "no-pdf-button-found" };
  }

  const filepath = path.join(downloadsDir, filename);

  // Se tem href direto, navega para ele para forçar o download
  if (pdfHref) {
    const baseUrl = publisherPage.url().replace(/\/document\/.*/, '');
    const absoluteHref = pdfHref.startsWith('http') ? pdfHref : `${new URL(publisherPage.url()).origin}${pdfHref}`;
    log.step(`Navegando para PDF: ${absoluteHref}`);

    const context = publisherPage.context();
    const downloadPromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
    const pageDownloadPromise = publisherPage.waitForEvent('download', { timeout: 15000 }).catch(() => null);

    await pdfEl.click();

    const [download, newTab] = await Promise.all([
      pageDownloadPromise,
      downloadPromise,
    ]);

    if (download) {
      await download.saveAs(filepath);
      return { success: true, filename, filepath };
    }

    // Se abriu nova aba com o PDF, tenta capturar download dela
    if (newTab) {
      log.step(`Nova aba PDF: ${newTab.url()}`);
      const tabDownload = await newTab.waitForEvent('download', { timeout: 15000 }).catch(() => null);
      if (tabDownload) {
        await tabDownload.saveAs(filepath);
        return { success: true, filename, filepath };
      }
      const tabUrl = newTab.url();
      if (tabUrl.endsWith('.pdf') || tabUrl.includes('/pdf/') || tabUrl.includes('stamp')) {
        const resp = await publisherPage.context().request.get(tabUrl).catch(() => null);
        if (resp) {
          await fs.promises.writeFile(filepath, await resp.body());
          return { success: true, filename, filepath };
        }
      }
    }

    // Fallback: GET direto na URL do stamp
    log.step(`Tentando fetch direto: ${absoluteHref}`);
    const resp = await publisherPage.context().request.get(absoluteHref, {
      headers: { 'Accept': 'application/pdf,*/*' },
    }).catch(() => null);
    if (resp && resp.ok()) {
      await fs.promises.writeFile(filepath, await resp.body());
      return { success: true, filename, filepath };
    }
  }

  return { success: false, error: "download-failed" };
}

async function downloadArticlePDF(context, page, article, downloadsDir) {
  await page.goto(article.url, { waitUntil: "domcontentloaded", timeout: SETTINGS.navigationTimeoutMs });
  await acceptCookies(page);
  await sleep(2000);

  const doi = await extractDOIFromPage(page);
  const safeTitle = article.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const filename = `${article.id}_${safeTitle}.pdf`;

  try {
    const publisherPage = await clickFullTextAndGetPublisherPage(context, page);

    if (!publisherPage) {
      return { success: false, error: "no-publisher-access", doi };
    }

    await acceptCookies(publisherPage);
    await sleep(2000);

    const result = await clickPDFAndDownload(publisherPage, downloadsDir, filename);

    await publisherPage.close().catch(() => {});

    return {
      ...result,
      doi,
      publisherUrl: publisherPage.url(),
    };
  } catch (err) {
    return { success: false, error: err.message, doi };
  }
}

function listResultFiles(resultsDir) {
  try {
    return fs.readdirSync(resultsDir)
      .filter(f => /^results-.*\.jsonl$/i.test(f))
      .sort()
      .map(f => path.join(resultsDir, f));
  } catch (err) {
    log.error(`Erro lendo results: ${err.message}`);
    return [];
  }
}

function shouldUseAllResults() {
  return process.argv.slice(2).includes("--all-results");
}

function readAllResultsFromDir(resultsDir, { latestOnly = true } = {}) {
  const seen = new Set();
  const items = [];

  const files = listResultFiles(resultsDir);
  const selectedFiles = latestOnly && files.length > 0 ? [files.at(-1)] : files;

  for (const file of selectedFiles) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        const id = String(obj.id || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        items.push({
          id,
          title: obj.title,
          url: obj.sourceLink || obj.url,
        });
      } catch {}
    }
  }

  return { items, files: selectedFiles };
}

function readDoneDownloadIds(downloadsDir) {
  const ids = new Set();
  try {
    const files = fs.readdirSync(downloadsDir)
      .filter(f => /^downloads-.*\.jsonl$/i.test(f))
      .map(f => path.join(downloadsDir, f));

    for (const file of files) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          if (obj.id && obj.success) ids.add(String(obj.id));
        } catch {}
      }
    }
  } catch {}
  return ids;
}

async function saveDownloadResult(item, result) {
  appendJsonl(PATHS.downloads, {
    id: item.id,
    title: item.title,
    ...result,
    timestamp: new Date().toISOString(),
  });
}

export async function runArticleDownloader(context, page, items, { doneIds, concurrency = DEFAULT_CONCURRENCY, downloadsDir } = {}) {
  const done = doneIds ?? readDoneDownloadIds(PATHS.downloadsDir);
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
      const result = await downloadArticlePDF(context, workerPage, item, downloadsDir);

      if (result.success) {
        log.success(`Downloaded: ${result.filename}`);
        await saveDownloadResult(item, result);
        done.add(String(item.id));
        successCount++;
      } else {
        log.warn(`Failed: ${result.error}`);
        await saveDownloadResult(item, result);
        failCount++;
      }
    } catch (err) {
      log.error(err.message);
      await saveDownloadResult(item, { success: false, error: err.message });
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
      await sleep(SETTINGS.delayBetweenArticlesMs * 2);
    }
    return { successCount, failCount };
  }

  log.info(`⚡ Download paralelo: ${workers} abas`);
  const pages = [page];
  for (let w = 1; w < workers; w++) pages.push(await context.newPage());

  await Promise.all(pages.map(async workerPage => {
    let item;
    while ((item = nextItem())) {
      await processItem(workerPage, item);
      await sleep(SETTINGS.delayBetweenArticlesMs * 2);
    }
  }));

  for (let w = 1; w < pages.length; w++) await pages[w].close().catch(() => {});

  return { successCount, failCount };
}

async function main() {
  log.header("Download Articles (Incremental)");

  releaseStaleLock(PATHS.userDataDir);

  const latestOnly = !shouldUseAllResults();
  const { items, files } = readAllResultsFromDir(PATHS.resultsDir, { latestOnly });
  if (items.length === 0) {
    log.error("Nenhum resultado encontrado em resultsDir. Execute a extração primeiro.");
    process.exit(1);
  }

  log.info(`Modo: ${latestOnly ? "arquivo results mais recente" : "todos os arquivos results"}`);
  log.info(`Lendo: ${files.map(f => path.basename(f)).join(", ")}`);
  log.info(`Artigos únicos com keywords: ${items.length}`);

  const doneIds = readDoneDownloadIds(PATHS.downloadsDir);
  log.info(`Downloads já feitos: ${doneIds.size}`);

  const pending = items.filter(item => !doneIds.has(String(item.id)));
  log.info(`Pendentes: ${pending.length}`);

  if (pending.length === 0) {
    log.done("Todos os artigos já foram processados.");
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

    const { successCount, failCount } = await runArticleDownloader(context, page, items, {
      doneIds,
      concurrency: DEFAULT_CONCURRENCY,
      downloadsDir: PATHS.downloadsDir,
    });

    log.header("Download Complete");
    log.done(`${successCount} PDFs baixados`);
    if (failCount > 0) log.warn(`${failCount} falhas`);
    log.step(`Registros salvos em: ${PATHS.downloads}`);
    log.step(`PDFs em: ${PATHS.downloadsDir}`);
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
