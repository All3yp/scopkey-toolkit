import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { extractFromDOM, extractFromText } from "../../src/core/keyword-extract.mjs";

const realDocument = globalThis.document;
const realNodeFilter = globalThis.NodeFilter;

afterEach(() => {
  if (realDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = realDocument;
  }

  if (realNodeFilter === undefined) {
    delete globalThis.NodeFilter;
  } else {
    globalThis.NodeFilter = realNodeFilter;
  }
});

function fakeElement(textContent = "", selectorResults = {}) {
  const node = {
    textContent,
    parentElement: null,
    nextElementSibling: null,
    querySelectorAll(selector) {
      return selectorResults[selector] ?? [];
    }
  };

  for (const results of Object.values(selectorResults)) {
    for (const child of results) {
      child.parentElement = node;
    }
  }

  return node;
}

function setSiblings(nodes) {
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].nextElementSibling = nodes[i + 1];
  }
}

function installFakeDOM({ queryResults = {}, heading = null } = {}) {
  globalThis.NodeFilter = {
    SHOW_ELEMENT: 1,
    FILTER_ACCEPT: 1,
    FILTER_SKIP: 3
  };

  globalThis.document = {
    body: fakeElement("body"),
    querySelector(selector) {
      return queryResults[selector] ?? null;
    },
    createTreeWalker(_root, _whatToShow, filter) {
      let consumed = false;

      return {
        nextNode() {
          if (consumed || !heading) return null;
          consumed = true;

          return filter.acceptNode(heading) === NodeFilter.FILTER_ACCEPT
            ? heading
            : null;
        }
      };
    }
  };
}

test("extractFromText: returns empty array when no 'Author Keywords' section", () => {
  assert.deepEqual(extractFromText("Some random body\nNo section here."), []);
});

test("extractFromText: returns empty array for empty body", () => {
  assert.deepEqual(extractFromText(""), []);
});

test("extractFromText: splits keywords on semicolons and trims", () => {
  const body = "Author Keywords\nmachine learning;  neural networks ;   deep learning";
  assert.deepEqual(extractFromText(body), ["machine learning", "neural networks", "deep learning"]);
});

test("extractFromText: accepts both singular and plural heading", () => {
  assert.deepEqual(extractFromText("Author Keyword\nalpha; beta"), ["alpha", "beta"]);
  assert.deepEqual(extractFromText("Author Keywords\ngamma; delta"), ["gamma", "delta"]);
});

test("extractFromText: handles lowercase 'k' in keyword(s)", () => {
  assert.deepEqual(extractFromText("Author keywords\nfoo; bar"), ["foo", "bar"]);
});

test("extractFromText: handles multiple whitespace between Author and Keywords", () => {
  assert.deepEqual(extractFromText("Author    Keywords\nalpha; beta"), ["alpha", "beta"]);
});

test("extractFromText: stops at 'References' boundary", () => {
  assert.deepEqual(
    extractFromText("Author Keywords\nkw-a; kw-b; kw-c\nReferences\nSmith J., 2020"),
    ["kw-a", "kw-b", "kw-c"]
  );
});

test("extractFromText: stops at 'Indexed keywords' boundary", () => {
  assert.deepEqual(
    extractFromText("Author Keywords\nauthor1; author2\nIndexed keywords\nindexed1"),
    ["author1", "author2"]
  );
});

test("extractFromText: stops at 'Funding', 'Abstract', 'Publisher' boundaries", () => {
  for (const marker of ["Funding", "abstract", "PUBLISHER"]) {
    assert.deepEqual(
      extractFromText(`Author Keywords\nalpha; beta\n${marker}\nnoise`),
      ["alpha", "beta"],
      `marker: ${marker}`
    );
  }
});

test("extractFromText: stops at 'ISSN' boundary", () => {
  assert.deepEqual(extractFromText("Author Keywords\nkw1; kw2\nISSN\n1234-5678"), ["kw1", "kw2"]);
});

