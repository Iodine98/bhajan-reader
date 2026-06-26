/**
 * app.js — entry point, wires all modules together.
 */
import { parse } from './modules/parser.js';
import { translate } from './modules/translator.js';
import { Cursor } from './modules/cursor.js';
import { Renderer } from './modules/renderer.js';
import { AudioOnsetDetector } from './modules/audio.js';
import { SpeechRecognizer, ServerSpeechRecognizer, normalizeRom, devanagariToLatin } from './modules/speech.js';
import { setI18nLang, t } from './modules/i18n.js';
import { setupKeyboard } from './modules/keyboard.js';
import { BroadcastSync } from './modules/broadcast.js';

// ── DOM references ────────────────────────────────────────────────────────────

const saPanel = document.getElementById('panel-sa');
const transPanel = document.getElementById('panel-trans');
const titleEl = document.getElementById('bhajan-title');
const fileInput = document.getElementById('file-input');
const uploadBtn = document.getElementById('upload-btn');
const exportBtn = document.getElementById('export-btn');
const langSelect = document.getElementById('lang-select');
const themeBtn = document.getElementById('theme-btn');
const themeIconMoon = document.getElementById('theme-icon-moon');
const themeIconSun = document.getElementById('theme-icon-sun');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const apiKeyInput = document.getElementById('api-key-input');
const verifyKeyBtn = document.getElementById('verify-key-btn');
const keyStatus = document.getElementById('key-status');
const openDisplayBtn = document.getElementById('open-display-btn');
const thresholdInput = document.getElementById('threshold-input');
const thresholdValue = document.getElementById('threshold-value');
const refractoryInput = document.getElementById('refractory-input');
const refractoryValue = document.getElementById('refractory-value');
const micBtn = document.getElementById('mic-btn');
const micModeSelect = document.getElementById('mic-mode');
const micStatus = document.getElementById('mic-status');
const vuMeter = document.getElementById('vu-meter');
const speechSettings = document.getElementById('speech-settings');
const speechLangSelect = document.getElementById('speech-lang');
const prevWordBtn = document.getElementById('prev-word-btn');
const nextWordBtn = document.getElementById('next-word-btn');
const prevPhraseBtn = document.getElementById('prev-phrase-btn');
const nextPhraseBtn = document.getElementById('next-phrase-btn');
const rewindBtn = document.getElementById('rewind-btn');
const statusBar = document.getElementById('status-bar');
const dropOverlay = document.getElementById('drop-overlay');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingMsg = document.getElementById('loading-msg');
const emptyState = document.getElementById('empty-state');

// ── Module instances ──────────────────────────────────────────────────────────

const cursor = new Cursor();
const renderer = new Renderer(saPanel, transPanel);
const audio = new AudioOnsetDetector();
const broadcast = new BroadcastSync();

let activeRecognizer = null; // SpeechRecognizer or ServerSpeechRecognizer, set on start

let activeLang = 'en';
let currentDoc = null;
let micMode = 'onset'; // 'onset' | 'speech'

// Flat word list for speech matching: [{ phraseIdx, wordIdx, norm }]
let flatWords = [];
let searchPtr = 0;

// ── Display mode (projector window) ──────────────────────────────────────────

if (broadcast.isDisplay) {
  document.body.classList.add('display-mode');

  broadcast.onMessage(msg => {
    switch (msg.type) {
      case 'load':
        loadDocument(msg.doc);
        break;
      case 'cursor':
        cursor.jumpTo(msg.state.globalPhraseIndex, msg.state.wordIndex);
        break;
      case 'lang':
        setLang(msg.lang);
        break;
      case 'theme':
        applyTheme(msg.theme);
        break;
      case 'state':
        if (msg.doc)    loadDocument(msg.doc);
        if (msg.lang)   setLang(msg.lang);
        if (msg.theme)  applyTheme(msg.theme);
        if (msg.cursor) cursor.jumpTo(msg.cursor.globalPhraseIndex, msg.cursor.wordIndex);
        break;
    }
  });

  // Ask operator for its current state (handles display opening after doc is loaded)
  broadcast.requestState();

  // Nothing else to do in display mode — wait for operator
  setStatus(t('waitingOperator'));
} else {
  // ── Operator mode setup ─────────────────────────────────────────────────────
  setupKeyboard(cursor);
  restoreSettings();
  setupFileUpload();
  setupTheme();
  setupLanguageToggle();
  setupSettings();
  setupMic();
  setupMicMode();
  setupControlBar();
  setupDragDrop();

  // Respond to display windows requesting current state (e.g. opened after doc is loaded)
  broadcast.onMessage(msg => {
    if (msg.type === 'state-request') {
      broadcast.emitState({
        doc:    currentDoc,
        lang:   activeLang,
        theme:  document.documentElement.dataset.theme,
        cursor: cursor.getState(),
      });
    }
  });
}

