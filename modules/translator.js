/**
 * translator.js — calls Claude API to translate Sanskrit lines into
 * word-aligned English and Dutch phrase objects.
 *
 * Input:  parsed doc { meta, verses: [{ id, lines: [string] }] }
 * Output: translated doc { meta, verses: [{ id, phrases: [{ sa, en, nl }] }] }
 */

const API_URL = '/api/anthropic';
const MODEL = 'claude-haiku-4-5-20251001';
const CACHE_VERSION = 2;  // bump to invalidate old cached translations without rom field

export async function translate(parsedDoc, apiKey, onProgress) {
  // Collect all lines in order
  const allLines = [];
  for (const verse of parsedDoc.verses) {
    for (const line of verse.lines) {
      allLines.push(line);
    }
  }

  if (allLines.length === 0) {
    throw new Error('No lines to translate.');
  }

  const sourceHash = hashString(allLines.join('\n'));
  const cacheKey   = `bhajan-trans-v${CACHE_VERSION}-${sourceHash}`;
  const cacheFile  = `/translations/${sourceHash}.json`;

  // 1. Session cache (fastest)
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    onProgress?.('Loaded from cache.');
    return JSON.parse(cached);
  }

  // 2. Translations folder on disk
  try {
    const res = await fetch(cacheFile);
    if (res.ok) {
      const doc = await res.json();
      sessionStorage.setItem(cacheKey, JSON.stringify(doc));
      onProgress?.('Loaded from saved translation.');
      return doc;
    }
  } catch { /* network error — fall through to API */ }

  if (!apiKey) {
    onProgress?.('No API key — showing transliteration only.');
    return buildFallbackDocument(parsedDoc, sourceHash);
  }

  onProgress?.('Translating with Claude…');

  const prompt = buildPrompt(allLines);
  let responseText;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    responseText = data.content?.[0]?.text ?? '';
  } catch (err) {
    onProgress?.(`Translation failed: ${err.message}. Showing original.`);
    return buildFallbackDocument(parsedDoc, sourceHash);
  }

  // Extract JSON array from the response
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    onProgress?.('Could not parse Claude response. Showing original.');
    return buildFallbackDocument(parsedDoc, sourceHash);
  }

  let phrases;
  try {
    phrases = JSON.parse(jsonMatch[0]);
  } catch {
    onProgress?.('JSON parse error. Showing original.');
    return buildFallbackDocument(parsedDoc, sourceHash);
  }

  // Validate and normalise each phrase
  phrases = phrases.map((p, i) => {
    const sa = normaliseWords(p.sa ?? allLines[i]?.split(/\s+/) ?? []);
    return {
      sa,
      rom: normaliseWords(p.rom ?? sa),
      en:  normaliseWords(p.en ?? [allLines[i]]),
      nl:  normaliseWords(p.nl ?? [allLines[i]]),
    };
  });

  const doc = buildDocument(parsedDoc, phrases, sourceHash);

  // 3. Save to session cache and translations folder
  sessionStorage.setItem(cacheKey, JSON.stringify(doc));
  fetch(cacheFile, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  }).catch(() => { /* non-critical — ignore save errors */ });

  onProgress?.('Translation complete.');
  return doc;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildPrompt(lines) {
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
  return `You are a Sanskrit scholar specializing in bhajans and devotional texts.
Translate each numbered line into English and Dutch, and provide IAST transliteration.

Return ONLY a JSON array — no other text, no markdown fences.
Each element corresponds to one input line (same order).
Each element must have this exact structure:
{ "sa": ["word1", ...], "rom": ["iast1", ...], "en": ["word1", ...], "nl": ["word1", ...] }

Rules:
- Split Sanskrit on spaces (keep conjunct consonant clusters together).
- "rom": IAST transliteration of each Sanskrit word, in the same order and count as "sa".
- Split translations into natural short word groups (aim for 2–5 tokens per group).
- Keep "sa", "rom", "en", and "nl" the same length where linguistically sensible so words align visually.
- For untranslatable sacred syllables (ॐ, नमः) keep them as-is in "sa", give IAST in "rom", translate meaningfully in en/nl.

Lines:
${numbered}`;
}

function buildDocument(parsedDoc, phrases, sourceHash) {
  let idx = 0;
  const verses = parsedDoc.verses.map(verse => ({
    id: verse.id,
    phrases: verse.lines.map(() => phrases[idx++] ?? { sa: [], rom: [], en: [], nl: [] }),
  }));
  return { _format: 'bhajan-translated-v1', meta: { ...parsedDoc.meta, source_hash: sourceHash }, verses };
}

function buildFallbackDocument(parsedDoc, sourceHash) {
  const verses = parsedDoc.verses.map(verse => ({
    id: verse.id,
    phrases: verse.lines.map(line => {
      const words = line.split(/\s+/).filter(Boolean);
      return { sa: words, rom: words, en: words, nl: words };
    }),
  }));
  return { _format: 'bhajan-translated-v1', meta: { ...parsedDoc.meta, source_hash: sourceHash }, verses };
}

function normaliseWords(arr) {
  if (!Array.isArray(arr)) return [String(arr)];
  return arr.map(w => String(w).trim()).filter(Boolean);
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
