export function extractAbstractFromDOM() {
  const section = document.querySelector('[id="document-details-abstract"]');
  if (!section) return null;

  const textEl = section.querySelector('p');
  if (!textEl) return null;

  const text = textEl.textContent.trim();
  return text.length > 0 ? text : null;
}
