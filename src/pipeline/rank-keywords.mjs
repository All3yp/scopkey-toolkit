import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../shared/config.mjs";
import { readJson, appendJsonl, findLatestLinks } from "../shared/utils.mjs";
import { log } from "../shared/logger.mjs";

function readAllResultsFromDir(dir) {
  let files;
  try { files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl")).sort(); }
  catch { return []; }

  const seen = new Set();
  const items = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        const id = String(obj.id || "");
        if (!id || seen.has(id) || !Array.isArray(obj.keywords) || obj.keywords.length === 0) continue;
        seen.add(id);
        items.push(obj);
      } catch {}
    }
  }
  return items;
}

function timestamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}m${p(d.getSeconds())}s`;
}

function buildCitedByMap(linksData) {
  const map = new Map();
  for (const search of linksData) {
    for (const pub of (search.publications || [])) {
      map.set(String(pub.id), pub.citedBy ?? 0);
    }
  }
  return map;
}

function rankKeywords(articles) {
  const kwStats = new Map();
  for (const art of articles) {
    for (const kw of art.keywords) {
      const key = kw.toLowerCase();
      if (!kwStats.has(key)) kwStats.set(key, { keyword: kw, totalCited: 0, articleCount: 0 });
      const s = kwStats.get(key);
      s.totalCited += art.citedBy;
      s.articleCount++;
    }
  }
  return [...kwStats.values()].sort((a, b) => b.totalCited - a.totalCited);
}

function main() {
  const linksFile = findLatestLinks(PATHS.collectDir);
  if (!linksFile) {
    log.error("Nenhum links-*.json encontrado. Execute `npm run collect` primeiro.");
    process.exit(1);
  }

  const citedByMap = buildCitedByMap(readJson(linksFile, []));
  const results = readAllResultsFromDir(PATHS.resultsDir);
  if (results.length === 0) {
    log.error("Nenhum resultado de extração encontrado. Execute `npm run extract` primeiro.");
    process.exit(1);
  }

  const articles = results
    .map(r => ({ id: r.id, title: r.title, keywords: r.keywords, citedBy: citedByMap.get(String(r.id)) ?? 0, url: r.sourceLink || "" }))
    .sort((a, b) => b.citedBy - a.citedBy);

  const keywordRanking = rankKeywords(articles);

  const outDir = path.join(PATHS.extractDir, "ranked");
  const ts = timestamp();
  const kwFile  = path.join(outDir, `ranked-keywords-${ts}.jsonl`);
  const artFile = path.join(outDir, `ranked-articles-${ts}.jsonl`);

  for (const [i, s] of keywordRanking.entries()) {
    appendJsonl(kwFile, { rank: i + 1, keyword: s.keyword, totalCited: s.totalCited, articleCount: s.articleCount });
  }
  for (const a of articles) {
    appendJsonl(artFile, { title: a.title, citedBy: a.citedBy, keywords: a.keywords, url: a.url });
  }

  log.info(`Artigos com keywords: ${articles.length}`);
  log.info(`Keywords rankeadas: ${keywordRanking.length}`);
  log.divider();
  log.info("Top 15 keywords por citações:");
  for (const s of keywordRanking.slice(0, 15)) {
    log.info(`  ${s.totalCited.toLocaleString().padStart(6)} cit. (${String(s.articleCount).padStart(3)} artigos)  ${s.keyword}`);
  }
  log.divider();
  log.info(`Keywords: ${kwFile}`);
  log.info(`Articles: ${artFile}`);
}

main();
