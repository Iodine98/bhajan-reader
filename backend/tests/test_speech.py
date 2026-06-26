"""
Playwright tests for speech recognition word tracking.

Uses window._loadTestDoc and window._handleSpeechWords hooks to bypass
real microphone / SpeechRecognition APIs.
"""
import pytest
from playwright.sync_api import Page, expect

BASE_URL = "http://localhost:8080"

TEST_DOC = {
    "meta": {"title": "Test"},
    "verses": [{"id": "verse:1", "phrases": [
        {
            "sa":  ["ॐ", "भूर्भुवः", "स्वः"],
            "rom": ["oṃ", "bhūrbhuvaḥ", "svaḥ"],
            "en":  ["Om", "earth heaven", "truth"],
            "nl":  ["Om", "aarde hemel", "waarheid"],
        }
    ]}],
}


def load_doc(page: Page):
    page.evaluate("doc => window._loadTestDoc(doc)", TEST_DOC)


def inject_words(page: Page, words: list[str]):
    page.evaluate("words => window._handleSpeechWords(words)", words)


def active_word_index(page: Page) -> int | None:
    """Return data-word-index of the active span in #panel-sa, or None."""
    val = page.evaluate("""() => {
        const el = document.querySelector('#panel-sa .word.active');
        return el ? parseInt(el.dataset.wordIndex, 10) : null;
    }""")
    return val


@pytest.fixture(autouse=True)
def page_with_doc(page: Page):
    page.goto(BASE_URL)
    load_doc(page)
    yield page


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_speech_mode_select_exists(page_with_doc: Page):
    el = page_with_doc.locator("#mic-mode")
    expect(el).to_be_visible()


def test_word_match_exact(page_with_doc: Page):
    inject_words(page_with_doc, ["om"])
    assert active_word_index(page_with_doc) == 0


def test_word_match_diacritics_stripped(page_with_doc: Page):
    # "bhur" should match "bhūrbhuvaḥ" (normalised → "bhurbhuvah")
    inject_words(page_with_doc, ["bhurbhuvah"])
    assert active_word_index(page_with_doc) == 1


def test_word_match_advances_cursor(page_with_doc: Page):
    inject_words(page_with_doc, ["om"])
    inject_words(page_with_doc, ["bhurbhuvah"])
    inject_words(page_with_doc, ["svah"])
    assert active_word_index(page_with_doc) == 2


def test_unrelated_word_no_advance(page_with_doc: Page):
    # Cursor starts at word 0; "hello" should not match anything
    before = active_word_index(page_with_doc)
    inject_words(page_with_doc, ["hello"])
    assert active_word_index(page_with_doc) == before


def test_partial_match_within_threshold(page_with_doc: Page):
    # "svah" vs "svah" (normalised from "svaḥ") — exact after stripping
    inject_words(page_with_doc, ["svah"])
    assert active_word_index(page_with_doc) == 2


def test_cursor_can_go_backward(page_with_doc: Page):
    # Advance to word 2 first
    inject_words(page_with_doc, ["svah"])
    assert active_word_index(page_with_doc) == 2
    # Now speak "om" — cursor should jump back to word 0
    inject_words(page_with_doc, ["om"])
    assert active_word_index(page_with_doc) == 0
