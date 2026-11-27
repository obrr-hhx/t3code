/** Legacy goal mandates are data, not a paragraph of the user-facing progress summary. */
export function presentManagerContent(content: string) {
  const paragraphs: string[] = [];
  let scope = "",
    limits = "";
  for (const paragraph of content.split(/\n\s*\n/u)) {
    const text = paragraph.trim();
    if (/^\{\s*"(?:source_ids|actions|scope|exclusions)"\s*:/u.test(text)) {
      try {
        const metadata: unknown = JSON.parse(text);
        if (metadata && typeof metadata === "object") {
          if ("scope" in metadata && typeof metadata.scope === "string") scope = metadata.scope;
          if ("exclusions" in metadata && typeof metadata.exclusions === "string")
            limits = metadata.exclusions;
        }
      } catch {
        /* A bounded preview may stop halfway through the legacy metadata. */
      }
      continue;
    }
    if (text.startsWith("原始目标与全部证据保存在 ")) continue;
    if (text) paragraphs.push(text);
  }
  return { text: paragraphs.join("\n\n"), scope, limits };
}