// ── Test hooks (harmless in production) ──────────────────────────────────────
window._loadTestDoc = loadDocument;
window._handleSpeechWords = handleWords;

// ── Cursor → renderer + broadcast ────────────────────────────────────────────

cursor.on(state => {
  if (currentDoc) {
    renderer.onCursorUpdate(state);
    if (!broadcast.isDisplay) {
      broadcast.emitCursor(state);
      updateProgress();
    }
  }
});

// ── Load a translated document ────────────────────────────────────────────────

/**
 * Mount a translated BhajanDocument into the UI and reset cursor to start.
 * Also rebuilds the flat word list used by speech-matching.
 * @param {{ meta: Object, verses: Array }} doc - Translated document from translator.js.
 */
function loadDocument(doc) {
  currentDoc = doc;
  const title = doc.meta?.title ?? 'Bhajan';
  titleEl.textContent = title;
  document.title = title + ' — Bhajan Reader';
  renderer.render(doc, activeLang);
  cursor.load(doc);
  emptyState.hidden = true;
  if (!broadcast.isDisplay) exportBtn.disabled = false;
  setStatus(t('ready'));

  // Build flat word list for speech matching
  flatWords = [];
  searchPtr = 0;
  let phraseIdx = 0;
  for (const verse of doc.verses) {
    for (const phrase of verse.phrases) {
      for (let wi = 0; wi < (phrase.rom ?? []).length; wi++) {
        flatWords.push({ phraseIdx, wordIdx: wi, norm: normalizeRom(phrase.rom[wi]) });
      }
      phraseIdx++;
    }
  }
}

function exportTranslation() {
  if (!currentDoc) return;
  const title = (currentDoc.meta?.title ?? 'bhajan')
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const filename = `${title}.json`;
  const json = JSON.stringify(currentDoc, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── File upload ───────────────────────────────────────────────────────────────

function setupFileUpload() {
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    fileInput.value = '';
  });
  exportBtn.addEventListener('click', exportTranslation);
}

/**
 * Read, parse, translate, and load a .bhajan File object.
 * Shows loading overlay and updates status bar throughout.
 * @param {File} file - File selected by the user or dropped onto the page.
 */
async function handleFile(file) {
  showLoading(t('loadingParsing'));
  let text;
  try {
    text = await file.text();
  } catch (err) {
    hideLoading();
    setStatus('Could not read file: ' + err.message);
    return;
  }

  let parsed;
  try {
    parsed = parse(text);
  } catch (err) {
    hideLoading();
    setStatus('Parse error: ' + err.message);
    return;
  }

  const apiKey = localStorage.getItem('claude-api-key') ?? '';
  let doc;
  try {
    doc = await translate(parsed, apiKey, msg => setLoadingMsg(msg), t);
  } catch (err) {
    hideLoading();
    setStatus('Error: ' + err.message);
    return;
  }

  hideLoading();
  loadDocument(doc);
  broadcast.emitLoad(doc);
}

// ── Theme toggle ──────────────────────────────────────────────────────────────

function setupTheme() {
  const saved = localStorage.getItem('theme') ?? 'dark';
  applyTheme(saved);
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('theme', next);
  });
}

function applyTheme(theme) {
  // Set on <html> so [data-theme="light"] overrides :root custom properties
  // at the same specificity level (both 0,1,0 — later rule wins).
  document.documentElement.dataset.theme = theme;
  if (!broadcast.isDisplay) {
    const isLight = theme === 'light';
    themeIconMoon.toggleAttribute('hidden', isLight);
    themeIconSun.toggleAttribute('hidden', !isLight);
    themeBtn.title = isLight ? t('themeToDark') : t('themeToLight');
    broadcast.emitTheme(theme);
  }
}

