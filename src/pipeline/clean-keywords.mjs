import fs from "node:fs";
import path from "node:path";
import { PATHS, translateIfNeeded } from "../shared/config.mjs";
import { writeJson, appendJsonl } from "../shared/utils.mjs";
import { log } from "../shared/logger.mjs";

function findAllResultFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => /^results-.*\.jsonl$/.test(f))
      .sort()
      .map(f => path.join(dir, f));
  } catch { return []; }
}

function readJsonlItems(file) {
  const items = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { items.push(JSON.parse(trimmed)); } catch {}
  }
  return items;
}

function readAllResults(dir) {
  const files = findAllResultFiles(dir);
  const seen = new Set();
  const items = [];
  for (const file of files) {
    for (const item of readJsonlItems(file)) {
      if (item.noKeywords) continue;
      const id = String(item.id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push(item);
    }
  }
  return { items, files };
}

function timestampedPath(dir, name, ext) {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}m${pad(d.getSeconds())}s`;
  return path.join(dir, `${name}-${ts}.${ext}`);
}

async function buildTranslationMap(kwMap) {
  const translatedMap = new Map();
  let translatedCount = 0;
  for (const [key, original] of kwMap) {
    const translated = await translateIfNeeded(original);
    if (translated !== original) { log.step(`"${original}" → "${translated}"`); translatedCount++; }
    const tKey = translated.trim().toLowerCase();
    if (!translatedMap.has(tKey)) translatedMap.set(tKey, translated.trim());
  }
  return { translatedMap, translatedCount };
}

function cleanItemKeywords(item, translatedMap) {
  if (!Array.isArray(item.keywords) || item.keywords.length === 0) return { ...item, keywords: [] };
  const seen = new Set();
  const cleaned = [];
  for (const kw of item.keywords) {
    const translated = translatedMap.get(kw.trim().toLowerCase()) ?? kw.trim();
    const tKey = translated.toLowerCase();
    if (!seen.has(tKey)) { seen.add(tKey); cleaned.push(translated); }
  }
  return { ...item, keywords: cleaned };
}

async function main() {
  log.header("Clean Keywords");

  const { items, files } = readAllResults(PATHS.resultsDir);
  if (files.length === 0) {
    log.error("Nenhum results-*.jsonl encontrado. Execute extract primeiro.");
    process.exit(1);
  }
  for (const f of files) log.step(`Reading: ${f}`);
  log.info(`Files: ${files.length} | Articles (com keywords): ${items.length}`);

  const kwMap = new Map();
  let totalRaw = 0;
  for (const item of items) {
    if (!Array.isArray(item.keywords)) continue;
    for (const kw of item.keywords) {
      totalRaw++;
      const key = kw.trim().toLowerCase();
      if (!kwMap.has(key)) kwMap.set(key, kw.trim());
    }
  }
  log.info(`Raw keywords: ${totalRaw} | Unique: ${kwMap.size}`);

  log.step("Translating non-English keywords...");
  const { translatedMap, translatedCount } = await buildTranslationMap(kwMap);
  log.info(`Translated: ${translatedCount} | Final unique: ${translatedMap.size}`);

  const cleanItems = items.map(item => cleanItemKeywords(item, translatedMap));
  const globalKeywords = [...translatedMap.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const cleanFile = timestampedPath(PATHS.cleanDir, "clean", "jsonl");
  appendJsonl(cleanFile, {
    _type: "meta", sources: files, totalArticles: items.length,
    rawKeywords: totalRaw, uniqueKeywords: translatedMap.size,
    translated: translatedCount, globalKeywords, generatedAt: new Date().toISOString(),
  });
  for (const item of cleanItems) appendJsonl(cleanFile, item);

  log.header("Clean Complete");
  log.done(`${translatedMap.size} unique keywords`);
  log.step(`Saved: ${cleanFile}`);
  log.divider();
}

main().catch(err => { log.error(String(err?.message || err)); process.exit(1); });
