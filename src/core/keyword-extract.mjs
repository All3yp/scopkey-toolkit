export function extractFromDOM() {
  function textsOf(els) {
    return [...els].map(el => el.textContent.trim()).filter(Boolean);
  }

  function deduped(texts) {
    const seen = new Set();
    return texts
      .flatMap(t => t.split(/\s*[;|]\s*/))
      .map(t => t.trim())
      .filter(t => t.length > 1)
      .filter(t => { if (seen.has(t)) return false; seen.add(t); return true; });
  }

  function labelToType(label) {
    const l = label.toLowerCase();
    if (/author\s*keyword/.test(l)) return "author";
    if (/engineering\s*controlled/.test(l)) return "indexed-controlled";
    if (/engineering\s*uncontrolled/.test(l)) return "indexed-uncontrolled";
    if (/indexed/.test(l)) return "indexed";
    return "other";
  }

  // Strategy 1: exact Scopus IDs — structure: dl > dt(label) + dd(span with "kw1; kw2")
  const groups = [];

  const authorEl = document.getElementById("document-details-author-keywords");
  if (authorEl) {
    const kws = deduped(textsOf(authorEl.querySelectorAll("a, button, span[class], li")));
    if (kws.length) groups.push({ type: "author", keywords: kws });
  }

  const indexedEl = document.getElementById("document-details-indexed-keywords");
  if (indexedEl) {
    for (const dl of indexedEl.querySelectorAll("dl")) {
      const label = dl.querySelector("dt")?.textContent?.trim() ?? "";
      const type = labelToType(label) !== "other" ? labelToType(label) : "indexed";
      const kws = deduped(textsOf(dl.querySelectorAll("dd span, dd a, dd li")));
      if (kws.length) groups.push({ type, keywords: kws });
    }
    // Fallback if no dl found
    if (!groups.some(g => g.type !== "author")) {
      const kws = deduped(textsOf(indexedEl.querySelectorAll("a, span[class], li")));
      if (kws.length) groups.push({ type: "indexed", keywords: kws });
    }
  }

  if (groups.length > 0) {
    const allKws = [...new Set(groups.flatMap(g => g.keywords))];
    return { source: "id-exact", keywords: allKws, groups };
  }

  // Strategy 2: testid fallback — collect ALL keyword sections
  const testidSections = [...document.querySelectorAll('[data-testid*="keyword" i]')];
  if (testidSections.length > 0) {
    const tGroups = [];
    for (const section of testidSections) {
      const labelEl = section.querySelector('h2, h3, h4, h5, [class*="label" i], [class*="title" i], [class*="heading" i]')
        ?? section.previousElementSibling;
      const label = labelEl?.textContent?.trim() ?? "";
      const type = labelToType(label);
      const kws = deduped(textsOf(section.querySelectorAll("a, button, span[class], li")));
      if (kws.length > 0) tGroups.push({ type, keywords: kws });
    }
    if (tGroups.length > 0) {
      const allKws = [...new Set(tGroups.flatMap(g => g.keywords))];
      return { source: "testid", keywords: allKws, groups: tGroups };
    }
  }

  // Strategy 3: heading-based walker
  const allGroups = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const t = node.textContent.trim();
      return /^(author\s*keywords?|indexed\s*keywords?|engineering\s*(controlled|uncontrolled)\s*(terms?)?)/i.test(t)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });

  let heading;
  while ((heading = walker.nextNode())) {
    const label = heading.textContent.trim();
    const type = labelToType(label);
    const isLabel = t => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").test(t);
    const parent = heading.parentElement;
    let kws = [];
    if (parent) kws = deduped(textsOf(parent.querySelectorAll("a, span, li")).filter(t => !isLabel(t)));
    if (!kws.length) {
      let sib = heading.nextElementSibling;
      for (let i = 0; i < 5 && sib; i++) {
        kws = deduped(textsOf(sib.querySelectorAll("a, span, button, li")));
        if (kws.length) break;
        sib = sib.nextElementSibling;
      }
    }
    if (!kws.length && parent?.parentElement) {
      kws = deduped(textsOf(parent.parentElement.querySelectorAll("a")).filter(t => !isLabel(t)));
    }
    if (kws.length) allGroups.push({ type, keywords: kws });
  }

  if (allGroups.length > 0) {
    const allKws = [...new Set(allGroups.flatMap(g => g.keywords))];
    return { source: "heading", keywords: allKws, groups: allGroups };
  }

  // Strategy 3: class-based selectors
  const CLASS_SELECTORS = [
    "[class*='authorKeyword' i]",
    "[class*='keyword-group' i]",
    "[class*='keywordGroup' i]",
    "[class*='keywords-list' i]",
    "[class*='keyword-list' i]",
  ];
  for (const sel of CLASS_SELECTORS) {
    const container = document.querySelector(sel);
    if (container) {
      const kws = deduped(textsOf(container.querySelectorAll("a, span, button, li")));
      if (kws.length > 0) return { source: `class:${sel}`, keywords: kws };
    }
  }

  const idSection = document.querySelector("[id*='keyword' i]");
  if (idSection) {
    const kws = deduped(textsOf(idSection.querySelectorAll("a, span, li")));
    if (kws.length > 0) return { source: "id", keywords: kws };
  }

  return null;
}

export function extractFromText(bodyText) {
  const match = bodyText.match(/Author\s+[Kk]eywords?\s*\n?([\s\S]{0,800})/);
  if (!match) return [];

  const block = match[1];
  const stopMatch = block.match(/\n(?:References|Indexed keywords|Funding|Abstract|Publisher|ISSN|Source|Volume|Cited by)/i);
  const cleanBlock = stopMatch ? block.slice(0, stopMatch.index) : block;

  return cleanBlock
    .split(/\s*;\s*/)
    .map(x => x.trim().replace(/\n/g, " "))
    .filter(x => x.length > 1 && x.length < 120);
}