// ── Language toggle ───────────────────────────────────────────────────────────

function setupLanguageToggle() {
  langSelect.addEventListener('change', () => setLang(langSelect.value));
}

/**
 * Switch the translation language shown in the right panel.
 * Updates the renderer, i18n module, localStorage, and broadcasts to display windows.
 * @param {string} lang - Language code ('en' or 'nl').
 */
function setLang(lang) {
  activeLang = lang;
  setI18nLang(lang);
  applyI18n();
  if (!broadcast.isDisplay) {
    langSelect.value = lang;
    localStorage.setItem('lang', lang);
  }
  renderer.setLang(lang);
  if (!broadcast.isDisplay) broadcast.emitLang(lang);
  // Re-apply current highlight after re-render
  if (currentDoc && cursor.currentPhrase) renderer.onCursorUpdate(cursor.getState());
}

/**
 * Re-apply UI strings for the active language to all [data-i18n] elements.
 * Called after setI18nLang() to refresh every labelled DOM node at once.
 */
function applyI18n() {
  // Update textContent for all [data-i18n] elements
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  // Update title attribute for all [data-i18n-title] elements
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
  // Panel label always shows the current translation language name
  const transLabelEl = document.getElementById('trans-label');
  if (transLabelEl) transLabelEl.textContent = t('panelCurrent');
  // Status bar: update only if no doc is loaded (otherwise progress text owns it)
  if (!currentDoc) setStatus(t('initialStatus'));
}

// ── Settings modal ────────────────────────────────────────────────────────────

function setupSettings() {
  settingsBtn.addEventListener('click', () => {
    settingsModal.showModal();
    apiKeyInput.value = localStorage.getItem('claude-api-key') ?? '';
    keyStatus.textContent = '';
    keyStatus.className = '';
    keyStatus.title = '';
  });

  // Clear the status indicator when the key is edited
  apiKeyInput.addEventListener('input', () => {
    keyStatus.textContent = '';
    keyStatus.className = '';
    keyStatus.title = '';
  });

  verifyKeyBtn.addEventListener('click', () => verifyApiKey(apiKeyInput.value.trim()));

  settingsClose.addEventListener('click', () => {
    localStorage.setItem('claude-api-key', apiKeyInput.value.trim());
    settingsModal.close();
  });

  settingsModal.addEventListener('click', e => {
    if (e.target === settingsModal) {
      localStorage.setItem('claude-api-key', apiKeyInput.value.trim());
      settingsModal.close();
    }
  });

  thresholdInput.addEventListener('input', () => {
    const v = parseFloat(thresholdInput.value);
    thresholdValue.textContent = v.toFixed(1) + '×';
    audio.setThreshold(v);
    localStorage.setItem('onset-threshold', v);
  });

  refractoryInput.addEventListener('input', () => {
    const v = parseInt(refractoryInput.value, 10);
    refractoryValue.textContent = v + ' ms';
    audio.setRefractory(v);
    localStorage.setItem('onset-refractory', v);
  });

  openDisplayBtn.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', 'display');
    window.open(url.toString(), '_blank');
  });
}

function restoreSettings() {
  const threshold = parseFloat(localStorage.getItem('onset-threshold') ?? '2.5');
  const refractory = parseInt(localStorage.getItem('onset-refractory') ?? '300', 10);
  thresholdInput.value = threshold;
  thresholdValue.textContent = threshold.toFixed(1) + '×';
  refractoryInput.value = refractory;
  refractoryValue.textContent = refractory + ' ms';
  audio.setThreshold(threshold);
  audio.setRefractory(refractory);

  const savedLang = localStorage.getItem('lang') ?? 'en';
  setLang(savedLang);
}

// ── Microphone ────────────────────────────────────────────────────────────────

let micActive = false;

function setupMic() {
  micBtn.addEventListener('click', toggleMic);
}

/**
 * Initialise the microphone mode selector (onset vs. speech) from localStorage,
 * wire up the change handler, and restore the speech recognition language.
 */
