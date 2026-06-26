"""
Playwright tests for modules/parser.js.

Uses page.evaluate() with dynamic import() to exercise parse() in the browser.
Requires the dev server running at http://localhost:8080.

Run with:
    pytest tests/test_parser.py -v
"""

import pytest
from playwright.sync_api import Page

BASE_URL = "http://localhost:8080"


@pytest.fixture(autouse=True)
def goto_base(page: Page):
    page.goto(BASE_URL)


def parse(page: Page, text: str):
    """Call parser.js parse() in the browser and return the JS result."""
    return page.evaluate(
        """async (text) => {
            const { parse } = await import('/modules/parser.js');
            try {
                return { ok: true, result: parse(text) };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        }""",
        text,
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestParser:

    def test_minimal_valid_input(self, page: Page):
        text = "---\n[verse:1]\nॐ भूर्भुवः\n---"
        r = parse(page, text)
        assert r['ok']
        result = r['result']
        assert 'meta' in result
        assert 'verses' in result
        assert len(result['verses']) == 1
        assert result['verses'][0]['id'] == 'verse:1'

    def test_bom_is_stripped(self, page: Page):
        text = "\uFEFF---\n[verse:1]\nॐ\n---"
        r = parse(page, text)
        assert r['ok']
        # If BOM wasn't stripped the first line would be malformed; parse should succeed
        assert len(r['result']['verses']) == 1

    def test_meta_key_value_parsed(self, page: Page):
        text = "# title: Gayatri Mantra\n# composer: Vishwamitra\n---\n[verse:1]\nॐ\n---"
        r = parse(page, text)
        assert r['ok']
        meta = r['result']['meta']
        assert meta.get('title') == 'Gayatri Mantra'
        assert meta.get('composer') == 'Vishwamitra'

    def test_multiple_verses(self, page: Page):
        text = "---\n[verse:1]\nline one\n[verse:2]\nline two\n---"
        r = parse(page, text)
        assert r['ok']
        verses = r['result']['verses']
        assert len(verses) == 2
        assert verses[0]['id'] == 'verse:1'
        assert verses[1]['id'] == 'verse:2'
        assert verses[0]['lines'] == ['line one']
        assert verses[1]['lines'] == ['line two']

    def test_each_verse_collects_own_lines(self, page: Page):
        text = "---\n[verse:1]\nfirst\nsecond\n[verse:2]\nthird\n---"
        r = parse(page, text)
        assert r['ok']
        v = r['result']['verses']
        assert v[0]['lines'] == ['first', 'second']
        assert v[1]['lines'] == ['third']

    def test_blank_lines_inside_verse_ignored(self, page: Page):
        text = "---\n[verse:1]\nfirst\n\nsecond\n---"
        r = parse(page, text)
        assert r['ok']
        lines = r['result']['verses'][0]['lines']
        assert lines == ['first', 'second']

    def test_content_before_verse_marker_creates_implicit_verse(self, page: Page):
        # Content between --- delimiters but before any [verse:N] marker
        text = "---\nimplicit line\n---"
        r = parse(page, text)
        assert r['ok']
        verses = r['result']['verses']
        assert len(verses) == 1
        assert verses[0]['id'] == 'verse:1'
        assert 'implicit line' in verses[0]['lines']

    def test_empty_input_throws_error(self, page: Page):
        r = parse(page, "")
        assert not r['ok']
        assert 'verse' in r['error'].lower() or 'format' in r['error'].lower()

    def test_no_verses_throws_error(self, page: Page):
        # Has meta but no body section at all
        r = parse(page, "# title: Test")
        assert not r['ok']

    def test_explicit_verse_marker_captured(self, page: Page):
        text = "---\n[chorus]\nhare krishna\n---"
        r = parse(page, text)
        assert r['ok']
        assert r['result']['verses'][0]['id'] == 'chorus'
