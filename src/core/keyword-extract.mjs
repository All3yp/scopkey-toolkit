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

  const testidSection = document.querySelector('[data-testid*="keyword" i], [data-testid*="Keyword"]');
  if (testidSection) {
    const kws = textsOf(testidSection.querySelectorAll("a, button, span[class], li"));
    if (kws.length > 0) return { source: "testid", keywords: deduped(kws) };
  }

  const headingWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        const t = node.textContent.trim().toLowerCase();
        return t === "author keywords" || t === "author keyword"
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    }
  );

  const heading = headingWalker.nextNode();
  if (heading) {
    const isHeadingLabel = t => /^author\s*keywords?$/i.test(t);
    const parent = heading.parentElement;

    if (parent) {
      const links = textsOf(parent.querySelectorAll("a")).filter(t => !isHeadingLabel(t));
      if (links.length > 0) return { source: "heading-parent", keywords: deduped(links) };
    }

    let sibling = heading.nextElementSibling;
    for (let i = 0; i < 5 && sibling; i++) {
      const links = textsOf(sibling.querySelectorAll("a, span, button"));
      if (links.length > 0) return { source: "heading-sibling", keywords: deduped(links) };
      sibling = sibling.nextElementSibling;
    }

    const grandparent = heading.parentElement?.parentElement;
    if (grandparent) {
      const links = textsOf(grandparent.querySelectorAll("a")).filter(t => !isHeadingLabel(t));
      if (links.length > 0) return { source: "heading-grandparent", keywords: deduped(links) };
    }
  }

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
      const kws = textsOf(container.querySelectorAll("a, span, button, li"));
      if (kws.length > 0) return { source: `class:${sel}`, keywords: deduped(kws) };
    }
  }

  const idSection = document.querySelector("[id*='keyword' i]");
  if (idSection) {
    const kws = textsOf(idSection.querySelectorAll("a, span, li"));
    if (kws.length > 0) return { source: "id", keywords: deduped(kws) };
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
