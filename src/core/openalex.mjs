import fs from "node:fs";
import path from "node:path";

const OPENALEX_API = process.env.OPENALEX_API_URL ?? "https://api.openalex.org";
const OPENALEX_MAILTO = process.env.OPENALEX_MAILTO ?? "";

function buildParams(extra) {
  const params = new URLSearchParams({ "per-page": "10" });
  if (OPENALEX_MAILTO) params.set("mailto", OPENALEX_MAILTO);
  for (const [k, v] of Object.entries(extra ?? {})) if (v != null) params.set(k, String(v));
  return params;
}

export function normalizeTitle(t) {
  return String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenOverlap(a, b) {
  if (!a || !b) return 0;
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  // coverage of the shorter title: tolerant to subtitle additions
  return inter / Math.min(ta.size, tb.size);
}

/**
 * pickBestMatch(results, { title }) → best candidate or null.
 * Exact normalized-title match wins; otherwise best token-overlap
 * (coverage of the shorter title) with a 0.5 acceptance threshold.
 */
export function pickBestMatch(results, { title } = {}) {
  if (!results?.length) return null;
  if (!title) return results[0];
  const target = normalizeTitle(title);
  let best = null;
  let bestScore = 0;
  for (const r of results) {
    const norm = normalizeTitle(r.title);
    if (norm && norm === target) return r;
    const score = tokenOverlap(target, norm);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

/**
 * searchOpenAlex({ title, doi, year }) → raw works array.
 * DOI filter takes precedence; otherwise relevance `search` with the title
 * (OpenAlex ranks exact-title matches on top).
 */
export async function searchOpenAlex({ title, doi, year } = {}, { fetchImpl = globalThis.fetch } = {}) {
  const filters = [];
  if (doi) {
    const cleaned = String(doi).replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:/i, "").trim();
    if (cleaned) filters.push(`doi:${cleaned}`);
  }
  if (year) filters.push(`publication_year:${year}`);

  if (!doi && !title) return [];

  const params = buildParams(filters.length ? { filter: filters.join(",") } : null);
  params.set("search", title ?? "");

  const url = `${OPENALEX_API}/works?${params.toString()}`;
  const res = await fetchImpl(url, { headers: { "user-agent": "scopkey-toolkit" } });
  if (!res.ok) throw new Error(`OpenAlex API ${res.status} para ${title ?? doi}`);
  const data = await res.json();
  return data?.results ?? [];
}

/**
 * openAlexPdfUrl(work) → { pdfUrl, isOa } or null.
 * Prefers best_oa_location.pdf_url, then any oa_location with pdf_url.
 */
export function openAlexPdfUrl(work) {
  if (!work) return null;
  const candidates = [];
  if (work.best_oa_location?.pdf_url) candidates.push(work.best_oa_location.pdf_url);
  for (const loc of work.oa_locations ?? []) {
    if (loc.pdf_url && !candidates.includes(loc.pdf_url)) candidates.push(loc.pdf_url);
  }
  if (!candidates.length) return null;
  return { pdfUrl: candidates[0], isOa: work.open_access?.is_oa ?? true };
}

export function sanitizeFilename(name) {
  return String(name).replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
}

export async function downloadOpenAccessPdf(pdfUrl, filepath, { fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(pdfUrl, {
    headers: { "user-agent": "scopkey-toolkit" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`OpenAlex PDF status ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!/(application\/pdf|application\/octet-stream)/i.test(contentType)) {
    throw new Error(`OpenAlex PDF content-type inválido: ${contentType}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("OpenAlex PDF vazio");
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, buf);
  return { filepath, bytes: buf.length };
}

/**
 * findWorkByTitle({ title, doi, year }) → matched OpenAlex work or null.
 */
export async function findWorkByTitle(query, opts = {}) {
  const results = await searchOpenAlex(query, opts);
  return pickBestMatch(results, { title: query.title });
}
