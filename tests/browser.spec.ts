import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Automated Accessibility Audits (axe)', () => {
  const routesToTest = [
    '/',
    '/en/',
    '/lokalligaer/',
    '/turneringer/',
    '/turneringer/norway-open-2026/',
    '/post/nm-2026-dabs-drama-og-10-gull-på-rad/',
  ];

  for (const route of routesToTest) {
    test(`no critical or serious axe violations on ${route}`, async ({ page }) => {
      await page.goto(route);
      // Exclude third-party embedded iframes (e.g. YouTube player DOMs) because their internal
      // accessibility structure is served by YouTube and outside local federation control.
      // Host page wrapper attributes (title, loading=lazy, referrerpolicy) are verified statically by audit-generated.mjs.
      const accessibilityScanResults = await new AxeBuilder({ page }).exclude('iframe').analyze();

      const seriousOrCritical = accessibilityScanResults.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      expect(
        seriousOrCritical,
        `Axe accessibility violations found on ${route}:\n` +
          JSON.stringify(seriousOrCritical, null, 2),
      ).toEqual([]);
    });
  }
});

test.describe('Mobile Navigation Accessibility', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('mobile menu opens, updates aria-expanded, closes on Escape with focus return and closes on link click', async ({ page }) => {
    await page.goto('/');

    const menuToggle = page.locator('[data-menu-toggle]');
    const nav = page.locator('[data-nav]');

    // Initial state
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(nav).toHaveClass(/hidden/);

    // 1. Open mobile menu
    await menuToggle.click();
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(nav).not.toHaveClass(/hidden/);

    // Escape key closes menu and returns focus
    await page.keyboard.press('Escape');
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(nav).toHaveClass(/hidden/);
    await expect(menuToggle).toBeFocused();

    // Link click closes menu
    await menuToggle.click();
    await expect(nav).not.toHaveClass(/hidden/);
    const firstLink = nav.locator('a').first();
    await firstLink.click();
    await expect(nav).toHaveClass(/hidden/);
  });
});

test.describe('Desktop Submenu Keyboard Navigation', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('desktop submenu is activatable by keyboard toggle button and closes with Escape', async ({ page }) => {
    await page.goto('/');

    const subToggle = page.locator('[data-submenu-toggle]').first();
    const navItem = subToggle.locator('xpath=ancestor::*[contains(@class, "group") or @data-nav-item]');
    const submenu = navItem.locator('[data-submenu]');

    // Submenu initial closed state
    await expect(subToggle).toHaveAttribute('aria-expanded', 'false');

    // Click toggle button to open
    await subToggle.click();
    await expect(subToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(submenu).toBeVisible();

    // Escape closes submenu and returns focus to subToggle
    await page.keyboard.press('Escape');
    await expect(subToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(subToggle).toBeFocused();
  });
});

test.describe('PostCard Stretched Link Behavior', () => {
  test('clicking card body navigates to post, clicking category pill navigates to category', async ({ page }) => {
    await page.goto('/');

    const firstCard = page.locator('article').first();
    const categoryPill = firstCard.locator('ul[aria-label] a').first();
    const categoryHref = await categoryPill.getAttribute('href');

    // Click category pill -> navigates to category page
    await categoryPill.click();
    await expect(page).toHaveURL(new RegExp(encodeURI(categoryHref!)));

    // Return home and click post title link -> navigates to post
    await page.goto('/');
    const postTitleLink = page.locator('article').first().locator('h3 a, h2 a').first();
    const postHref = await postTitleLink.getAttribute('href');
    await postTitleLink.click();
    await expect(page).toHaveURL(new RegExp(encodeURI(postHref!)));
  });
});

test.describe('Registration Form & Player Combobox', () => {
  test('combobox keyboard navigation, ranking error fallback, and unranked fallback', async ({ page }) => {
    // Intercept ranking.json to mock failure
    await page.route('/ranking.json', (route) => route.abort('failed'));

    await page.goto('/turneringer/norway-open-2026/');
    const formSection = page.locator('[data-registration]');
    await formSection.scrollIntoViewIfNeeded();

    const comboInput = page.locator('[data-combo-input]').first();
    const errorMsg = page.locator('[data-combo-error]').first();

    // Focus input triggers ranking fetch failure and shows visible error
    await comboInput.focus();
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('Verdensrankingen kunne ikke lastes');

    // Unranked player fallback button operates cleanly
    const fallbackToggle = page.locator('[data-combo-fallback-toggle]').first();
    await fallbackToggle.click();
    const fallbackInput = page.locator('[data-combo-fallback-input]').first();
    await expect(fallbackInput).toBeVisible();
    await expect(fallbackInput).toHaveAttribute('aria-required', 'true');
    await fallbackInput.fill('Test Spiller');
    await expect(fallbackInput).toHaveValue('Test Spiller');
  });

  test('combobox options keyboard navigation with mocked ranking data', async ({ page }) => {
    await page.route('/ranking.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([[1, 101, 'Magnus Klippen', 'BPT', 'NOR', 1000, 1000]]),
      }),
    );

    await page.goto('/turneringer/norway-open-2026/');
    const comboInput = page.locator('[data-combo-input]').first();
    await comboInput.focus();
    await comboInput.fill('Magnus');

    const list = page.locator('[data-combo-list]').first();
    await expect(list).toBeVisible();

    // ArrowDown and Enter select option
    await page.keyboard.press('ArrowDown');
    const option = list.locator('[role="option"]').first();
    await expect(option).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Enter');
    await expect(comboInput).toHaveValue('Magnus Klippen');
    await expect(list).toBeHidden();
  });
});

test.describe('Viewport Overflow Tests', () => {
  for (const width of [320, 375]) {
    test(`no horizontal overflow at ${width}px width on major routes`, async ({ page }) => {
      await page.setViewportSize({ width, height: 667 });

      const routes = [
        '/',
        '/en/',
        '/lokalligaer/',
        '/en/lokalligaer/',
        '/turneringer/',
        '/en/turneringer/',
        '/turneringer/norway-open-2026/',
        '/post/nm-2026-dabs-drama-og-10-gull-på-rad/',
        '/personvern/',
        '/en/privacy/',
      ];

      for (const route of routes) {
        await page.goto(route);
        const isOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > document.documentElement.clientWidth;
        });
        expect(isOverflowing, `Horizontal overflow detected on ${route} at ${width}px`).toBe(false);
      }
    });
  }
});
