"""
Playwright tests for the theme toggle feature.

Run with:
    pip install playwright && playwright install chromium
    pytest tests/test_theme.py
"""

import pytest
from playwright.sync_api import Page, expect


BASE_URL = "http://localhost:8080"


@pytest.fixture(autouse=True)
def clear_local_storage(page: Page):
    """Start each test with a clean localStorage so saved theme doesn't interfere."""
    page.goto(BASE_URL)
    page.evaluate("localStorage.clear()")
    page.reload()


# ── Helper ────────────────────────────────────────────────────────────────────

def html_theme(page: Page) -> str:
    """Return the current value of data-theme on <html>."""
    return page.evaluate("document.documentElement.dataset.theme")


def css_var(page: Page, prop: str) -> str:
    """Return the computed CSS custom property value on <html>."""
    return page.evaluate(
        f"getComputedStyle(document.documentElement).getPropertyValue('{prop}').trim()"
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestThemeToggle:

    def test_default_theme_is_dark(self, page: Page):
        """Page loads with dark theme by default when no preference is saved."""
        assert html_theme(page) == "dark"

    def test_dark_theme_css_variables(self, page: Page):
        """Dark theme has dark background color variable."""
        bg = css_var(page, "--bg")
        assert bg == "#0d0d1a", f"Expected dark --bg, got: {bg!r}"

    def test_click_switches_to_light(self, page: Page):
        """Clicking the theme button once switches from dark to light."""
        page.click("#theme-btn")
        assert html_theme(page) == "light"

    def test_click_switches_back_to_dark(self, page: Page):
        """Clicking twice returns to dark theme."""
        page.click("#theme-btn")
        page.click("#theme-btn")
        assert html_theme(page) == "dark"

    def test_light_theme_css_variables(self, page: Page):
        """After switching to light, --bg CSS variable reflects the light value."""
        page.click("#theme-btn")
        bg = css_var(page, "--bg")
        assert bg == "#f8f5ee", f"Expected light --bg, got: {bg!r}"

    def test_light_theme_text_color(self, page: Page):
        """After switching to light, --text CSS variable is dark."""
        page.click("#theme-btn")
        text_color = css_var(page, "--text")
        assert text_color == "#1a1620", f"Expected dark text color, got: {text_color!r}"

    def test_moon_icon_hidden_in_light_mode(self, page: Page):
        """Moon icon is hidden when light theme is active."""
        page.click("#theme-btn")
        moon = page.locator("#theme-icon-moon")
        expect(moon).to_be_hidden()

    def test_sun_icon_visible_in_light_mode(self, page: Page):
        """Sun icon is visible when light theme is active."""
        page.click("#theme-btn")
        sun = page.locator("#theme-icon-sun")
        expect(sun).to_be_visible()

    def test_moon_icon_visible_in_dark_mode(self, page: Page):
        """Moon icon is visible in default dark mode."""
        moon = page.locator("#theme-icon-moon")
        expect(moon).to_be_visible()

    def test_sun_icon_hidden_in_dark_mode(self, page: Page):
        """Sun icon is hidden in default dark mode."""
        sun = page.locator("#theme-icon-sun")
        expect(sun).to_be_hidden()

    def test_preference_persisted_to_localstorage(self, page: Page):
        """Switching to light saves 'light' to localStorage."""
        page.click("#theme-btn")
        saved = page.evaluate("localStorage.getItem('theme')")
        assert saved == "light"

    def test_preference_restored_on_reload(self, page: Page):
        """Light theme preference survives a page reload."""
        page.click("#theme-btn")
        page.reload()
        assert html_theme(page) == "light"

    def test_dark_preference_restored_on_reload(self, page: Page):
        """Dark theme preference (after toggling back) survives a page reload."""
        page.click("#theme-btn")   # → light
        page.click("#theme-btn")   # → dark
        page.reload()
        assert html_theme(page) == "dark"

    def test_button_title_updates_on_switch(self, page: Page):
        """Button title reflects the action that will happen on next click."""
        btn = page.locator("#theme-btn")
        # In dark mode, clicking will switch to light
        assert "light" in btn.get_attribute("title").lower()
        page.click("#theme-btn")
        # In light mode, clicking will switch to dark
        assert "dark" in btn.get_attribute("title").lower()

    def test_background_color_changes_visually(self, page: Page):
        """The computed background color of <html> changes when theme switches."""
        dark_bg = page.evaluate(
            "getComputedStyle(document.documentElement).backgroundColor"
        )
        page.click("#theme-btn")
        light_bg = page.evaluate(
            "getComputedStyle(document.documentElement).backgroundColor"
        )
        assert dark_bg != light_bg, (
            f"Background color did not change: dark={dark_bg!r}, light={light_bg!r}"
        )