test("extractFromText: stops at 'Source' boundary", () => {
  assert.deepEqual(extractFromText("Author Keywords\nkw1; kw2\nSource\nJournal"), ["kw1", "kw2"]);
});

test("extractFromText: stops at 'Volume' boundary", () => {
  assert.deepEqual(extractFromText("Author Keywords\nkw1; kw2\nVolume\n42"), ["kw1", "kw2"]);
});

test("extractFromText: stops at 'Cited by' boundary", () => {
  assert.deepEqual(extractFromText("Author Keywords\nkw1; kw2\nCited by\n15"), ["kw1", "kw2"]);
});

test("extractFromText: filters keywords shorter than 2 chars", () => {
  assert.deepEqual(extractFromText("Author Keywords\na; ok; b; fine"), ["ok", "fine"]);
});

test("extractFromText: keeps exactly 2-char keyword (boundary)", () => {
  assert.deepEqual(extractFromText("Author Keywords\nAI; ML; NLP"), ["AI", "ML", "NLP"]);
});

test("extractFromText: filters keywords 120+ chars long", () => {
  const longKw = "x".repeat(120);
  assert.deepEqual(extractFromText(`Author Keywords\nshort; ${longKw}; other`), ["short", "other"]);
});

test("extractFromText: keeps 119-char keyword (boundary)", () => {
  const borderline = "x".repeat(119);
  assert.deepEqual(extractFromText(`Author Keywords\n${borderline}; tail`), [borderline, "tail"]);
});

test("extractFromText: replaces embedded newlines with spaces", () => {
  const out = extractFromText("Author Keywords\nmachine\nlearning; neural\nnetworks");
  for (const kw of out) {
    assert.ok(!kw.includes("\n"), `should not contain newline: ${JSON.stringify(kw)}`);
  }
});

test("extractFromText: only parses up to 800 chars after the heading", () => {
  const pad = "kw; ".repeat(300);
  const out = extractFromText(`Author Keywords\n${pad}tailmarker`);
  assert.ok(out.length > 0);
  assert.ok(!out.includes("tailmarker"), "tailmarker is past 800-char window");
});

test("extractFromText: does not require trailing newline after heading", () => {
  assert.deepEqual(extractFromText("Author Keywords foo; bar; baz"), ["foo", "bar", "baz"]);
});

test("extractFromText: handles consecutive semicolons (empty segments filtered)", () => {
  assert.deepEqual(extractFromText("Author Keywords\nalpha;;; beta ;; gamma"), ["alpha", "beta", "gamma"]);
});

test("extractFromText: preserves unicode and accented keywords", () => {
  assert.deepEqual(
    extractFromText("Author Keywords\nmáquina aprendizado; réseau neuronal; 人工知能"),
    ["máquina aprendizado", "réseau neuronal", "人工知能"]
  );
});

test("extractFromText: preserves hyphens and parentheses in keywords", () => {
  assert.deepEqual(
    extractFromText("Author Keywords\nself-supervised learning; convolutional neural network (CNN); IoT"),
    ["self-supervised learning", "convolutional neural network (CNN)", "IoT"]
  );
});

test("extractFromText: handles Author Keywords appearing in middle of text", () => {
  assert.deepEqual(
    extractFromText("Abstract\nSome text.\nAuthor Keywords\nalpha; beta; gamma\nReferences\nRef1"),
    ["alpha", "beta", "gamma"]
  );
});

test("extractFromText: returns empty array when only whitespace after heading", () => {
  assert.deepEqual(extractFromText("Author Keywords\n   \n   \n"), []);
});

test("extractFromText: extracts single keyword without semicolons", () => {
  assert.deepEqual(extractFromText("Author Keywords\nmachine learning\nReferences"), ["machine learning"]);
});

test("extractFromText: handles tab characters inside keywords", () => {
  const out = extractFromText("Author Keywords\nalpha\tbeta; gamma\tdelta");
  assert.equal(out.length, 2);
  assert.ok(out[0].includes("alpha"));
  assert.ok(out[1].includes("gamma"));
});

