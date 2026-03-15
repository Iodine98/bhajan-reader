/**
 * app.js — entry point, wires all modules together.
 */
import { parse } from './modules/parser.js';
import { translate } from './modules/translator.js';
import { Cursor } from './modules/cursor.js';
import { Renderer } from './modules/renderer.js';
import { AudioOnsetDetector } from './modules/audio.js';
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
const micStatus = document.getElementById('mic-status');
const vuMeter = document.getElementById('vu-meter');
const prevWordBtn = document.getElementById('prev-word-btn');
const nextWordBtn = document.getElementById('next-word-btn');
const prevPhraseBtn = document.getElementById('prev-phrase-btn');
const nextPhraseBtn = document.getElementById('next-phrase-btn');
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

let activeLang = 'en';
let currentDoc = null;

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
    }
  });

  // Nothing else to do in display mode — wait for operator
  setStatus('Waiting for operator…');
} else {
  // ── Operator mode setup ─────────────────────────────────────────────────────
  setupKeyboard(cursor);
  restoreSettings();
  setupFileUpload();
  setupTheme();
  setupLanguageToggle();
  setupSettings();
  setupMic();
  setupControlBar();
  setupDragDrop();
}

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

function loadDocument(doc) {
  currentDoc = doc;
  const title = doc.meta?.title ?? 'Bhajan';
  titleEl.textContent = title;
  document.title = title + ' — Bhajan Reader';
  renderer.render(doc, activeLang);
  cursor.load(doc);
  emptyState.hidden = true;
  if (!broadcast.isDisplay) exportBtn.disabled = false;
  setStatus('Ready. Use Space / → to advance.');
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

async function handleFile(file) {
  showLoading('Parsing file…');
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
    doc = await translate(parsed, apiKey, msg => setLoadingMsg(msg));
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
  const isLight = theme === 'light';
  themeIconMoon.hidden = isLight;
  themeIconSun.hidden = !isLight;
  themeBtn.title = isLight ? 'Switch to dark theme' : 'Switch to light theme';
}

// ── Language toggle ───────────────────────────────────────────────────────────

function setupLanguageToggle() {
  langSelect.addEventListener('change', () => setLang(langSelect.value));
}

function setLang(lang) {
  activeLang = lang;
  const transLabelEl = document.getElementById('trans-label');
  if (transLabelEl) transLabelEl.textContent = lang === 'nl' ? 'Dutch' : 'English';
  if (!broadcast.isDisplay) {
    langSelect.value = lang;
  }
  renderer.setLang(lang);
  if (!broadcast.isDisplay) broadcast.emitLang(lang);
  // Re-apply current highlight after re-render
  if (currentDoc && cursor.currentPhrase) renderer.onCursorUpdate(cursor.getState());
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
}

// ── Microphone ────────────────────────────────────────────────────────────────

let micActive = false;

function setupMic() {
  micBtn.addEventListener('click', toggleMic);
}

async function toggleMic() {
  if (micActive) {
    audio.stop();
    micActive = false;
    micBtn.classList.remove('active');
    micBtn.title = 'Enable microphone onset detection';
    micStatus.textContent = 'Mic off';
    vuMeter.style.setProperty('--level', '0%');
  } else {
    try {
      audio.onOnset = () => cursor.advance();
      audio.onRms = rms => {
        const pct = Math.min(100, Math.round(rms * 600));
        vuMeter.style.setProperty('--level', pct + '%');
      };
      await audio.start();
      micActive = true;
      micBtn.classList.add('active');
      micBtn.title = 'Disable microphone onset detection';
      micStatus.textContent = 'Mic on';
    } catch (err) {
      setStatus('Mic error: ' + err.message + '. Use keyboard instead.');
    }
  }
}

// ── API key verification ──────────────────────────────────────────────────────

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
  setStatus(`Phrase ${current} / ${total}  ·  Space or → to advance  ·  ↑/↓ for phrases`);
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
