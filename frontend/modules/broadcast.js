/**
 * broadcast.js — BroadcastChannel wrapper for multi-window sync.
 *
 * The operator window emits cursor and load events.
 * The display window (?mode=display) listens and mirrors them.
 */

const CHANNEL_NAME = 'bhajan-reader-v1';

export class BroadcastSync {
  constructor() {
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.isDisplay = new URLSearchParams(window.location.search).get('mode') === 'display';
    this._handler = null;
  }

  /** Emit cursor position (operator → display). */
  emitCursor(state) {
    if (!this.isDisplay) {
      this.channel.postMessage({ type: 'cursor', state });
    }
  }

  /** Emit a loaded document (operator → display). */
  emitLoad(doc) {
    if (!this.isDisplay) {
      this.channel.postMessage({ type: 'load', doc });
    }
  }

  /** Emit language change (operator → display). */
  emitLang(lang) {
    if (!this.isDisplay) {
      this.channel.postMessage({ type: 'lang', lang });
    }
  }

  /** Emit theme change (operator → display). */
  emitTheme(theme) {
    if (!this.isDisplay) {
      this.channel.postMessage({ type: 'theme', theme });
    }
  }

  /** Emit full current state in response to a state-request (operator → display). */
  emitState(state) {
    if (!this.isDisplay) {
      this.channel.postMessage({ type: 'state', ...state });
    }
  }

  /** Ask the operator for its current full state (display → operator). */
  requestState() {
    this.channel.postMessage({ type: 'state-request' });
  }

  /** Subscribe to all incoming messages. */
  onMessage(fn) {
    this._handler = fn;
    this.channel.onmessage = e => fn(e.data);
  }

  destroy() {
    this.channel.close();
  }
}