function setupMicMode() {
  // Restore saved mode
  const savedMode = localStorage.getItem('mic-mode') ?? 'onset';
  micMode = savedMode;
  micModeSelect.value = savedMode;
  updateMicModeUI();

  micModeSelect.addEventListener('change', () => {
    if (micActive) toggleMic(); // stop current mode first
    micMode = micModeSelect.value;
    localStorage.setItem('mic-mode', micMode);
    updateMicModeUI();
  });

  // Restore speech language
  const savedLang = localStorage.getItem('speech-lang') ?? 'hi-IN';
  if (speechLangSelect) {
    speechLangSelect.value = savedLang;
    speechLangSelect.addEventListener('change', () => {
      if (activeRecognizer) activeRecognizer.lang = speechLangSelect.value;
      localStorage.setItem('speech-lang', speechLangSelect.value);
    });
  }
}

function updateMicModeUI() {
  const isSpeech = micMode === 'speech';
  document.body.classList.toggle('speech-mode', isSpeech);
  if (speechSettings) speechSettings.hidden = !isSpeech;
}

/**
 * Toggle the microphone on or off for the currently selected mode (onset/speech).
 * On first activation, requests browser mic permission. Updates button UI and status bar.
 */
async function toggleMic() {
  if (micActive) {
    audio.stop();
    if (activeRecognizer) { activeRecognizer.stop(); activeRecognizer = null; }
    micActive = false;
    micBtn.classList.remove('active');
    micBtn.title = t('micEnableTitle');
    micStatus.textContent = t('micOff');
    vuMeter.style.setProperty('--level', '0%');
  } else {
    if (micMode === 'speech') {
      const lang = speechLangSelect?.value ?? 'hi-IN';
      // Prefer native Web Speech API (Chrome); fall back to server-side for Firefox etc.
      activeRecognizer = SpeechRecognizer.isSupported()
        ? new SpeechRecognizer()
        : new ServerSpeechRecognizer();
      activeRecognizer.lang = lang;
      activeRecognizer.onWords = handleWords;
      activeRecognizer.onError = err => setStatus('Speech error: ' + err);
      activeRecognizer.onRms = rms => {
        // rms * 600: maps the typical RMS range (0–0.17) to roughly 0–100%
        // for the VU meter CSS custom property. The factor is empirical.
        const pct = Math.min(100, Math.round(rms * 600));
        vuMeter.style.setProperty('--level', pct + '%');
      };
      try {
        await activeRecognizer.start();
        micActive = true;
        micBtn.classList.add('active');
        micBtn.title = t('micSpeechOffTitle');
        micStatus.textContent = t('listening');
      } catch (err) {
        activeRecognizer = null;
        setStatus('Speech error: ' + err.message);
      }
    } else {
      try {
        audio.onOnset = () => cursor.advance();
        audio.onRms = rms => {
          const pct = Math.min(100, Math.round(rms * 600)); // empirical scale — see speech mode comment above
          vuMeter.style.setProperty('--level', pct + '%');
        };
        await audio.start();
        micActive = true;
        micBtn.classList.add('active');
        micBtn.title = t('micOnsetOffTitle');
        micStatus.textContent = t('micOn');
      } catch (err) {
        setStatus('Mic error: ' + err.message + '. Use keyboard instead.');
      }
    }
  }
}

// ── Speech word matching ───────────────────────────────────────────────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Match a batch of recognized word tokens against the flat word list and jump
 * the cursor to the best match. Called by both SpeechRecognizer and ServerSpeechRecognizer.
 * @param {string[]} words - Raw tokens from the speech recognizer.
 */
