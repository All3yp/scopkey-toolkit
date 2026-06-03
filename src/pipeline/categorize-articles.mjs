import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../shared/config.mjs";
import { appendJsonl, ensureDir } from "../shared/utils.mjs";
import { log } from "../shared/logger.mjs";

const EXTRACT_PARENT_DIR = path.join(PATHS.outputDir, "extract");
const DEDUPED_FILE = path.join(EXTRACT_PARENT_DIR, "deduped", "articles-deduped.jsonl");
const CATEGORIES_CONFIG = path.join(PATHS.root, "config", "categories.json");
const CATEGORIES_DIR = path.join(EXTRACT_PARENT_DIR, "categories");
const REPORT_FILE = path.join(CATEGORIES_DIR, "report.md");

function loadArticles() {
  return fs.readFileSync(DEDUPED_FILE, "utf8")
    .split("\n")
    .filter(l => l.trim())
    .map(l => JSON.parse(l));
}

function loadCategories() {
  return JSON.parse(fs.readFileSync(CATEGORIES_CONFIG, "utf8")).categories;
}

function buildHaystack(article) {
  return [
    article.title ?? "",
    article.abstract ?? "",
    ...(article.keywords ?? []),
  ].join(" ").toLowerCase();
}

function matchesCategory(article, cat) {
  const haystack = buildHaystack(article);

  if (cat.cross) {
    return cat.cross.every(group =>
      group.some(kw => haystack.includes(kw.toLowerCase()))
    );
  }

  return (cat.keywords ?? []).some(kw => haystack.includes(kw.toLowerCase()));
}

function generateReport(articles, categories, matches) {
  const total = articles.length;
  const matched = new Set(Object.values(matches).flat().map(a => a.id)).size;

  const lines = [
    `# Relatório de Categorização`,
    ``,
    `**Total de papers analisados:** ${total}`,
    `**Papers que correspondem a categorias:** ${matched}`,
    `**Papers sem categoria:** ${total - matched}`,
    ``,
    `---`,
    ``,
    `## Categorias`,
    ``,
  ];

  for (const cat of categories) {
    const catArticles = matches[cat.id] ?? [];
    lines.push(`### ${cat.name} (${catArticles.length} papers)`);
    lines.push(`Arquivo: \`${cat.id}.jsonl\``);
    lines.push(``);
    if (catArticles.length > 0) {
      for (const a of catArticles) {
        lines.push(`- **${a.id}** — ${a.title}`);
      }
    } else {
      lines.push(`*Nenhum paper encontrado*`);
    }
    lines.push(``);
  }

  const uncategorized = articles.filter(a => !Object.values(matches).flat().find(m => m.id === a.id));
  if (uncategorized.length > 0) {
    lines.push(`---`);
    lines.push(``);
    lines.push(`## Sem Categoria (${uncategorized.length} papers)`);
    lines.push(``);
    for (const a of uncategorized) {
      lines.push(`- **${a.id}** — ${a.title}`);
    }
  }

  return lines.join("\n");
}

function main() {
  log.header("Categorize Articles");

  const articles = loadArticles();
  const categories = loadCategories();

  log.info(`Articles: ${articles.length}`);
  log.info(`Categories: ${categories.length}`);

  ensureDir(CATEGORIES_DIR);

  const validFiles = new Set([...categories.map(c => `${c.id}.jsonl`), 'uncategorized.jsonl']);
  for (const f of fs.readdirSync(CATEGORIES_DIR)) {
    if (f.endsWith('.jsonl') && !validFiles.has(f)) {
      fs.unlinkSync(path.join(CATEGORIES_DIR, f));
      log.step(`Removido obsoleto: ${f}`);
    }
  }

  const matches = {};
  for (const cat of categories) {
    matches[cat.id] = articles.filter(a => matchesCategory(a, cat));
  }

  for (const cat of categories) {
    const catArticles = matches[cat.id];
    const outFile = path.join(CATEGORIES_DIR, `${cat.id}.jsonl`);

    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

    for (const a of catArticles) {
      appendJsonl(outFile, a);
    }

    log.step(`${cat.name}: ${catArticles.length} papers → ${cat.id}.jsonl`);
  }

  const matchedIds = new Set(Object.values(matches).flat().map(a => a.id));
  const uncategorized = articles.filter(a => !matchedIds.has(a.id));

  const uncatFile = path.join(CATEGORIES_DIR, "uncategorized.jsonl");
  if (fs.existsSync(uncatFile)) fs.unlinkSync(uncatFile);
  for (const a of uncategorized) appendJsonl(uncatFile, a);
  log.step(`Sem categoria: ${uncategorized.length} papers → uncategorized.jsonl`);

  const report = generateReport(articles, categories, matches);
  fs.writeFileSync(REPORT_FILE, report, "utf8");

  const totalMatched = matchedIds.size;
  log.done(`Relatório salvo em: ${REPORT_FILE}`);
  log.info(`Com categoria: ${totalMatched} | Sem categoria: ${articles.length - totalMatched}`);
  log.divider();
}

main();
