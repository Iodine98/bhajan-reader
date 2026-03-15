/**
 * renderer.js — builds the two-panel DOM and handles highlight updates.
 *
 * Sanskrit panel phrases contain two sub-rows:
 *   .sa-row   — Devanagari words
 *   .rom-row  — IAST transliteration words
 * Both rows share the same data-word-index values, so a single CSS selector
 * highlights the matching word in both rows simultaneously.
 *
 * All word <span> elements are pre-built at load time.
 * Highlighting is a pure CSS-class toggle — no DOM reconstruction.
 */
export class Renderer {
  constructor(saContainer, transContainer) {
    this.saContainer = saContainer;
    this.transContainer = transContainer;
    this.activeLang = 'en';
    this.doc = null;
  }

  /** Render both panels from a translated BhajanDocument. */
  render(doc, lang = 'en') {
    this.doc = doc;
    this.activeLang = lang;
    this.saContainer.innerHTML = '';
    this.transContainer.innerHTML = '';

    let globalIndex = 0;
    for (const verse of doc.verses) {
      const saVerseEl  = this._verseEl(verse.id);
      const transVerseEl = this._verseEl(verse.id);

      for (const phrase of verse.phrases) {
        const g = globalIndex++;
        saVerseEl.appendChild(this._saPhraseEl(phrase, g));
        transVerseEl.appendChild(this._phraseEl(phrase[lang], g));
      }

      this.saContainer.appendChild(saVerseEl);
      this.transContainer.appendChild(transVerseEl);
    }
  }

  /** Switch translation language without re-rendering Sanskrit. */
  setLang(lang) {
    if (!this.doc || this.activeLang === lang) return;
    this.activeLang = lang;
    this.transContainer.innerHTML = '';

    let globalIndex = 0;
    for (const verse of this.doc.verses) {
      const transVerseEl = this._verseEl(verse.id);
      for (const phrase of verse.phrases) {
        transVerseEl.appendChild(this._phraseEl(phrase[lang], globalIndex++));
      }
      this.transContainer.appendChild(transVerseEl);
    }
  }

  /**
   * Update highlight classes based on cursor state.
   * All three rows (sa, rom, trans) highlight the single word at wordIndex.
   * No full-phrase background is applied.
   */
  onCursorUpdate({ globalPhraseIndex, wordIndex }) {
    // Clear all previous highlights
    for (const el of document.querySelectorAll('.word.active')) {
      el.classList.remove('active');
    }

    // Sanskrit phrase — highlight the single word (matches both .sa-row and .rom-row spans)
    const saPhrase = this.saContainer.querySelector(
      `.phrase[data-global-index="${globalPhraseIndex}"]`
    );
    if (saPhrase) {
      const wordEl = saPhrase.querySelector(`.word[data-word-index="${wordIndex}"]`);
      if (wordEl) wordEl.classList.add('active');
      // Also highlight the matching transliteration word
      const romEl = saPhrase.querySelector(`.rom-row .word[data-word-index="${wordIndex}"]`);
      if (romEl) romEl.classList.add('active');
      this._scrollIntoView(saPhrase, this.saContainer);
    }

    // Translation phrase — highlight the single word
    const transPhrase = this.transContainer.querySelector(
      `.phrase[data-global-index="${globalPhraseIndex}"]`
    );
    if (transPhrase) {
      const wordEl = transPhrase.querySelector(`.word[data-word-index="${wordIndex}"]`);
      if (wordEl) wordEl.classList.add('active');
      this._scrollIntoView(transPhrase, this.transContainer);
    }
  }

  // ── private helpers ────────────────────────────────────────────────────────

  _verseEl(id) {
    const div = document.createElement('div');
    div.className = 'verse';
    div.dataset.verseId = id;
    return div;
  }

  /** Sanskrit phrase: Devanagari row + IAST transliteration row. */
  _saPhraseEl(phrase, globalIndex) {
    const div = document.createElement('div');
    div.className = 'phrase';
    div.dataset.globalIndex = globalIndex;

    div.appendChild(this._wordRow(phrase.sa, 'sa-row'));
    div.appendChild(this._wordRow(phrase.rom ?? [], 'rom-row'));

    return div;
  }

  /** Translation panel phrase — flat word spans, no sub-rows needed. */
  _phraseEl(words, globalIndex) {
    const div = document.createElement('div');
    div.className = 'phrase';
    div.dataset.globalIndex = globalIndex;

    words.forEach((word, wi) => {
      if (wi > 0) div.appendChild(document.createTextNode(' '));
      const span = document.createElement('span');
      span.className = 'word';
      span.dataset.wordIndex = wi;
      span.textContent = word;
      div.appendChild(span);
    });

    return div;
  }

  _wordRow(words, rowClass) {
    const row = document.createElement('div');
    row.className = rowClass;

    words.forEach((word, wi) => {
      if (wi > 0) row.appendChild(document.createTextNode(' '));
      const span = document.createElement('span');
      span.className = 'word';
      span.dataset.wordIndex = wi;
      span.textContent = word;
      row.appendChild(span);
    });

    return row;
  }

  /** Scroll a phrase element into the vertical centre of its container. */
  _scrollIntoView(phraseEl, container) {
    const containerHeight = container.clientHeight;
    const phraseTop = phraseEl.offsetTop;
    const phraseHeight = phraseEl.offsetHeight;
    const target = phraseTop - containerHeight / 2 + phraseHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }
}
