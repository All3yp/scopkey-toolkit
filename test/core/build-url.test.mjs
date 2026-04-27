import test from "node:test";
import assert from "node:assert/strict";

process.env.SCOPUS_RESULTS_URL = "https://scopus.example/results/results.uri";

const { resolveScopusSort, buildScopusUrl } = await import("../../src/core/build-url.mjs");

test("resolveScopusSort: defaults to cp-f when no sort info provided", () => {
  assert.equal(resolveScopusSort({}), "cp-f");
});

test("resolveScopusSort: accepts explicit valid sort code", () => {
  assert.equal(resolveScopusSort({ sort: "plf-t" }), "plf-t");
  assert.equal(resolveScopusSort({ sort: "r-f" }), "r-f");
});

test("resolveScopusSort: lowercases + trims explicit sort code", () => {
  assert.equal(resolveScopusSort({ sort: "  PLF-T  " }), "plf-t");
});

test("resolveScopusSort: maps deprecated aliases to canonical codes", () => {
  assert.equal(resolveScopusSort({ sort: "plf-c" }), "plf-t");
  assert.equal(resolveScopusSort({ sort: "cp-c" }),  "cp-t");
  assert.equal(resolveScopusSort({ sort: "af-f" }),  "lfp-t");
  assert.equal(resolveScopusSort({ sort: "stf-t" }), "tp-f");
});

test("resolveScopusSort: rejects unknown explicit sort code", () => {
  assert.throws(() => resolveScopusSort({ sort: "bogus" }), /sort inválido/);
});

test("resolveScopusSort: sortBy=relevance returns r-f (ignores direction)", () => {
  assert.equal(resolveScopusSort({ sortBy: "relevance", sortDirection: "asc" }), "r-f");
});

test("resolveScopusSort: sortBy=date defaults to descending (newest first)", () => {
  assert.equal(resolveScopusSort({ sortBy: "date" }), "plf-f");
});

test("resolveScopusSort: sortBy=date supports ascending synonyms", () => {
  for (const dir of ["asc", "ascending", "oldest", "lowest", "t"]) {
    assert.equal(resolveScopusSort({ sortBy: "date", sortDirection: dir }), "plf-t", `direction ${dir}`);
  }
});

test("resolveScopusSort: sortBy=date supports descending synonyms", () => {
  for (const dir of ["desc", "descending", "newest", "highest", "f"]) {
    assert.equal(resolveScopusSort({ sortBy: "date", sortDirection: dir }), "plf-f", `direction ${dir}`);
  }
});

test("resolveScopusSort: sortBy=citedBy defaults to descending (highest first)", () => {
  assert.equal(resolveScopusSort({ sortBy: "citedBy" }), "cp-f");
});

test("resolveScopusSort: sortBy=citedBy supports ascending synonyms", () => {
  assert.equal(resolveScopusSort({ sortBy: "citedBy", sortDirection: "lowest" }), "cp-t");
});

test("resolveScopusSort: sortBy case-insensitive (year / publicationDate aliases)", () => {
  assert.equal(resolveScopusSort({ sortBy: "YEAR",            sortDirection: "oldest" }), "plf-t");
  assert.equal(resolveScopusSort({ sortBy: "publicationDate"                          }), "plf-f");
});

test("resolveScopusSort: accepts sortOrder as alias for sortDirection", () => {
  assert.equal(resolveScopusSort({ sortBy: "date", sortOrder: "oldest" }), "plf-t");
});

test("resolveScopusSort: rejects invalid sortDirection with explanatory message", () => {
  assert.throws(() => resolveScopusSort({ sortBy: "date", sortDirection: "sideways" }), /sortDirection inválido/);
});

test("resolveScopusSort: rejects invalid sortBy", () => {
  assert.throws(() => resolveScopusSort({ sortBy: "nope" }), /sortBy inválido/);
});

test("buildScopusUrl: composes core query params and defaults", () => {
  const url = buildScopusUrl({ query: "machine learning" });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://scopus.example/results/results.uri");
  assert.equal(u.searchParams.get("st1"), "machine learning");
  assert.equal(u.searchParams.get("st2"), "");
  assert.equal(u.searchParams.get("s"), "TITLE-ABS-KEY(machine learning)");
  assert.equal(u.searchParams.get("limit"), "100");
  assert.equal(u.searchParams.get("origin"), "resultslist");
  assert.equal(u.searchParams.get("sort"), "cp-f");
  assert.equal(u.searchParams.get("src"), "s");
  assert.equal(u.searchParams.get("sot"), "b");
  assert.equal(u.searchParams.get("sdt"), "cl");
});

test("buildScopusUrl: caps limit at 100", () => {
  assert.equal(new URL(buildScopusUrl({ query: "q", limit: 999 })).searchParams.get("limit"), "100");
});

test("buildScopusUrl: preserves smaller limit values", () => {
  assert.equal(new URL(buildScopusUrl({ query: "q", limit: 25 })).searchParams.get("limit"), "25");
});

test("buildScopusUrl: includes year range when provided", () => {
  const u = new URL(buildScopusUrl({ query: "q", yearFrom: 2019, yearTo: 2024 }));
  assert.equal(u.searchParams.get("yearFrom"), "2019");
  assert.equal(u.searchParams.get("yearTo"), "2024");
});

test("buildScopusUrl: omits year params when not provided", () => {
  const u = new URL(buildScopusUrl({ query: "q" }));
  assert.equal(u.searchParams.has("yearFrom"), false);
  assert.equal(u.searchParams.has("yearTo"),   false);
});

test("buildScopusUrl: emits cluster param per docType (default = 'ar')", () => {
  const clusters = new URL(buildScopusUrl({ query: "q" })).searchParams.getAll("cluster");
  assert.deepEqual(clusters, ['scosubtype,"ar",t']);
});

test("buildScopusUrl: emits one cluster per docType, preserving order", () => {
  const clusters = new URL(buildScopusUrl({ query: "q", docTypes: ["ar", "cp", "re"] })).searchParams.getAll("cluster");
  assert.deepEqual(clusters, ['scosubtype,"ar",t', 'scosubtype,"cp",t', 'scosubtype,"re",t']);
});

test("buildScopusUrl: forwards resolved sort (sortBy=date, oldest → plf-t)", () => {
  assert.equal(
    new URL(buildScopusUrl({ query: "q", sortBy: "date", sortDirection: "oldest" })).searchParams.get("sort"),
    "plf-t"
  );
});

test("buildScopusUrl: URL-encodes special characters in query", () => {
  const url = buildScopusUrl({ query: "a & b" });
  const u = new URL(url);
  assert.equal(u.searchParams.get("st1"), "a & b");
  assert.ok(url.includes("st1=a+%26+b") || url.includes("st1=a%20%26%20b"));
});

test("buildScopusUrl: throws when SCOPUS_RESULTS_URL missing", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const nodePath = await import("node:path");

  const here = nodePath.dirname(fileURLToPath(import.meta.url));
  const srcPath = nodePath.resolve(here, "..", "..", "src", "core", "build-url.mjs");
  const script = `
    import { buildScopusUrl } from ${JSON.stringify(srcPath)};
    buildScopusUrl({ query: "q" });
  `;

  const env = { ...process.env, SCOPUS_RESULTS_URL: "" };
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8" });

  assert.notEqual(result.status, 0, "child process should fail when SCOPUS_RESULTS_URL is missing");
});
