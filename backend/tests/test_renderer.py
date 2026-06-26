"""
Playwright tests for modules/renderer.js.

Creates isolated Renderer instances in the browser via dynamic import(),
mounting them on fresh <div> elements to inspect the resulting DOM.
Requires the dev server running at http://localhost:8080.

Run with:
    pytest tests/test_renderer.py -v
"""

import pytest
from playwright.sync_api import Page

BASE_URL = "http://localhost:8080"

SIMPLE_DOC = {
    "meta": {"title": "Test"},
    "verses": [
        {
            "id": "verse:1",
            "phrases": [
                {
                    "sa": ["ॐ", "भूर्भुवः"],
                    "rom": ["om", "bhurbhuvah"],
                    "en": ["Om", "earth-heaven"],
                    "nl": ["Om", "aarde-hemel"],
                },
                {
                    "sa": ["स्वः"],
                    "rom": ["svah"],
                    "en": ["truth"],
                    "nl": ["waarheid"],
                },
            ],
        }
    ],
}

DOC_WITH_NOTES = {
    "meta": {"title": "Test"},
    "verses": [
        {
            "id": "verse:1",
            "phrases": [
                {
                    "sa": ["ॐ"],
                    "rom": ["om"],
                    "en": ["Om"],
                    "nl": ["Om"],
                    "notes": {"en": ["The primordial syllable"]},
                },
                {
                    "sa": ["भूर्भुवः"],
                    "rom": ["bhurbhuvah"],
                    "en": ["earth-heaven"],
                    "nl": ["aarde-hemel"],
                    # Same note text as phrase 0 — should NOT repeat
                    "notes": {"en": ["The primordial syllable"]},
                },
            ],
        }
    ],
}


@pytest.fixture(autouse=True)
def goto_base(page: Page):
    page.goto(BASE_URL)


def make_renderer(page: Page, doc: dict, lang: str = 'en') -> None:
    """Import Renderer and render doc into fresh divs, stored as window.__r."""
    page.evaluate(
        """async ([doc, lang]) => {
            const { Renderer } = await import('/modules/renderer.js');
            const sa = document.createElement('div');
            const tr = document.createElement('div');
            sa.id = '__sa'; tr.id = '__tr';
            document.body.appendChild(sa);
            document.body.appendChild(tr);
            const r = new Renderer(sa, tr);
            r.render(doc, lang);
            window.__r = r;
        }""",
        [doc, lang],
    )


