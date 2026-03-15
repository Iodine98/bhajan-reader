"""
Playwright tests for modules/i18n.js.

Uses dynamic import() in page.evaluate() to exercise i18n functions in isolation.
Requires the dev server running at http://localhost:8080.

Run with:
    pytest tests/test_i18n.py -v
"""

import pytest
from playwright.sync_api import Page

BASE_URL = "http://localhost:8080"


@pytest.fixture(autouse=True)
def goto_base(page: Page):
    page.goto(BASE_URL)


def i18n_eval(page: Page, script: str):
    """Run an async script with i18n functions in scope and return the result."""
    return page.evaluate(
        f"""async () => {{
            const {{ setI18nLang, t }} = await import('/modules/i18n.js');
            // Reset to English before each sub-test
            setI18nLang('en');
            {script}
        }}"""
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestI18n:

    def test_t_returns_english_string_by_default(self, page: Page):
        result = i18n_eval(page, "return t('upload');")
        assert result == 'Upload'

    def test_set_lang_nl_returns_dutch(self, page: Page):
        result = i18n_eval(page, "setI18nLang('nl'); return t('upload');")
        assert result == 'Uploaden'

    def test_unsupported_lang_falls_back_to_english(self, page: Page):
        result = i18n_eval(page, "setI18nLang('xx'); return t('upload');")
        assert result == 'Upload'

    def test_function_value_called_with_args(self, page: Page):
        # 'phrase' key maps to a function in both locales
        result = i18n_eval(page, "return t('phrase', 3, 10);")
        assert '3' in result
        assert '10' in result

    def test_function_value_called_with_args_nl(self, page: Page):
        result = i18n_eval(page, "setI18nLang('nl'); return t('phrase', 2, 5);")
        assert '2' in result
        assert '5' in result

    def test_nonexistent_key_returns_key_itself(self, page: Page):
        result = i18n_eval(page, "return t('noSuchKey_xyz');")
        assert result == 'noSuchKey_xyz'

    def test_set_lang_back_to_english(self, page: Page):
        result = i18n_eval(
            page,
            "setI18nLang('nl'); setI18nLang('en'); return t('upload');",
        )
        assert result == 'Upload'

    def test_english_phrase_function_content(self, page: Page):
        result = i18n_eval(page, "return t('phrase', 1, 5);")
        assert 'Phrase' in result or 'phrase' in result.lower()

    def test_mic_off_key_english(self, page: Page):
        result = i18n_eval(page, "return t('micOff');")
        assert result == 'Mic off'

    def test_mic_off_key_dutch(self, page: Page):
        result = i18n_eval(page, "setI18nLang('nl'); return t('micOff');")
        assert result == 'Mic uit'
