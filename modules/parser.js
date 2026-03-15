/**
 * parser.js — parses the .bhajan plain-text format into a JS object.
 *
 * Format:
 *   # title: Gayatri Mantra
 *   # composer: Unknown
 *   ---
 *   [verse:1]
 *   ॐ भूर्भुवः स्वः
 *   तत्सवितुर्वरेण्यं
 *   ---
 *
 * Returns: { meta: { title, composer, ... }, verses: [{ id, lines: [string] }] }
 */
export function parse(text) {
  // Strip BOM if present
  const raw = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const lines = raw.split(/\r?\n/);

  const meta = {};
  const verses = [];
  let currentVerse = null;
  let inBody = false;

  for (let line of lines) {
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Meta comment lines: # key: value
    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/^#\s*([^:]+)\s*:\s*(.+)$/);
      if (match) {
        meta[match[1].trim().toLowerCase()] = match[2].trim();
      }
      continue;
    }

    // Body delimiter ---
    if (trimmed === '---') {
      inBody = !inBody;
      continue;
    }

    if (!inBody) continue;

    // Verse/section marker [verse:1] or [chorus] etc.
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentVerse = { id: sectionMatch[1].trim(), lines: [] };
      verses.push(currentVerse);
      continue;
    }

    // Sanskrit content line
    if (currentVerse) {
      currentVerse.lines.push(trimmed);
    } else {
      // Content before any verse marker — create implicit verse
      currentVerse = { id: 'verse:1', lines: [trimmed] };
      verses.push(currentVerse);
    }
  }

  if (verses.length === 0) {
    throw new Error('No verses found. Check that your file uses the correct format.');
  }

  return { meta, verses };
}
