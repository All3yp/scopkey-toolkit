import { SETTINGS, PATHS } from "../shared/config.mjs";
import fs from "node:fs";

const CATEGORIES = JSON.parse(
  fs.readFileSync(
    PATHS.searches.replace("searches.json", "categories.json"),
    "utf8"
  )
).categories;

const VALID_SORT_CODES = new Set([
  "plf-f",
  "plf-t",
  "cp-f",
  "cp-t",
  "r-f",
  "lfp-t",
  "lfp-f",
  "tp-t",
  "tp-f",
]);

const SORT_ALIASES = new Map([
  ["plf-c", "plf-t"],
  ["cp-c", "cp-t"],
  ["af-f", "lfp-t"],
  ["af-t", "lfp-f"],
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

  if (new Set(["desc", "descending", "newest", "highest", "f"]).has(value)) {
    return "f";
  }

  if (new Set(["asc", "ascending", "oldest", "lowest", "t"]).has(value)) {
    return "t";
  }

  throw new Error(
    `sortDirection inválido: "${direction}". Use "desc/newest/highest" ou "asc/oldest/lowest".`
  );
}

export function resolveScopusSort(search) {
  const explicitSort = normalizeSortCode(search.sort);

  if (explicitSort) return explicitSort;

  if (search.sort) {
    throw new Error(
      `sort inválido: "${search.sort}". Use um de: ${[
        ...VALID_SORT_CODES,
      ].join(", ")}`
    );
  }

  const sortByRaw = String(search.sortBy ?? "").trim().toLowerCase();

  if (!sortByRaw) return "cp-f";

  const sortDirection = search.sortDirection ?? search.sortOrder;

  if (sortByRaw === "relevance") return "r-f";

  if (["date", "year", "publicationdate"].includes(sortByRaw)) {
    return `plf-${directionToSuffix(sortDirection)}`;
  }

  if (
    ["citedby", "citation", "citations", "citationscore", "cited"].includes(
      sortByRaw
    )
  ) {
    return `cp-${directionToSuffix(sortDirection)}`;
  }

  throw new Error(
    `sortBy inválido: "${search.sortBy}". Use "date", "citedBy" ou "relevance".`
  );
}

function categoryToQueryBlock(category) {
  if (category.cross) {
    return category.cross
      .map((group) => `(${group.map((k) => `"${k}"`).join(" OR ")})`)
      .join(" AND ");
  }

  if (category.keywords?.length) {
    return `(${category.keywords.map((k) => `"${k}"`).join(" OR ")})`;
  }

  return null;
}

export function buildScopusUrl(search) {
  const base = SETTINGS.scopusResultsUrl;

  if (!base) {
    throw new Error("SCOPUS_RESULTS_URL não definido no ambiente.");
  }

  if (!search.query) {
    throw new Error("Campo 'query' é obrigatório em searches.json.");
  }

  const {
    query,
    exclusion,
    sourceTitle,
    authors = [],
    affiliations = [],
    countries = [],
    conferences = [],
    publishers = [],
    language,
    yearFrom,
    yearTo,
    docTypes = [],
    categoryIds = [],
  } = search;

  // st1 = base query (field 1: All fields)
  const st1 = exclusion ? `${query} AND NOT (${exclusion})` : query;

  // st2 = category keywords block (field 2: All fields)
  let st2 = "";
  if (categoryIds?.length) {
    const categoryBlocks = [];
    for (const categoryId of categoryIds) {
      const category = CATEGORIES.find((cat) => cat.id === categoryId);
      if (!category) throw new Error(`Categoria não encontrada: "${categoryId}"`);
      const block = categoryToQueryBlock(category);
      if (block) categoryBlocks.push(block);
    }
    if (categoryBlocks.length) st2 = categoryBlocks.join(" AND ");
  }

  // s = full combined query used internally by Scopus
  const sParts = [st1];
  if (st2) sParts.push(st2);
  const s = sParts.join(" AND ");

  const params = new URLSearchParams({
    st1,
    st2,
    s,
    limit: "200",
    origin: "resultslist",
    sort: resolveScopusSort(search),
    src: "s",
    sot: "b",
    sdt: "cl",
  });

  if (yearFrom) params.set("yearFrom", String(yearFrom));
  if (yearTo) params.set("yearTo", String(yearTo));

  // Field-specific filters as cluster params
  const clusterParts = docTypes
    .map((dt) => `&cluster=${encodeURIComponent(`scosubtype,"${dt}",t`)}`)
    .join("");

  // SRCTITLE as a dedicated field filter (cluster)
  const srcTitleParam = sourceTitle
    ? `&cluster=${encodeURIComponent(`exactsrctitle,"${sourceTitle}",t`)}` : "";

  // Other field filters appended to s via subtype
  const fieldFilters = [];
  if (authors?.length) fieldFilters.push(`AUTH(${authors.map(a => `"${a}"`).join(" OR ")})`);
  if (affiliations?.length) fieldFilters.push(`AFFIL(${affiliations.map(a => `"${a}"`).join(" OR ")})`);
  if (countries?.length) fieldFilters.push(`AFFILCOUNTRY(${countries.map(c => `"${c}"`).join(" OR ")})`);
  if (conferences?.length) fieldFilters.push(`CONF(${conferences.map(c => `"${c}"`).join(" OR ")})`);
  if (publishers?.length) fieldFilters.push(`PUBLISHER(${publishers.map(p => `"${p}"`).join(" OR ")})`);
  if (language) fieldFilters.push(`LANGUAGE("${language}")`);

  if (fieldFilters.length) {
    params.set("s", `${s} AND ${fieldFilters.join(" AND ")}`);
  }

  return `${base}?${params.toString()}${clusterParts}${srcTitleParam}`;
}