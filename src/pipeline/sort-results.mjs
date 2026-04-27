import path from "node:path";
import { fileURLToPath } from "node:url";
import { PATHS } from "../shared/config.mjs";
import { readJson, appendJsonl, findLatestLinks } from "../shared/utils.mjs";
import { log } from "../shared/logger.mjs";

const PRESETS = {
  "date-newest": { sortBy: "date", sortDirection: "newest" },
  "date-oldest": { sortBy: "date", sortDirection: "oldest" },
  "cited-highest": { sortBy: "citedBy", sortDirection: "highest" },
  "cited-lowest": { sortBy: "citedBy", sortDirection: "lowest" },
  "relevance": { sortBy: "relevance" },
};

export function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.trim();
    if (!key) continue;
    if (inlineValue !== undefined) { args[key] = inlineValue; continue; }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { args[key] = next; i++; continue; }
    args[key] = true;
  }
  return args;
}

export function resolveSortOptions(args) {
  const preset = String(args.preset ?? "").trim().toLowerCase();
  if (preset) {
    if (!PRESETS[preset]) throw new Error(`preset inválido: "${preset}". Use: ${Object.keys(PRESETS).join(", ")}`);
    return { ...PRESETS[preset], label: preset };
  }

  const sortBy = String(args.sortBy ?? args.sortby ?? "").trim().toLowerCase();
  const dir = String(args.sortDirection ?? args.sortdirection ?? "").trim().toLowerCase();

  if (!sortBy) throw new Error("Informe --preset ou --sortBy.\nExemplos:\n  npm run sortby -- --preset cited-highest\n  npm run sortby -- --sortBy date --sortDirection oldest");
  if (sortBy === "relevance") return { sortBy: "relevance", label: "relevance" };

  if (["date", "year"].includes(sortBy)) {
    const d = ["oldest", "asc", "ascending"].includes(dir) ? "oldest" : "newest";
    return { sortBy: "date", sortDirection: d, label: `date-${d}` };
  }

  if (["citedby", "cited"].includes(sortBy)) {
    const d = ["lowest", "asc", "ascending"].includes(dir) ? "lowest" : "highest";
    return { sortBy: "citedBy", sortDirection: d, label: `cited-${d}` };
  }

  throw new Error(`sortBy inválido: "${args.sortBy}". Use date, citedBy ou relevance.`);
}

export function sortPublications(publications, sortBy, sortDirection) {
  if (sortBy === "relevance") return [...publications];
  return [...publications].sort((a, b) => {
    const va = (sortBy === "date" ? a.year : a.citedBy) ?? 0;
    const vb = (sortBy === "date" ? b.year : b.citedBy) ?? 0;
    return ["newest", "highest"].includes(sortDirection) ? vb - va : va - vb;
  });
}

export function timestamp(date = new Date()) {
  const d = date;
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}m${p(d.getSeconds())}s`;
}

export function runSortResults({
  argv = process.argv.slice(2),
  paths = PATHS,
  read = readJson,
  append = appendJsonl,
  findLatest = findLatestLinks,
  logger = log,
  exit = process.exit,
  now = () => new Date(),
} = {}) {
  const args = parseCliArgs(argv);
  const { sortBy, sortDirection, label } = resolveSortOptions(args);

  const linksFile = findLatest(paths.collectDir) ?? findLatest(paths.outputDir);
  if (!linksFile) {
    logger.error("Nenhum arquivo links-*.json encontrado. Execute `npm run collect` primeiro.");
    exit(1);
    return;
  }

  logger.info(`Lendo: ${linksFile}`);
  const searches = read(linksFile, []);
  if (!searches.length) {
    logger.error("Arquivo de links vazio.");
    exit(1);
    return;
  }

  const ts = timestamp(now());
  const sortDir = path.join(paths.sortedDir, label);
  logger.info(`Ordenação: ${label}`);
  logger.divider();

  for (const search of searches) {
    const sorted = sortPublications(search.publications ?? [], sortBy, sortDirection);
    const outFile = path.join(sortDir, `${search.name}-${ts}.jsonl`);
    for (const pub of sorted) append(outFile, pub);
    logger.info(`${search.name}: ${sorted.length} artigos → ${outFile}`);
  }

  logger.info(`Concluído. Resultados em: ${sortDir}/`);
}

function main() {
  runSortResults();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
