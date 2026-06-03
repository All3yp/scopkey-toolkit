import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { chromium } from "playwright";
import { PATHS, SETTINGS } from "../shared/config.mjs";
import { readJson, appendJsonl, sleep, ensureDir } from "../shared/utils.mjs";
import { log } from "../shared/logger.mjs";
import { acceptCookies, ensureSession, checkSession } from "../browser/session.mjs";

const MAX_RETRIES = 2;
const DEFAULT_CONCURRENCY = 1;

const DEDUPED_FILE = path.join(PATHS.outputDir, "extract", "deduped", "articles-deduped.jsonl");
const DOWNLOADS_DIR = path.join(PATHS.outputDir, "extract", "downloads");
const DOWNLOADS_LOG = path.join(DOWNLOADS_DIR, "logs", `downloads-${PATHS.sessionTs}.jsonl`);

const IEEE_BASE_URL = process.env.IEEE_ARTICLE_URL ?? "https://ieeexplore-ieee-org.ez138.periodicos.capes.gov.br/document/";
const IEEE_PDF_XPATH = '/html/body/div[7]/div/div/div[4]/div/xpl-root/main/div/xpl-document-details/div/div[1]/section[2]/div/xpl-document-header/section/div[2]/div/div/div[1]/div/div[1]/div/div[3]';

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

async function clickViewPDFAndGetPage(context, page) {
  log.step("Aguardando renderização completa...");
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => sleep(3000));

  log.step("Procurando botão View PDF / Full Text...");

  const candidates = [
    { locator: page.locator('button').filter({ hasText: /^View PDF/i }).first(), label: 'View PDF (texto)' },
    { locator: page.locator('button:has(img[src*="capesbr"])').first(), label: 'Full Text (img capesbr)' },
    { locator: page.locator('button:has(img[src*="capes"])').first(), label: 'Full Text (img capes)' },
    { locator: page.locator('button:has(img[alt*="Full Text"])').first(), label: 'Full Text (img alt)' },
  ];

  let btn = null;
  let label = '';
  for (const c of candidates) {
    const visible = await c.locator.isVisible({ timeout: 2000 }).catch(() => false);
    if (visible) { btn = c.locator; label = c.label; break; }
  }

  if (!btn) {
    log.warn("Nenhum botão View PDF / Full Text encontrado");
    return null;
  }

  log.step(`Botão encontrado: "${label}"`);
  const popupPromise = context.waitForEvent('page', { timeout: 20000 }).catch(() => null);
  await btn.click();

  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});

    let waited = 0;
    let currentUrl = await popup.evaluate(() => document.URL);

    while (!/\/document\/\d+/.test(currentUrl) && waited < 30000) {
      await sleep(500);
      waited += 500;
      currentUrl = await popup.evaluate(() => document.URL);
    }

    if (!/\/document\/\d+/.test(currentUrl)) {
      log.warn(`Timeout aguardando ID. URL: ${currentUrl}`);
    } else {
      log.step(`Aguardado ${waited}ms para ID`);
    }
    log.step(`Nova aba: ${currentUrl}`);
    return popup;
  }

  await sleep(3000);
  const pages = context.pages();
  if (pages.length > 1) {
    const latest = pages[pages.length - 1];
    log.step(`Aba detectada: ${latest.url()}`);
    return latest;
  }

  log.warn("Nenhuma nova aba detectada após clique");
  return null;
}

function extractIEEEArticleId(url) {
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch {}
  const patterns = [
    /\/document\/(\d+)/i,
    /[?&]arnumber=(\d+)/i,
    /\/(\d+)\.pdf/i,
  ];
  for (const p of patterns) {
    const m = decoded.match(p);
    if (m) return m[1];
  }
  return null;
}

function isIEEEUrl(url) {
  return /ieee\.org/i.test(url);
}

function remapToProxy(url) {
  try {
    const u = new URL(url);
    const proxyBase = new URL(IEEE_BASE_URL);
    u.hostname = proxyBase.hostname;
    u.port = proxyBase.port;
    u.protocol = proxyBase.protocol;
    return u.toString();
  } catch {
    return url;
  }
}

async function fetchPDFFromStampPage(context, stampUrl, filepath) {
  const stampPage = await context.newPage();
  try {
    log.step(`IEEE: navegando para stamp: ${stampUrl}`);
    await stampPage.goto(stampUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await stampPage.waitForTimeout(3000);

    const pageUrl = stampPage.url();
    log.step(`IEEE: stamp page URL: ${pageUrl}`);

    const getPdfUrl = await stampPage.evaluate(() => {
      const el = document.querySelector('iframe[src*="getPDF"], embed[src*="getPDF"], iframe[src*="pdf"], embed[src*="pdf"]');
      return el ? el.src || el.getAttribute('src') : null;
    });

    if (!getPdfUrl) {
      log.warn('IEEE: iframe getPDF não encontrado');
      return false;
    }

    const proxyUrl = remapToProxy(getPdfUrl);
    log.step(`IEEE: getPDF URL: ${proxyUrl}`);

    const result = await stampPage.evaluate(async (url) => {
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) return { error: `status ${r.status}` };
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('pdf')) return { error: `content-type ${ct}` };
        const buf = await r.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buf);
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return { base64: btoa(binary) };
      } catch (e) {
        return { error: e.message };
      }
    }, proxyUrl).catch((e) => ({ error: e.message }));

    if (result.error) {
      log.warn(`IEEE: fetch falhou: ${result.error}`);
      return false;
    }

    await fs.promises.writeFile(filepath, Buffer.from(result.base64, 'base64'));
    return true;
  } finally {
    await stampPage.close().catch(() => {});
  }
}

