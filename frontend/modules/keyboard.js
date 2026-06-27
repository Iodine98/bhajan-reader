/**
 * keyboard.js — wires keyboard events to cursor actions.
 *
 *   Space / →     advance one word
 *   ←             retreat one word
 *   ↓ / Enter     advance one phrase
 *   ↑ / Backspace retreat one phrase
 */
export function setupKeyboard(cursor) {
  document.addEventListener('keydown', e => {
    // Don't intercept when focus is inside a form field
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.target.isContentEditable) return;

    switch (e.key) {
      case ' ':
      case 'ArrowRight':
        e.preventDefault();
        cursor.advance();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        cursor.retreat();
        break;
      case 'ArrowDown':
      case 'Enter':
        e.preventDefault();
        cursor.advancePhrase();
        break;
      case 'ArrowUp':
      case 'Backspace':
        e.preventDefault();
        cursor.retreatPhrase();
        break;
    }
  });
}
