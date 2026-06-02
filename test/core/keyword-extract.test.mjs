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
    getElementById(_id) { return null; },
    querySelector(selector) {
      return queryResults[selector] ?? null;
    },
    querySelectorAll(selector) { return queryResults[selector] ? [queryResults[selector]] : []; },
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
  const kwEls = [
    fakeElement(" machine learning ; AI "),
    fakeElement("AI"),
    fakeElement("x"),
    fakeElement("data mining|neural networks")
  ];
  const section = {
    textContent: "",
    querySelector(_sel) { return null; },
    querySelectorAll(sel) {
      if (sel === "dl") return [];
      if (sel === "a, button, span[class], li") return kwEls;
      return [];
    },
    previousElementSibling: null,
    parentElement: null,
  };

  globalThis.NodeFilter = { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_SKIP: 3 };
  globalThis.document = {
    body: fakeElement("body"),
    getElementById(_id) { return null; },
    querySelector(_sel) { return null; },
    querySelectorAll(sel) {
      if (sel === '[data-testid*="keyword" i]') return [section];
      return [];
    },
    createTreeWalker() { return { nextNode() { return null; } }; },
  };

  const result = extractFromDOM();
  assert.equal(result.source, "testid");
  assert.deepEqual(result.keywords, ["machine learning", "AI", "data mining", "neural networks"]);
});

test("extractFromDOM: returns heading-parent keywords", () => {
  const heading = fakeElement("Author Keywords");
  const parent = fakeElement("", {
    "a, span, li": [
      fakeElement("Author Keywords"),
      fakeElement("alpha"),
      fakeElement("beta")
    ]
  });
  heading.parentElement = parent;

  installFakeDOM({ heading });

  const result = extractFromDOM();
  assert.equal(result.source, "heading");
  assert.deepEqual(result.keywords, ["alpha", "beta"]);
});

test("extractFromDOM: extracts from following sibling when parent has no keyword links", () => {
  const heading = fakeElement("Author Keyword");
  heading.parentElement = fakeElement("", { "a, span, li": [] });
  const emptySibling = fakeElement("", { "a, span, button, li": [] });
  const keywordSibling = fakeElement("", {
    "a, span, button, li": [fakeElement("gamma"), fakeElement("delta")]
  });
  heading.nextElementSibling = emptySibling;
  setSiblings([emptySibling, keywordSibling]);

  installFakeDOM({ heading });

  const result = extractFromDOM();
  assert.equal(result.source, "heading");
  assert.deepEqual(result.keywords, ["gamma", "delta"]);
});