async function downloadIEEEPDF(context, ieeeUrl, downloadsDir, filename) {
  log.step(`IEEE proxy: navegando para ${ieeeUrl}`);
  const ieeePage = await context.newPage();
  try {
    await ieeePage.goto(ieeeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await ieeePage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await sleep(2000);

    const stampHref = await ieeePage.evaluate(() => {
      const el = document.querySelector('a.xpl-btn-pdf[href*="stamp.jsp"], a[href*="stamp.jsp"]');
      return el ? el.getAttribute('href') : null;
    });

    if (stampHref) {
      const origin = new URL(ieeeUrl).origin;
      const stampRaw = stampHref.startsWith('http') ? stampHref : `${origin}${stampHref}`;
      const stampUrl = remapToProxy(stampRaw);
      const filepath = path.join(downloadsDir, filename);
      log.step(`IEEE: baixando via stamp: ${stampUrl}`);
      const ok = await fetchPDFFromStampPage(context, stampUrl, filepath).catch(() => false);
      if (ok) {
        log.step(`IEEE: PDF salvo em ${filepath}`);
        return { success: true, filename, filepath };
      }
    }

    log.warn('IEEE: nenhuma estratégia funcionou');
    return { success: false, error: 'ieee-pdf-not-found' };
  } finally {
    await ieeePage.close().catch(() => {});
  }
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

    if (newTab) {
      log.step(`Nova aba PDF: ${newTab.url()}`);
      const tabDownload = await newTab.waitForEvent('download', { timeout: 15000 }).catch(() => null);
      if (tabDownload) {
        await tabDownload.saveAs(filepath);
        return { success: true, filename, filepath };
      }
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
    const publisherPage = await clickViewPDFAndGetPage(context, page);

    if (!publisherPage) {
      return { success: false, error: "no-publisher-access", doi };
    }

    await acceptCookies(publisherPage).catch(() => {});
    await sleep(1500);

    const publisherUrl = publisherPage.url();
    log.step(`Publisher URL: ${publisherUrl}`);

    if (isIEEEUrl(publisherUrl)) {
      const ieeeId = extractIEEEArticleId(publisherUrl);
      if (!ieeeId) {
        log.warn(`IEEE URL sem ID de artigo: ${publisherUrl}`);
        await publisherPage.close().catch(() => {});
        return { success: false, error: 'ieee-no-article-id', doi, publisherUrl };
      }
      log.step(`IEEE article ID detectado: ${ieeeId}`);
      await publisherPage.close().catch(() => {});

      if (publisherUrl.includes('stamp.jsp')) {
        const stampProxyUrl = remapToProxy(publisherUrl);
        const filepath = path.join(downloadsDir, filename);
        const ok = await fetchPDFFromStampPage(context, stampProxyUrl, filepath).catch(() => false);
        if (ok) return { success: true, filename, filepath, doi, publisherUrl };
      }

      const ieeeUrl = `${IEEE_BASE_URL}${ieeeId}`;
      const result = await downloadIEEEPDF(context, ieeeUrl, downloadsDir, filename);
      return { ...result, doi, publisherUrl };
    }

    const result = await clickPDFAndDownload(publisherPage, downloadsDir, filename);
    await publisherPage.close().catch(() => {});
    return { ...result, doi, publisherUrl };
  } catch (err) {
    return { success: false, error: err.message, doi };
  }
}

function readFromDeduped(dedupedFile) {
  const items = [];
  let lines;
  try {
    lines = fs.readFileSync(dedupedFile, "utf8").split("\n");
  } catch {
    return items;
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      const id = String(obj.id || "");
      if (!id) continue;
      items.push({
        id,
        title: obj.title,
        url: obj.sourceLink || obj.url,
      });
    } catch {}
  }
  return items;
}

function readDoneDownloadIds() {
  const logsDir = path.join(DOWNLOADS_DIR, "logs");
  const ids = new Set();
  try {
    const files = fs.readdirSync(logsDir)
      .filter(f => /^downloads-.*\.jsonl$/i.test(f))
      .map(f => path.join(logsDir, f));

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
  appendJsonl(DOWNLOADS_LOG, {
    id: item.id,
    title: item.title,
    ...result,
    timestamp: new Date().toISOString(),
  });
}

export async function runArticleDownloader(context, page, items, { doneIds, concurrency = DEFAULT_CONCURRENCY, downloadsDir } = {}) {
  const done = doneIds ?? readDoneDownloadIds();
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

  const items = readFromDeduped(DEDUPED_FILE);
  if (items.length === 0) {
    log.error(`Nenhum artigo encontrado em ${DEDUPED_FILE}. Execute npm run dedupe primeiro.`);
    process.exit(1);
  }

  log.info(`Lendo: ${path.basename(DEDUPED_FILE)}`);
  log.info(`Artigos deduplicados: ${items.length}`);

  ensureDir(DOWNLOADS_DIR);
  ensureDir(path.join(DOWNLOADS_DIR, "logs"));

  const doneIds = readDoneDownloadIds();
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
      downloadsDir: DOWNLOADS_DIR,
    });

    log.header("Download Complete");
    log.done(`${successCount} PDFs baixados`);
    if (failCount > 0) log.warn(`${failCount} falhas`);
    log.step(`Registros salvos em: ${DOWNLOADS_LOG}`);
    log.step(`PDFs em: ${DOWNLOADS_DIR}`);
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
