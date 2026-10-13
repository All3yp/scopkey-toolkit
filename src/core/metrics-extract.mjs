const KEYWORD_SECTION_IDS = [
  "document-details-author-keywords",
  "document-details-indexed-keywords",
];

function normalize(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function toNumber(text) {
  const match = normalize(text).replace(/,/g, "").match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function isInsideKeywordSection(el) {
  if (typeof el.closest !== "function") return false;
  return KEYWORD_SECTION_IDS.some((id) => el.closest(`#${id}`));
}

export function extractMetricsFromDOM() {
  const details = {};

  for (const dl of document.querySelectorAll("dl")) {
    if (isInsideKeywordSection(dl)) continue;
    const labels = [...dl.querySelectorAll("dt")];
    const values = [...dl.querySelectorAll("dd")];
    for (let i = 0; i < labels.length; i++) {
      const label = normalize(labels[i].textContent).replace(/\s*:\s*$/, "");
      const value = normalize(values[i]?.textContent);
      if (label && value && !(label in details)) details[label] = value;
    }
  }

  const bodyText = normalize(document.body?.innerText);
  const citedMatch = bodyText.match(/Cited by\s+([\d.,]+)/i);
  const referenceMatch =
    bodyText.match(/([\d.,]+)\s+References\b/i) ??
    bodyText.match(/References\s*\(([\d.,]+)\)/i);

  const metrics = {};
  if (citedMatch) metrics.citedBy = toNumber(citedMatch[1]);
  if (referenceMatch) metrics.references = toNumber(referenceMatch[1]);
  if (Object.keys(details).length > 0) metrics.details = details;

  return Object.keys(metrics).length > 0 ? metrics : null;
}