test("extractFromDOM: extracts from heading grandparent when parent and siblings are empty", () => {
  const heading = fakeElement("Author Keywords");
  const parent = fakeElement("", { "a, span, li": [] });
  const grandparent = fakeElement("", {
    "a": [
      fakeElement("Author Keywords"),
      fakeElement("epsilon"),
      fakeElement("zeta")
    ]
  });
  heading.parentElement = parent;
  parent.parentElement = grandparent;

  installFakeDOM({ heading });

  const result = extractFromDOM();
  assert.equal(result.source, "heading");
  assert.deepEqual(result.keywords, ["epsilon", "zeta"]);
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

// ── id-exact strategy ────────────────────────────────────────────────────────

function fakeSpan(text) {
  return { textContent: text, querySelectorAll: () => [] };
}

function fakeEl(selectorMap = {}) {
  return {
    textContent: Object.values(selectorMap).flat().map(e => e.textContent).join(" "),
    querySelectorAll(sel) { return selectorMap[sel] ?? []; },
    getElementById: undefined,
  };
}

function installIdExactDOM({ authorEl = null, indexedEl = null } = {}) {
  globalThis.NodeFilter = { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_SKIP: 3 };
  globalThis.document = {
    body: fakeElement("body"),
    getElementById(id) {
      if (id === "document-details-author-keywords") return authorEl;
      if (id === "document-details-indexed-keywords") return indexedEl;
      return null;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createTreeWalker(_root, _whatToShow, _filter) {
      return { nextNode() { return null; } };
    },
  };
}

test("extractFromDOM (id-exact): extracts author keywords by ID", () => {
  const authorEl = fakeEl({
    "a, button, span[class], li": [
      fakeElement("machine learning"),
      fakeElement("neural networks"),
    ]
  });

  installIdExactDOM({ authorEl });

  const result = extractFromDOM();
  assert.equal(result.source, "id-exact");
  assert.deepEqual(result.keywords, ["machine learning", "neural networks"]);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].type, "author");
  assert.deepEqual(result.groups[0].keywords, ["machine learning", "neural networks"]);
});

test("extractFromDOM (id-exact): parses indexed dl/dt/dd subgroups", () => {
  function fakeDl(labelText, kwText) {
    const dtStrong = { textContent: labelText };
    const ddSpan = { textContent: kwText };
    return {
      querySelector(sel) {
        if (sel === "dt") return { textContent: labelText };
        return null;
      },
      querySelectorAll(sel) {
        if (sel === "dd span, dd a, dd li") return [{ textContent: kwText }];
        return [];
      },
    };
  }

  const indexedEl = {
    querySelectorAll(sel) {
      if (sel === "dl") return [
        fakeDl("Engineering controlled terms", "Antennas; Deep learning"),
        fakeDl("Engineering uncontrolled terms", "Aerial vehicle; Implementation"),
        fakeDl("Engineering main heading", "Optimization"),
      ];
      return [];
    },
  };

  installIdExactDOM({ indexedEl });

  const result = extractFromDOM();
  assert.equal(result.source, "id-exact");

  const types = result.groups.map(g => g.type);
  assert.ok(types.includes("indexed-controlled"), "should have indexed-controlled");
  assert.ok(types.includes("indexed-uncontrolled"), "should have indexed-uncontrolled");

  const controlled = result.groups.find(g => g.type === "indexed-controlled");
  assert.deepEqual(controlled.keywords, ["Antennas", "Deep learning"]);

  const uncontrolled = result.groups.find(g => g.type === "indexed-uncontrolled");
  assert.deepEqual(uncontrolled.keywords, ["Aerial vehicle", "Implementation"]);

  assert.ok(result.keywords.includes("Antennas"));
  assert.ok(result.keywords.includes("Aerial vehicle"));
  assert.ok(result.keywords.includes("Optimization"));
});

test("extractFromDOM (id-exact): merges author + indexed keywords into flat list, deduped", () => {
  const authorEl = fakeEl({
    "a, button, span[class], li": [fakeElement("UAV"), fakeElement("Deep learning")]
  });

  function fakeDl(label, text) {
    return {
      querySelector() { return { textContent: label }; },
      querySelectorAll(sel) {
        return sel === "dd span, dd a, dd li" ? [{ textContent: text }] : [];
      },
    };
  }

  const indexedEl = {
    querySelectorAll(sel) {
      if (sel === "dl") return [fakeDl("Engineering controlled terms", "Deep learning; Wireless networks")];
      return [];
    },
  };

  installIdExactDOM({ authorEl, indexedEl });

  const result = extractFromDOM();
  assert.equal(result.source, "id-exact");
  // "Deep learning" appears in both author and indexed → deduped in flat keywords
  const deepLearningCount = result.keywords.filter(k => k === "Deep learning").length;
  assert.equal(deepLearningCount, 1);
  assert.ok(result.keywords.includes("UAV"));
  assert.ok(result.keywords.includes("Wireless networks"));
});

test("extractFromDOM (id-exact): returns null when both IDs missing and no fallbacks match", () => {
  installIdExactDOM();
  assert.equal(extractFromDOM(), null);
});

test("extractFromDOM (id-exact): falls back to flat extraction when indexed has no dl elements", () => {
  const indexedEl = {
    querySelectorAll(sel) {
      if (sel === "dl") return [];
      if (sel === "a, span[class], li") return [{ textContent: "fallback-kw" }];
      return [];
    },
  };

  installIdExactDOM({ indexedEl });

  const result = extractFromDOM();
  assert.equal(result.source, "id-exact");
  assert.ok(result.keywords.includes("fallback-kw"));
  assert.equal(result.groups[0].type, "indexed");
});
