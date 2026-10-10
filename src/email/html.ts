/** HTML escaping for email bodies. Every value from a form or the database goes through it. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** One HTML paragraph from plain text. */
export function paragraph(text: string): string {
  return `<p>${escapeHtml(text)}</p>`;
}

/** One HTML paragraph with a link. */
export function linkParagraph(label: string, url: string): string {
  return `<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`;
}