def cleanup_renderer(page: Page) -> None:
    page.evaluate(
        """() => {
            document.getElementById('__sa')?.remove();
            document.getElementById('__tr')?.remove();
            window.__r = null;
        }"""
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestRender:

    def test_both_panels_have_correct_word_spans(self, page: Page):
        make_renderer(page, SIMPLE_DOC)
        counts = page.evaluate(
            """() => ({
                sa: document.querySelectorAll('#__sa .word').length,
                tr: document.querySelectorAll('#__tr .word').length,
            })"""
        )
        # Sanskrit panel: 2 words in phrase 0 + 1 in phrase 1, each in sa-row and rom-row
        # = (2+2) + (1+1) = 6
        assert counts['sa'] == 6
        # Translation panel: 2 words in phrase 0 + 1 in phrase 1 = 3
        assert counts['tr'] == 3
        cleanup_renderer(page)

    def test_phrase_elements_have_data_global_index(self, page: Page):
        make_renderer(page, SIMPLE_DOC)
        indices = page.evaluate(
            """() => [...document.querySelectorAll('#__sa .phrase')]
                        .map(el => parseInt(el.dataset.globalIndex, 10))"""
        )
        assert indices == [0, 1]
        cleanup_renderer(page)


class TestSetLang:

    def test_set_lang_same_lang_no_rebuild(self, page: Page):
        make_renderer(page, SIMPLE_DOC, 'en')
        # Place a sentinel attribute that would survive only if innerHTML is NOT reset
        page.evaluate(
            """() => {
                document.querySelector('#__tr .phrase').dataset.sentinel = 'alive';
            }"""
        )
        page.evaluate("() => window.__r.setLang('en')")
        sentinel = page.evaluate(
            "() => document.querySelector('#__tr .phrase')?.dataset.sentinel"
        )
        assert sentinel == 'alive', "setLang with same lang should not rebuild the DOM"
        cleanup_renderer(page)

    def test_set_lang_different_lang_rebuilds(self, page: Page):
        make_renderer(page, SIMPLE_DOC, 'en')
        page.evaluate(
            """() => {
                document.querySelector('#__tr .phrase').dataset.sentinel = 'alive';
            }"""
        )
        page.evaluate("() => window.__r.setLang('nl')")
        sentinel = page.evaluate(
            "() => document.querySelector('#__tr .phrase')?.dataset.sentinel"
        )
        assert sentinel is None, "setLang with different lang should rebuild the trans panel"
        cleanup_renderer(page)

    def test_set_lang_no_doc_does_nothing(self, page: Page):
        # Renderer with no doc loaded — setLang should return early without error
        result = page.evaluate(
            """async () => {
                const { Renderer } = await import('/modules/renderer.js');
                const sa = document.createElement('div');
                const tr = document.createElement('div');
                const r = new Renderer(sa, tr);
                try { r.setLang('nl'); return 'ok'; }
                catch (e) { return 'error: ' + e.message; }
            }"""
        )
        assert result == 'ok'


class TestFootnotes:

    def test_footnote_appears_on_first_occurrence(self, page: Page):
        make_renderer(page, DOC_WITH_NOTES, 'en')
        marker_count = page.evaluate(
            "() => document.querySelectorAll('#__tr .fn-marker').length"
        )
        assert marker_count >= 1
        cleanup_renderer(page)

    def test_duplicate_note_not_repeated(self, page: Page):
        """Second phrase has the same note text — should produce no superscript."""
        make_renderer(page, DOC_WITH_NOTES, 'en')
        marker_count = page.evaluate(
            "() => document.querySelectorAll('#__tr .fn-marker').length"
        )
        # Only 1 unique note, so only 1 marker total
        assert marker_count == 1
        cleanup_renderer(page)

    def test_footnote_div_present(self, page: Page):
        make_renderer(page, DOC_WITH_NOTES, 'en')
        footnote_divs = page.evaluate(
            "() => document.querySelectorAll('#__tr .footnotes').length"
        )
        assert footnote_divs >= 1
        cleanup_renderer(page)


class TestCursorUpdate:

    def test_on_cursor_update_highlights_correct_word(self, page: Page):
        make_renderer(page, SIMPLE_DOC)
        page.evaluate(
            "() => window.__r.onCursorUpdate({ globalPhraseIndex: 0, wordIndex: 1 })"
        )
        active_sa = page.evaluate(
            "() => document.querySelector('#__sa .word.active')?.dataset.wordIndex"
        )
        assert active_sa == '1'
        cleanup_renderer(page)

    def test_on_cursor_update_removes_previous_highlight(self, page: Page):
        make_renderer(page, SIMPLE_DOC)
        # First update
        page.evaluate(
            "() => window.__r.onCursorUpdate({ globalPhraseIndex: 0, wordIndex: 0 })"
        )
        # Second update
        page.evaluate(
            "() => window.__r.onCursorUpdate({ globalPhraseIndex: 0, wordIndex: 1 })"
        )
        active_count = page.evaluate(
            "() => document.querySelectorAll('.word.active').length"
        )
        # Only the newly highlighted words should be active (sa-row + trans panel = 2)
        assert active_count <= 3  # at most sa-word + rom-word + trans-word
        cleanup_renderer(page)

    def test_on_cursor_update_highlights_trans_panel(self, page: Page):
        make_renderer(page, SIMPLE_DOC)
        page.evaluate(
            "() => window.__r.onCursorUpdate({ globalPhraseIndex: 0, wordIndex: 0 })"
        )
        active_tr = page.evaluate(
            "() => document.querySelector('#__tr .word.active')?.dataset.wordIndex"
        )
        assert active_tr == '0'
        cleanup_renderer(page)
