import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  normalizeTitle,
  pickBestMatch,
  openAlexPdfUrl,
  sanitizeFilename,
  searchOpenAlex,
  findWorkByTitle,
  downloadOpenAccessPdf,
} from "../../src/core/openalex.mjs";

test("normalizeTitle: folds case/punctuation", () => {
  assert.equal(normalizeTitle("  ACFA: Secure Runtime Auditing & Healing! "), "acfa secure runtime auditing healing");
});

test("pickBestMatch: returns exact normalized-title match", () => {
  const results = [
    { id: "W1", title: "Different paper" },
    { id: "W2", title: "ACFA: Secure Runtime Auditing" },
  ];
  assert.equal(pickBestMatch(results, { title: "ACFA Secure Runtime Auditing" }).id, "W2");
});

test("pickBestMatch: returns null when overlap below threshold", () => {
  const results = [{ id: "W1", title: "Completely unrelated topic about boats" }];
  assert.equal(pickBestMatch(results, { title: "quantum key distribution in satellite networks" }), null);
});

test("pickBestMatch: falls back to first result when no title given", () => {
  const results = [{ id: "W1", title: "anything" }];
  assert.equal(pickBestMatch(results, {}).id, "W1");
  assert.equal(pickBestMatch(results).id, "W1");
});

test("openAlexPdfUrl: prefers best_oa_location, then any oa location", () => {
  const work = {
    best_oa_location: { pdf_url: "https://x/best.pdf" },
    oa_locations: [{ pdf_url: "https://x/other.pdf" }],
  };
  assert.equal(openAlexPdfUrl(work).pdfUrl, "https://x/best.pdf");

  const noBest = {
    best_oa_location: {},
    oa_locations: [{ pdf_url: "https://x/other.pdf" }],
  };
  assert.equal(openAlexPdfUrl(noBest).pdfUrl, "https://x/other.pdf");
  assert.equal(openAlexPdfUrl({ best_oa_location: {}, oa_locations: [] }), null);
  assert.equal(openAlexPdfUrl(null), null);
});

test("sanitizeFilename: strips non-alphanumerics, truncates to 50", () => {
  const name = sanitizeFilename("ACFA: Secure Runtime Auditing & Guaranteed Device Healing via Active Control Flow Attestation");
  assert.match(name, /^[A-Za-z0-9_]+$/);
  assert.ok(name.length <= 50);
});

test("searchOpenAlex: uses fetchImpl and returns results", async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => ({ results: [{ id: "W1", title: "Test paper" }] }),
  });
  const results = await searchOpenAlex({ title: "remote attestation" }, { fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "W1");
});

test("searchOpenAlex: throws on non-ok response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429 });
  await assert.rejects(
    () => searchOpenAlex({ title: "x" }, { fetchImpl }),
    /429/
  );
});

test("findWorkByTitle: matches via search", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ results: [{ id: "W2", title: "Principles of remote attestation" }] }),
  });
  const work = await findWorkByTitle({ title: "Principles of remote attestation" }, { fetchImpl });
  assert.equal(work.id, "W2");
});

test("downloadOpenAccessPdf: writes bytes to filepath", async () => {
  const pdfBytes = Buffer.from("%PDF-1.4 fake", "utf8");
  const fetchImpl = async () => ({
    ok: true,
    headers: { get: () => "application/pdf" },
    arrayBuffer: async () => pdfBytes,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openalex-test-"));
  const filepath = path.join(dir, "out.pdf");
  const result = await downloadOpenAccessPdf("https://x/a.pdf", filepath, { fetchImpl });
  assert.equal(result.bytes, pdfBytes.length);
  assert.ok(fs.existsSync(filepath));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloadOpenAccessPdf: rejects non-pdf content-type", async () => {
  const fetchImpl = async () => ({
    ok: true,
    headers: { get: () => "text/html" },
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openalex-test-"));
  await assert.rejects(
    () => downloadOpenAccessPdf("https://x/a", path.join(dir, "out.pdf"), { fetchImpl }),
    /content-type/
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
