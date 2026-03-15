/**
 * cursor.js — word/phrase position state machine.
 *
 * Maintains a flat list of all phrases across all verses and
 * tracks the current globalPhraseIndex + wordIndex within that phrase.
 *
 * All other modules subscribe to cursor changes via cursor.on(fn).
 */
export class Cursor {
  constructor() {
    this.flatPhrases = [];   // [{ globalIndex, verseIndex, verseId, phraseIndex, sa, en, nl }]
    this.globalPhraseIndex = 0;
    this.wordIndex = 0;
    this._listeners = [];
  }

  /** Load a translated BhajanDocument and reset position to start. */
  load(doc) {
    this.flatPhrases = [];
    let g = 0;
    for (let vi = 0; vi < doc.verses.length; vi++) {
      const verse = doc.verses[vi];
      for (let pi = 0; pi < verse.phrases.length; pi++) {
        this.flatPhrases.push({
          globalIndex: g++,
          verseIndex: vi,
          verseId: verse.id,
          phraseIndex: pi,
          ...verse.phrases[pi],
        });
      }
    }
    this.globalPhraseIndex = 0;
    this.wordIndex = 0;
    this._emit();
  }

  get currentPhrase() {
    return this.flatPhrases[this.globalPhraseIndex] ?? null;
  }

  get totalPhrases() {
    return this.flatPhrases.length;
  }

  /** Advance one word; wraps to next phrase when exhausted. */
  advance() {
    const phrase = this.currentPhrase;
    if (!phrase) return;
    const maxWords = Math.max(phrase.sa.length, phrase.en.length, phrase.nl.length);
    if (this.wordIndex < maxWords - 1) {
      this.wordIndex++;
      this._emit();
    } else {
      this.advancePhrase();
    }
  }

  /** Retreat one word; wraps to end of previous phrase when at start. */
  retreat() {
    if (this.wordIndex > 0) {
      this.wordIndex--;
      this._emit();
    } else {
      this.retreatPhrase();
    }
  }

  /** Jump to the start of the next phrase. */
  advancePhrase() {
    if (this.globalPhraseIndex < this.flatPhrases.length - 1) {
      this.globalPhraseIndex++;
      this.wordIndex = 0;
      this._emit();
    }
  }

  /** Jump to the start of the previous phrase. */
  retreatPhrase() {
    if (this.globalPhraseIndex > 0) {
      this.globalPhraseIndex--;
      this.wordIndex = 0;
      this._emit();
    }
  }

  /** Jump to a specific phrase by global index. */
  jumpTo(globalPhraseIndex, wordIndex = 0) {
    if (globalPhraseIndex < 0 || globalPhraseIndex >= this.flatPhrases.length) return;
    this.globalPhraseIndex = globalPhraseIndex;
    this.wordIndex = wordIndex;
    this._emit();
  }

  getState() {
    return {
      globalPhraseIndex: this.globalPhraseIndex,
      wordIndex: this.wordIndex,
    };
  }

  /** Subscribe to state changes. fn is called with the new state object. */
  on(fn) {
    this._listeners.push(fn);
  }

  _emit() {
    const state = this.getState();
    this._listeners.forEach(fn => fn(state));
  }
}