test("extractFromText: trailing semicolon does not produce empty keyword", () => {
  assert.deepEqual(extractFromText("Author Keywords\nalpha; beta;"), ["alpha", "beta"]);
});

test("extractFromText: leading semicolon does not produce empty keyword", () => {
  assert.deepEqual(extractFromText("Author Keywords\n; alpha; beta"), ["alpha", "beta"]);
});

test("extractFromDOM: extracts from keyword data-testid section", () => {
  const section = fakeElement("", {
    "a, button, span[class], li": [
      fakeElement(" machine learning ; AI "),
      fakeElement("AI"),
      fakeElement("x"),
      fakeElement("data mining|neural networks")
    ]
  });

  installFakeDOM({
    queryResults: {
      '[data-testid*="keyword" i], [data-testid*="Keyword"]': section
    }
  });

  assert.deepEqual(extractFromDOM(), {
    source: "testid",
    keywords: ["machine learning", "AI", "data mining", "neural networks"]
  });
});

test("extractFromDOM: returns heading-parent keywords before other heading fallbacks", () => {
  const heading = fakeElement("Author Keywords");
  const parent = fakeElement("", {
    "a": [
      fakeElement("Author Keywords"),
      fakeElement("alpha"),
      fakeElement("beta")
    ]
  });
  heading.parentElement = parent;

  installFakeDOM({ heading });

  assert.deepEqual(extractFromDOM(), {
    source: "heading-parent",
    keywords: ["alpha", "beta"]
  });
});

test("extractFromDOM: extracts from following sibling when parent has no keyword links", () => {
  const heading = fakeElement("Author Keyword");
  heading.parentElement = fakeElement("", { "a": [] });
  const emptySibling = fakeElement("", { "a, span, button": [] });
  const keywordSibling = fakeElement("", {
    "a, span, button": [fakeElement("gamma"), fakeElement("delta")]
  });
  heading.nextElementSibling = emptySibling;
  setSiblings([emptySibling, keywordSibling]);

  installFakeDOM({ heading });

  assert.deepEqual(extractFromDOM(), {
    source: "heading-sibling",
    keywords: ["gamma", "delta"]
  });
});

test("extractFromDOM: extracts from heading grandparent when parent and siblings are empty", () => {
  const heading = fakeElement("Author Keywords");
  const parent = fakeElement("", { "a": [] });
  const grandparent = fakeElement("", {
    "a": [
      fakeElement("Author Keyword"),
      fakeElement("epsilon"),
      fakeElement("zeta")
    ]
  });
  heading.parentElement = parent;
  parent.parentElement = grandparent;

  installFakeDOM({ heading });

  assert.deepEqual(extractFromDOM(), {
    source: "heading-grandparent",
    keywords: ["epsilon", "zeta"]
  });
});

test("extractFromDOM: extracts from supported keyword class selectors", () => {
  const classSelector = "[class*='keywordGroup' i]";
  const container = fakeElement("", {
    "a, span, button, li": [fakeElement("eta"), fakeElement("theta")]
  });

  installFakeDOM({
    queryResults: {
      [classSelector]: container
    }
  });

  assert.deepEqual(extractFromDOM(), {
    source: `class:${classSelector}`,
    keywords: ["eta", "theta"]
  });
});

test("extractFromDOM: extracts from keyword id section", () => {
  const section = fakeElement("", {
    "a, span, li": [fakeElement("iota"), fakeElement("kappa")]
  });

  installFakeDOM({
    queryResults: {
      "[id*='keyword' i]": section
    }
  });

  assert.deepEqual(extractFromDOM(), {
    source: "id",
    keywords: ["iota", "kappa"]
  });
});

test("extractFromDOM: returns null when no DOM keyword source is found", () => {
  installFakeDOM();

  assert.equal(extractFromDOM(), null);
});
