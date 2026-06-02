import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../shared/config.mjs";
import { appendJsonl, ensureDir } from "../shared/utils.mjs";
import { log } from "../shared/logger.mjs";

const EXTRACT_PARENT_DIR = path.join(PATHS.outputDir, "extract");
const DEDUPED_DIR = path.join(EXTRACT_PARENT_DIR, "deduped");
const DEDUPED_FILE = path.join(DEDUPED_DIR, "articles-deduped.jsonl");
const DEDUPED_JSON = path.join(DEDUPED_DIR, "articles-deduped.json");
const DEDUPED_CSV = path.join(DEDUPED_DIR, "articles-deduped.csv");

function readAllResults(extractParentDir) {
  const seen = new Set();
  const items = [];

  let sessions = [];
  try { sessions = fs.readdirSync(extractParentDir, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== "deduped"); }
  catch { return items; }

  for (const session of sessions) {
    const resultsDir = path.join(extractParentDir, session.name, "results");
    let files = [];
    try { files = fs.readdirSync(resultsDir).filter(f => /^results-.*\.jsonl$/i.test(f)).map(f => path.join(resultsDir, f)); }
    catch { continue; }

    for (const file of files) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          const id = String(obj.id || "");
          if (!id || seen.has(id)) continue;
          seen.add(id);
          items.push(obj);
        } catch {}
      }
    }
  }

  return items;
}

function readAbstractsMap(extractParentDir) {
  const map = new Map();
  let sessions = [];
  try { sessions = fs.readdirSync(extractParentDir, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== "deduped"); }
  catch { return map; }

  for (const session of sessions) {
    const abstractsDir = path.join(extractParentDir, session.name, "abstracts");
    let files = [];
    try { files = fs.readdirSync(abstractsDir).filter(f => /^abstracts-.*\.jsonl$/i.test(f)).map(f => path.join(abstractsDir, f)); }
    catch { continue; }

    for (const file of files) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          if (obj.id && obj.abstract) map.set(String(obj.id), obj.abstract);
        } catch {}
      }
    }
  }

  return map;
}

function escapeCsv(val) {
  if (val == null) return "";
  const s = String(val).replace(/"/g, '""');
  return /[,"\n\r]/.test(s) ? `"${s}"` : s;
}

function toCsvRow(fields, item) {
  return fields.map(f => escapeCsv(item[f])).join(",");
}

function main() {
  log.header("Dedupe Articles + Abstracts");

  const items = readAllResults(EXTRACT_PARENT_DIR);
  log.info(`Artigos únicos: ${items.length}`);

  const abstracts = readAbstractsMap(EXTRACT_PARENT_DIR);
  log.info(`Abstracts disponíveis (separados): ${abstracts.size}`);

  let withAbstract = 0;
  let withoutAbstract = 0;

  ensureDir(DEDUPED_DIR);
  for (const f of [DEDUPED_FILE, DEDUPED_JSON, DEDUPED_CSV]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  const enriched = [];
  for (const item of items) {
    const abstract = item.abstract ?? abstracts.get(String(item.id)) ?? null;
    if (abstract) withAbstract++; else withoutAbstract++;
    const entry = { ...item, abstract };
    enriched.push(entry);
    appendJsonl(DEDUPED_FILE, entry);
  }

  // JSON
  fs.writeFileSync(DEDUPED_JSON, JSON.stringify(enriched, null, 2), "utf8");

  // CSV — columns: id, title, abstract, keywords (semicolon-joined), groups summary, source, sourceLink
  const CSV_FIELDS = ["id", "title", "abstract", "keywords", "authorKeywords", "indexedKeywords", "source", "sourceLink"];
  const csvRows = [CSV_FIELDS.join(",")];
  for (const item of enriched) {
    const authorKws = item.groups?.find(g => g.type === "author")?.keywords?.join("; ") ?? "";
    const indexedKws = item.groups
      ?.filter(g => g.type !== "author")
      .flatMap(g => g.keywords)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join("; ") ?? "";
    const flat = { ...item, keywords: item.keywords?.join("; ") ?? "", authorKeywords: authorKws, indexedKeywords: indexedKws };
    csvRows.push(toCsvRow(CSV_FIELDS, flat));
  }
  fs.writeFileSync(DEDUPED_CSV, csvRows.join("\n"), "utf8");

  log.done(`JSONL : ${DEDUPED_FILE}`);
  log.done(`JSON  : ${DEDUPED_JSON}`);
  log.done(`CSV   : ${DEDUPED_CSV}`);
  log.info(`Com abstract: ${withAbstract} | Sem abstract: ${withoutAbstract}`);
  log.divider();
}

main();
