import { test, expect } from '@playwright/test';

test.use({ timezoneId: 'America/Los_Angeles' });

for (const lang of ['no', 'en'] as const) {
  const prefix = lang === 'en' ? '/en' : '';
  const labels = lang === 'en'
    ? { upcoming: 'Upcoming', ongoing: 'Ongoing today', past: 'Past', live: 'Follow live results', results: 'View results' }
    : { upcoming: 'Kommende', ongoing: 'Pågår i dag', past: 'Tidligere', live: 'Følg resultater live', results: 'Se resultater' };

  test(`${lang}: a previously built page follows Norway's tournament day without a reload`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-04T21:59:30Z') });
    await page.goto(`${prefix}/turneringer/norway-open-2026/`);
    const header = page.locator('[data-tournament-header]');
    const status = header.getByRole('status');
    const link = header.getByRole('link');
    await expect(status).toHaveText(labels.upcoming);
    await expect(link).toBeHidden();

    await page.clock.fastForward(60_000);
    await expect(status).toHaveText(labels.ongoing);
    await expect(link).toBeVisible();
    await expect(link).toContainText(labels.live);
    await expect(link).toHaveAttribute('href', 'https://th.sportscorpion.com/eng/tournament/id/8171/');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await link.focus();
    await expect(link).toBeFocused();
    const linkBox = await link.boundingBox();
    const heroBox = await page.locator('article figure').first().boundingBox();
    expect(linkBox!.height).toBeGreaterThanOrEqual(44);
    expect(linkBox!.y + linkBox!.height).toBeLessThan(heroBox!.y);
    expect(linkBox!.y + linkBox!.height).toBeLessThan(page.viewportSize()!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

    await page.clock.setSystemTime(new Date('2026-09-05T21:59:30Z'));
    await page.clock.fastForward(60_000);
    await expect(status).toHaveText(labels.past);
    await expect(link).toBeVisible();
    await expect(link).toContainText(labels.results);
  });

  test(`${lang}: ongoing events without results do not show an empty link`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-17T12:00:00Z') });
    await page.goto(`${prefix}/turneringer/krohnengen-open-2026/`);
    const header = page.locator('[data-tournament-header]');
    await expect(header.getByRole('status')).toHaveText(labels.ongoing);
    await expect(header.getByRole('link')).toHaveCount(0);
  });
}
