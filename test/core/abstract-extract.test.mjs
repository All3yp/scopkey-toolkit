import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { extractAbstractFromDOM } from "../../src/core/abstract-extract.mjs";

const realDocument = globalThis.document;

afterEach(() => {
  if (realDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = realDocument;
  }
});

function installAbstractDOM({ sectionEl = null } = {}) {
  globalThis.document = {
    querySelector(sel) {
      if (sel === '[id="document-details-abstract"]') return sectionEl;
      return null;
    },
  };
}

function fakeSection(pText = null) {
  return {
    querySelector(sel) {
      if (sel === "p") return pText != null ? { textContent: pText } : null;
      return null;
    },
  };
}

test("extractAbstractFromDOM: returns null when abstract section missing", () => {
  installAbstractDOM();
  assert.equal(extractAbstractFromDOM(), null);
});

test("extractAbstractFromDOM: returns null when section has no <p>", () => {
  installAbstractDOM({ sectionEl: fakeSection(null) });
  assert.equal(extractAbstractFromDOM(), null);
});

test("extractAbstractFromDOM: returns null when <p> text is empty", () => {
  installAbstractDOM({ sectionEl: fakeSection("   ") });
  assert.equal(extractAbstractFromDOM(), null);
});

test("extractAbstractFromDOM: returns trimmed text from <p>", () => {
  installAbstractDOM({ sectionEl: fakeSection("  This is the abstract.  ") });
  assert.equal(extractAbstractFromDOM(), "This is the abstract.");
});

test("extractAbstractFromDOM: returns full multi-sentence abstract", () => {
  const text = "UAVs play a pivotal role. This paper surveys DRL-based approaches.";
  installAbstractDOM({ sectionEl: fakeSection(text) });
  assert.equal(extractAbstractFromDOM(), text);
});

test("extractAbstractFromDOM: preserves internal whitespace", () => {
  const text = "First sentence. Second sentence with   spaces.";
  installAbstractDOM({ sectionEl: fakeSection(text) });
  assert.equal(extractAbstractFromDOM(), text);
});
