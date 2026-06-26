"""
Playwright tests for modules/cursor.js.

Uses dynamic import() in page.evaluate() to create isolated Cursor instances.
Requires the dev server running at http://localhost:8080.

Run with:
    pytest tests/test_cursor.py -v
"""

import pytest
from playwright.sync_api import Page

BASE_URL = "http://localhost:8080"

# 3-phrase document across 2 verses:
#   Phrase 0: 1 word  (verse:1)
#   Phrase 1: 2 words (verse:1)
#   Phrase 2: 1 word  (verse:2)
THREE_PHRASE_DOC = {
    "meta": {"title": "Test"},
    "verses": [
        {
            "id": "verse:1",
            "phrases": [
                {"sa": ["ॐ"], "rom": ["om"], "en": ["Om"], "nl": ["Om"]},
                {"sa": ["भूर्", "भुवः"], "rom": ["bhur", "bhuvah"],
                 "en": ["earth", "heaven"], "nl": ["aarde", "hemel"]},
            ],
        },
        {
            "id": "verse:2",
            "phrases": [
                {"sa": ["स्वः"], "rom": ["svah"], "en": ["truth"], "nl": ["waarheid"]},
            ],
        },
    ],
}


@pytest.fixture(autouse=True)
def goto_base(page: Page):
    page.goto(BASE_URL)


def make_cursor(page: Page) -> str:
    """
    Import Cursor in the browser, create an instance, load THREE_PHRASE_DOC,
    and store it as window.__testCursor. Returns 'ok'.
    """
    return page.evaluate(
        """async (doc) => {
            const { Cursor } = await import('/modules/cursor.js');
            const c = new Cursor();
            c.load(doc);
            window.__testCursor = c;
            return 'ok';
        }""",
        THREE_PHRASE_DOC,
    )


def cursor_state(page: Page) -> dict:
    return page.evaluate(
        "() => ({ gi: window.__testCursor.globalPhraseIndex, wi: window.__testCursor.wordIndex })"
    )


# ── advance ───────────────────────────────────────────────────────────────────

class TestAdvance:

    def test_advance_increments_word_index(self, page: Page):
        make_cursor(page)
        # Start at phrase 1 (2 words) to test word advance
        page.evaluate("() => window.__testCursor.jumpTo(1, 0)")
        page.evaluate("() => window.__testCursor.advance()")
        st = cursor_state(page)
        assert st['gi'] == 1
        assert st['wi'] == 1

    def test_advance_at_last_word_moves_to_next_phrase(self, page: Page):
        make_cursor(page)
        # Phrase 1 has 2 words; advance from word 1 → phrase 2
        page.evaluate("() => window.__testCursor.jumpTo(1, 1)")
        page.evaluate("() => window.__testCursor.advance()")
        st = cursor_state(page)
        assert st['gi'] == 2
        assert st['wi'] == 0

    def test_advance_at_very_last_word_stays(self, page: Page):
        make_cursor(page)
        # Last phrase (2) has 1 word
        page.evaluate("() => window.__testCursor.jumpTo(2, 0)")
        page.evaluate("() => window.__testCursor.advance()")
        st = cursor_state(page)
        assert st['gi'] == 2
        assert st['wi'] == 0


# ── retreat ───────────────────────────────────────────────────────────────────

class TestRetreat:

    def test_retreat_decrements_word_index(self, page: Page):
        make_cursor(page)
        page.evaluate("() => window.__testCursor.jumpTo(1, 1)")
        page.evaluate("() => window.__testCursor.retreat()")
        st = cursor_state(page)
        assert st['gi'] == 1
        assert st['wi'] == 0

    def test_retreat_at_word_0_moves_to_prev_phrase(self, page: Page):
        make_cursor(page)
        page.evaluate("() => window.__testCursor.jumpTo(1, 0)")
        page.evaluate("() => window.__testCursor.retreat()")
        st = cursor_state(page)
        assert st['gi'] == 0

    def test_retreat_at_very_first_word_stays(self, page: Page):
        make_cursor(page)
        # Already at phrase 0, word 0
        page.evaluate("() => window.__testCursor.retreat()")
        st = cursor_state(page)
        assert st['gi'] == 0
        assert st['wi'] == 0


# ── advancePhrase ─────────────────────────────────────────────────────────────

class TestAdvancePhrase:

    def test_advance_phrase_mid_doc(self, page: Page):
        make_cursor(page)
        page.evaluate("() => window.__testCursor.jumpTo(0, 0)")
        page.evaluate("() => window.__testCursor.advancePhrase()")
        st = cursor_state(page)
        assert st['gi'] == 1
        assert st['wi'] == 0

    def test_advance_phrase_at_last_phrase_stays(self, page: Page):
        make_cursor(page)
        page.evaluate("() => window.__testCursor.jumpTo(2, 0)")
        page.evaluate("() => window.__testCursor.advancePhrase()")
        st = cursor_state(page)
        assert st['gi'] == 2


# ── retreatPhrase ─────────────────────────────────────────────────────────────

class TestRetreatPhrase:

    def test_retreat_phrase_mid_doc(self, page: Page):
        make_cursor(page)
        page.evaluate("() => window.__testCursor.jumpTo(2, 0)")
        page.evaluate("() => window.__testCursor.retreatPhrase()")
        st = cursor_state(page)
        assert st['gi'] == 1
        assert st['wi'] == 0

    def test_retreat_phrase_at_first_phrase_stays(self, page: Page):
        make_cursor(page)
        page.evaluate("() => window.__testCursor.jumpTo(0, 0)")
        page.evaluate("() => window.__testCursor.retreatPhrase()")
        st = cursor_state(page)
        assert st['gi'] == 0


# ── jumpTo ────────────────────────────────────────────────────────────────────

class TestJumpTo:

    def test_jump_to_valid_index(self, page: Page):
        make_cursor(page)
        page.evaluate("() => window.__testCursor.jumpTo(2, 0)")
        st = cursor_state(page)
        assert st['gi'] == 2
        assert st['wi'] == 0

    def test_jump_to_negative_index_ignored(self, page: Page):
        make_cursor(page)
        page.evaluate("() => window.__testCursor.jumpTo(1, 0)")
        page.evaluate("() => window.__testCursor.jumpTo(-1, 0)")
        st = cursor_state(page)
        # Should remain at 1 (last valid position)
        assert st['gi'] == 1

    def test_jump_to_out_of_range_ignored(self, page: Page):
        make_cursor(page)
        page.evaluate("() => window.__testCursor.jumpTo(1, 0)")
        page.evaluate("() => window.__testCursor.jumpTo(999, 0)")
        st = cursor_state(page)
        assert st['gi'] == 1


# ── on(fn) listener ───────────────────────────────────────────────────────────

class TestListener:

    def test_listener_called_on_cursor_move(self, page: Page):
        make_cursor(page)
        calls = page.evaluate(
            """async () => {
                const calls = [];
                window.__testCursor.on(state => calls.push(state));
                window.__testCursor.advance();
                window.__testCursor.retreat();
                window.__testCursor.advancePhrase();
                return calls.length;
            }"""
        )
        assert calls >= 3

    def test_listener_receives_state_object(self, page: Page):
        make_cursor(page)
        state = page.evaluate(
            """async () => {
                let received = null;
                window.__testCursor.on(state => { received = state; });
                window.__testCursor.jumpTo(1, 0);
                return received;
            }"""
        )
        assert state is not None
        assert state['globalPhraseIndex'] == 1
        assert state['wordIndex'] == 0
