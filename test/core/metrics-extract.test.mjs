import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { extractMetricsFromDOM } from "../../src/core/metrics-extract.mjs";

const realDocument = globalThis.document;

afterEach(() => {
  if (realDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = realDocument;
  }
});

function fakeDl(pairs, { insideKeywordSection = false } = {}) {
  return {
    closest() {
      return insideKeywordSection ? {} : null;
    },
    querySelectorAll(sel) {
      if (sel === "dt") return pairs.map(([label]) => ({ textContent: label }));
      if (sel === "dd") return pairs.map(([, value]) => ({ textContent: value }));
      return [];
    },
  };
}

function installDOM({ dls = [], bodyText = "" } = {}) {
  globalThis.document = {
    body: { innerText: bodyText },
    querySelectorAll(sel) {
      if (sel === "dl") return dls;
      return [];
    },
  };
}

test("extractMetricsFromDOM: returns null when nothing is found", () => {
  installDOM();
  assert.equal(extractMetricsFromDOM(), null);
});

test("extractMetricsFromDOM: extracts citedBy from body text", () => {
  installDOM({ bodyText: "Some abstract. Cited by 42 documents on Scopus." });
  assert.deepEqual(extractMetricsFromDOM(), { citedBy: 42 });
});

test("extractMetricsFromDOM: extracts citedBy with thousands separator", () => {
  installDOM({ bodyText: "Cited by 1,234" });
  assert.deepEqual(extractMetricsFromDOM(), { citedBy: 1234 });
});

test("extractMetricsFromDOM: extracts references count", () => {
  installDOM({ bodyText: "This work has 57 References listed." });
  assert.deepEqual(extractMetricsFromDOM(), { references: 57 });
});

test("extractMetricsFromDOM: extracts references from parenthesized form", () => {
  installDOM({ bodyText: "References (12)" });
  assert.deepEqual(extractMetricsFromDOM(), { references: 12 });
});

test("extractMetricsFromDOM: collects document details from dt/dd pairs", () => {
  installDOM({
    dls: [
      fakeDl([
        ["DOI", "10.1109/TVT.2024.1234567"],
        ["Publisher", "IEEE"],
        ["Document type", "Article"],
      ]),
    ],
  });
  assert.deepEqual(extractMetricsFromDOM(), {
    details: {
      DOI: "10.1109/TVT.2024.1234567",
      Publisher: "IEEE",
      "Document type": "Article",
    },
  });
});

test("extractMetricsFromDOM: strips trailing colon from labels", () => {
  installDOM({ dls: [fakeDl([["ISSN:", "1234-5678"]])] });
  assert.deepEqual(extractMetricsFromDOM(), { details: { ISSN: "1234-5678" } });
});

test("extractMetricsFromDOM: ignores keyword section dl groups", () => {
  installDOM({
    dls: [
      fakeDl([["Engineering controlled terms", "UAV; Antennas"]], { insideKeywordSection: true }),
      fakeDl([["DOI", "10.1/abc"]]),
    ],
  });
  assert.deepEqual(extractMetricsFromDOM(), { details: { DOI: "10.1/abc" } });
});

test("extractMetricsFromDOM: combines counts and details", () => {
  installDOM({
    dls: [fakeDl([["Source title", "IEEE Transactions on Communications"]])],
    bodyText: "Cited by 8 documents.",
  });
  assert.deepEqual(extractMetricsFromDOM(), {
    citedBy: 8,
    details: { "Source title": "IEEE Transactions on Communications" },
  });
});

test("extractMetricsFromDOM: keeps first value for duplicate labels", () => {
  installDOM({
    dls: [fakeDl([["DOI", "first"]]), fakeDl([["DOI", "second"]])],
  });
  assert.deepEqual(extractMetricsFromDOM(), { details: { DOI: "first" } });
});

test("extractMetricsFromDOM: skips empty labels and values", () => {
  installDOM({ dls: [fakeDl([["", "orphan"], ["Key", "   "], ["Ok", "value"]])] });
  assert.deepEqual(extractMetricsFromDOM(), { details: { Ok: "value" } });
});
