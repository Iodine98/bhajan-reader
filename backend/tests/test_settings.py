"""
Playwright tests for settings modal and API key guard.

Covers the test plan item:
  "Missing API key: selecting an example shows an alert and keeps Settings open"

Run with:
    pytest tests/test_settings.py -v
"""

import pytest
from playwright.sync_api import Page, expect

BASE_URL = "http://localhost:8080"


class TestSettings:

    @pytest.fixture(autouse=True)
    def clean_state(self, page: Page):
        """Start each test with no API key and a fresh page."""
        page.goto(BASE_URL)
        page.evaluate("localStorage.clear()")
        page.reload()

    def test_missing_api_key_blocks_example_load(self, page: Page):
        """No API key → selecting an example shows alert and keeps Settings open."""
        page.click("#settings-btn")
        expect(page.locator("#settings-modal")).to_be_visible()

        alerts = []
        page.on("dialog", lambda d: (alerts.append(d.message), d.accept()))

        page.select_option("#examples-select", "examples/gayatri-mantra.bhajan")
        page.wait_for_timeout(300)

        assert alerts, "Expected an alert dialog when no API key is set"
        assert "api key" in alerts[0].lower(), (
            f"Alert text did not mention API key: {alerts[0]!r}"
        )
        expect(page.locator("#settings-modal")).to_be_visible()

    def test_missing_api_key_blocks_file_open(self, page: Page):
        """No API key → clicking Open file… shows alert and keeps Settings open."""
        page.click("#settings-btn")
        expect(page.locator("#settings-modal")).to_be_visible()

        alerts = []
        page.on("dialog", lambda d: (alerts.append(d.message), d.accept()))

        page.click("#upload-btn")
        page.wait_for_timeout(300)

        assert alerts, "Expected an alert dialog when no API key is set"
        assert "api key" in alerts[0].lower(), (
            f"Alert text did not mention API key: {alerts[0]!r}"
        )
        expect(page.locator("#settings-modal")).to_be_visible()
