import { SETTINGS } from "../shared/config.mjs";

const VALID_SORT_CODES = new Set([
  "plf-f", "plf-t", "cp-f", "cp-t", "r-f", "lfp-t", "lfp-f", "tp-t", "tp-f",
]);

const SORT_ALIASES = new Map([
  ["plf-c", "plf-t"],
  ["cp-c",  "cp-t"],
  ["af-f",  "lfp-t"],
  ["af-t",  "lfp-f"],
  ["stf-f", "tp-t"],
  ["stf-t", "tp-f"],
]);

function normalizeSortCode(sort) {
  if (!sort) return null;
  const raw = String(sort).trim().toLowerCase();
  const normalized = SORT_ALIASES.get(raw) ?? raw;
  return VALID_SORT_CODES.has(normalized) ? normalized : null;
}

function directionToSuffix(direction) {
  if (!direction) return "f";
  const value = String(direction).trim().toLowerCase();
  if (new Set(["desc", "descending", "newest", "highest", "f"]).has(value)) return "f";
  if (new Set(["asc", "ascending", "oldest", "lowest", "t"]).has(value)) return "t";
  throw new Error(
    `sortDirection inválido: "${direction}". Use "desc/newest/highest" ou "asc/oldest/lowest".`
  );
}

export function resolveScopusSort(search) {
  const explicitSort = normalizeSortCode(search.sort);
  if (explicitSort) return explicitSort;

  if (search.sort) {
    throw new Error(`sort inválido: "${search.sort}". Use um de: ${[...VALID_SORT_CODES].join(", ")}`);
  }

  const sortByRaw = String(search.sortBy ?? "").trim().toLowerCase();
  if (!sortByRaw) return "cp-f";

  const sortDirection = search.sortDirection ?? search.sortOrder;

  if (sortByRaw === "relevance") return "r-f";
  if (["date", "year", "publicationdate"].includes(sortByRaw)) return `plf-${directionToSuffix(sortDirection)}`;
  if (["citedby", "citation", "citations", "citationscore", "cited"].includes(sortByRaw)) return `cp-${directionToSuffix(sortDirection)}`;

  throw new Error(`sortBy inválido: "${search.sortBy}". Use "date", "citedBy" ou "relevance".`);
}

export function buildScopusUrl(search) {
  const base = SETTINGS.scopusResultsUrl;
  if (!base) throw new Error("SCOPUS_RESULTS_URL não definido no ambiente.");

  const { query, yearFrom, yearTo, docTypes = ["ar"], limit = 100 } = search;

  const params = new URLSearchParams({
    st1: query,
    st2: "",
    s: `TITLE-ABS-KEY(${query})`,
    limit: String(Math.min(limit, 100)),
    origin: "resultslist",
    sort: resolveScopusSort(search),
    src: "s",
    sot: "b",
    sdt: "cl",
  });

  if (yearFrom) params.set("yearFrom", String(yearFrom));
  if (yearTo)   params.set("yearTo",   String(yearTo));

  const clusterParams = docTypes.map(dt => `&cluster=${encodeURIComponent(`scosubtype,"${dt}",t`)}`).join("");
  return `${base}?${params.toString()}${clusterParams}`;
}