function handleWords(words) {
  if (!flatWords.length) return;
  for (const raw of words) {
    const token = devanagariToLatin(raw).toLowerCase().replace(/[^a-z]/g, '');
    if (!token) continue;
    // 40% Levenshtein threshold: tuned for short Sanskrit tokens where 1–2 char
    // differences (vowel length, nasalisation) are common recognition errors.
    const threshold = Math.max(1, Math.floor(token.length * 0.4));

    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < flatWords.length; i++) {
      const ref = flatWords[i].norm;
      let dist = levenshtein(token, ref);
      // A short token that is a prefix of a longer reference word (e.g. "bhur"
      // matching "bhurbhuvah") should count as a strong match — the recognizer
      // often splits compound Sanskrit words mid-word.
      // Prefix-match bonus: speech recognisers often split compound Sanskrit
      // words mid-word (e.g. "bhur" for "bhurbhuvah"), so a short token that
      // is a prefix of a reference word counts as a zero-distance match.
      if (token.length >= 3 && ref.startsWith(token)) dist = 0;
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }

    if (bestIdx >= 0 && bestDist <= threshold) {
      searchPtr = bestIdx;
      const { phraseIdx, wordIdx } = flatWords[bestIdx];
      cursor.jumpTo(phraseIdx, wordIdx);
      setStatus(`Heard: "${token}" → ${flatWords[bestIdx].norm}`);
    } else {
      const closest = bestIdx >= 0 ? flatWords[bestIdx].norm : '—';
      setStatus(`Heard: "${token}" · no match (closest: ${closest}, dist ${bestDist})`);
    }
  }
}

// ── API key verification ──────────────────────────────────────────────────────

/**
 * POST a minimal request to /api/anthropic to verify the given API key.
 * Updates the keyStatus indicator element with ✓ / ✗ / ? accordingly.
 * @param {string} key - Raw API key from the settings input.
 */
async function verifyApiKey(key) {
  if (!key) {
    keyStatus.textContent = '✗';
    keyStatus.className = 'invalid';
    return;
  }

  keyStatus.textContent = '↻';
  keyStatus.className = 'checking';
  verifyKeyBtn.disabled = true;

  try {
    const response = await fetch('/api/anthropic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    if (response.ok || response.status === 529) {
      // 529 = overloaded, but key is valid
      keyStatus.textContent = '✓';
      keyStatus.className = 'valid';
      keyStatus.title = 'API key is valid and has been saved.';
      localStorage.setItem('claude-api-key', key);
    } else if (response.status === 401) {
      keyStatus.textContent = '✗';
      keyStatus.className = 'invalid';
      keyStatus.title = 'Invalid API key. Check that you copied it correctly from console.anthropic.com.';
    } else {
      // Other errors (network, 500s) — treat as unknown, not invalid
      keyStatus.textContent = '?';
      keyStatus.className = '';
      keyStatus.title = `Could not reach the Anthropic API (HTTP ${response.status}). Check your internet connection and try again. Your key may still be valid.`;
    }
  } catch (err) {
    keyStatus.textContent = '?';
    keyStatus.className = '';
    keyStatus.title = `Verification failed: ${err.message}. Check your internet connection and try again. Your key may still be valid.`;
  } finally {
    verifyKeyBtn.disabled = false;
  }
}

// ── Control bar buttons ───────────────────────────────────────────────────────

function setupControlBar() {
  prevWordBtn.addEventListener('click', () => cursor.retreat());
  nextWordBtn.addEventListener('click', () => cursor.advance());
  prevPhraseBtn.addEventListener('click', () => cursor.retreatPhrase());
  nextPhraseBtn.addEventListener('click', () => cursor.advancePhrase());
  rewindBtn.addEventListener('click', () => cursor.jumpTo(0, 0));
}

// ── Drag-and-drop ─────────────────────────────────────────────────────────────

function setupDragDrop() {
  document.addEventListener('dragover', e => {
    e.preventDefault();
    dropOverlay.hidden = false;
  });

  document.addEventListener('dragleave', e => {
    if (!e.relatedTarget) dropOverlay.hidden = true;
  });

  document.addEventListener('drop', e => {
    e.preventDefault();
    dropOverlay.hidden = true;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function setStatus(msg) {
  statusBar.textContent = msg;
}

function updateProgress() {
  if (!currentDoc) return;
  const total = cursor.totalPhrases;
  const current = cursor.globalPhraseIndex + 1;
  setStatus(t('phrase', current, total));
}

function showLoading(msg) {
  loadingMsg.textContent = msg;
  loadingOverlay.hidden = false;
}

function setLoadingMsg(msg) {
  loadingMsg.textContent = msg;
}

function hideLoading() {
  loadingOverlay.hidden = true;
}
