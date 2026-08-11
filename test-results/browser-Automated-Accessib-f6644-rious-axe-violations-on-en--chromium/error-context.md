# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser.spec.ts >> Automated Accessibility Audits (axe) >> no critical or serious axe violations on /en/
- Location: tests/browser.spec.ts:15:5

# Error details

```
Error: Axe accessibility violations found on /en/:
[
  {
    "id": "color-contrast",
    "impact": "serious",
    "tags": [
      "cat.color",
      "wcag2aa",
      "wcag143",
      "TTv5",
      "TT13.c",
      "EN-301-549",
      "EN-9.1.4.3",
      "ACT",
      "RGAAv4",
      "RGAA-3.2.1"
    ],
    "description": "Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds",
    "help": "Elements must meet minimum color contrast ratio thresholds",
    "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright",
    "nodes": [
      {
        "any": [
          {
            "id": "color-contrast",
            "data": {
              "fgColor": "#fcfdfe",
              "bgColor": "#c85455",
              "contrastRatio": 4.24,
              "fontSize": "12.0pt (16px)",
              "fontWeight": "normal",
              "messageKey": null,
              "expectedContrastRatio": "4.5:1"
            },
            "relatedNodes": [
              {
                "html": "<a href=\"/en/lokalligaer/\" class=\"btn-primary\">Find a local league</a>",
                "target": [
                  ".btn-primary"
                ]
              }
            ],
            "impact": "serious",
            "message": "Element has insufficient color contrast of 4.24 (foreground color: #fcfdfe, background color: #c85455, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1"
          }
        ],
        "all": [],
        "none": [],
        "impact": "serious",
        "html": "<a href=\"/en/lokalligaer/\" class=\"btn-primary\">Find a local league</a>",
        "target": [
          ".btn-primary"
        ],
        "failureSummary": "Fix any of the following:\n  Element has insufficient color contrast of 4.24 (foreground color: #fcfdfe, background color: #c85455, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1"
      }
    ]
  }
]

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 58

- Array []
+ Array [
+   Object {
+     "description": "Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds",
+     "help": "Elements must meet minimum color contrast ratio thresholds",
+     "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright",
+     "id": "color-contrast",
+     "impact": "serious",
+     "nodes": Array [
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#c85455",
+               "contrastRatio": 4.24,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#fcfdfe",
+               "fontSize": "12.0pt (16px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 4.24 (foreground color: #fcfdfe, background color: #c85455, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<a href=\"/en/lokalligaer/\" class=\"btn-primary\">Find a local league</a>",
+                 "target": Array [
+                   ".btn-primary",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 4.24 (foreground color: #fcfdfe, background color: #c85455, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<a href=\"/en/lokalligaer/\" class=\"btn-primary\">Find a local league</a>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           ".btn-primary",
+         ],
+       },
+     ],
+     "tags": Array [
+       "cat.color",
+       "wcag2aa",
+       "wcag143",
+       "TTv5",
+       "TT13.c",
+       "EN-301-549",
+       "EN-9.1.4.3",
+       "ACT",
+       "RGAAv4",
+       "RGAA-3.2.1",
+     ],
+   },
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Skip to content" [ref=e2] [cursor=pointer]:
    - /url: "#innhold"
  - banner [ref=e3]:
    - generic [ref=e4]:
      - link "NBHF – Norwegian Table Hockey Association" [ref=e5] [cursor=pointer]:
        - /url: /en/
        - generic [ref=e6]:
          - generic [ref=e7]: NBHF
          - generic [ref=e8]: Norwegian Table Hockey Association
      - navigation "Choose language" [ref=e10]:
        - list [ref=e11]:
          - listitem [ref=e12]:
            - link "NO" [ref=e13] [cursor=pointer]:
              - /url: /
          - listitem [ref=e14]: "|"
          - listitem [ref=e15]:
            - link "EN" [ref=e16] [cursor=pointer]:
              - /url: /en/
      - navigation "Main menu" [ref=e17]:
        - list [ref=e18]:
          - listitem [ref=e19]:
            - link "HOME" [ref=e21] [cursor=pointer]:
              - /url: /en/
          - listitem [ref=e22]:
            - generic [ref=e23]:
              - link "PLAY TABLE HOCKEY" [ref=e24] [cursor=pointer]:
                - /url: /en/spill-bordhockey/
              - button "PLAY TABLE HOCKEY submenu" [ref=e25]
          - listitem [ref=e28]:
            - link "NEWS" [ref=e30] [cursor=pointer]:
              - /url: /en/blog/
          - listitem [ref=e31]:
            - generic [ref=e32]:
              - link "RESOURCES" [ref=e33] [cursor=pointer]:
                - /url: /en/ressurser/
              - button "RESOURCES submenu" [ref=e34]
          - listitem [ref=e37]:
            - link "GALLERIES" [ref=e39] [cursor=pointer]:
              - /url: /en/bilder/
          - listitem [ref=e40]:
            - generic [ref=e41]:
              - link "ABOUT US" [ref=e42] [cursor=pointer]:
                - /url: /en/om-oss/
              - button "ABOUT US submenu" [ref=e43]
  - main [ref=e46]:
    - generic [ref=e48]:
      - generic [ref=e49]:
        - paragraph [ref=e50]: Table hockey in Norway
        - heading "Try table hockey near you" [level=1] [ref=e51]
        - paragraph [ref=e52]: Join a local playing night in Bergen or Jæren. Trying it for the first time is free and requires no commitment.
        - generic [ref=e53]:
          - link "Find a local league" [ref=e54] [cursor=pointer]:
            - /url: /en/lokalligaer/
          - link "See the next tournament" [ref=e55] [cursor=pointer]:
            - /url: "#neste-turnering"
      - img "Table hockey game in action" [ref=e57]
    - region [ref=e58]:
      - generic [ref=e59]:
        - generic [ref=e60]:
          - heading "Local leagues" [level=2] [ref=e61]
          - paragraph [ref=e62]: Active playing communities welcoming new players of all ages.
        - link "See league details →" [ref=e63] [cursor=pointer]:
          - /url: /en/lokalligaer/
      - generic [ref=e64]:
        - generic [ref=e65]:
          - heading "Bergen" [level=3] [ref=e66]
          - paragraph [ref=e67]: Regular playing nights in Bergen for beginners and experienced players. Equipment available.
          - link "See league details →" [ref=e69] [cursor=pointer]:
            - /url: /en/lokalligaer/
        - generic [ref=e70]:
          - heading "Jæren" [level=3] [ref=e71]
          - paragraph [ref=e72]: Weekly playing night at Kvernhallen in Kvernaland every Wednesday at 18:00.
          - link "See league details →" [ref=e74] [cursor=pointer]:
            - /url: /en/lokalligaer/
    - region [ref=e75]:
      - heading "How to get started" [level=2] [ref=e76]
      - generic [ref=e77]:
        - generic [ref=e78]:
          - heading "1. Find a local league" [level=3] [ref=e79]
          - paragraph [ref=e80]: Choose Bergen or Jæren to see schedules, venues and contact details.
        - generic [ref=e81]:
          - heading "2. Contact the organiser" [level=3] [ref=e82]
          - paragraph [ref=e83]: Drop a message or show up directly on any open playing night.
        - generic [ref=e84]:
          - heading "3. Show up and play" [level=3] [ref=e85]
          - paragraph [ref=e86]: No gear or prior experience required. Equipment is ready for you!
    - region [ref=e87]:
      - generic [ref=e88]:
        - heading "Tournament schedule" [level=2] [ref=e89]
        - link "All tournaments →" [ref=e90] [cursor=pointer]:
          - /url: /en/turneringer/
      - link "Norway Open 2026 5 September 2026 Sandnes (sted kunngjøres) Register →" [ref=e92] [cursor=pointer]:
        - /url: /en/turneringer/norway-open-2026/
        - generic [ref=e93]:
          - heading "Norway Open 2026" [level=3] [ref=e94]
          - paragraph [ref=e95]:
            - text: 5 September 2026
            - generic [ref=e97]: ·
            - generic [ref=e98]: Sandnes (sted kunngjøres)
          - paragraph [ref=e99]: Register →
    - region [ref=e100]:
      - generic [ref=e101]:
        - heading "Latest news" [level=2] [ref=e102]
        - link "All news →" [ref=e103] [cursor=pointer]:
          - /url: /en/blog/
      - generic [ref=e104]:
        - article [ref=e105]:
          - generic [ref=e107]:
            - paragraph [ref=e108]:
              - time [ref=e109]: 7 May 2026
            - heading [level=3] [ref=e110]:
              - 'link "NM 2026: Dabs, drama and 10 titles in a row" [ref=e111] [cursor=pointer]':
                - /url: /en/post/nm-2026-dabs-drama-and-10-titles-in-a-row/
            - paragraph [ref=e112]: "The May bank holiday weekend finally brought the Norwegian Championship: 28 hopeful players, 26 trophies, one dab celebration, and a tenth straight gold for Magnus Klippen. A tournament report from Kvernhallen."
            - list "Categories" [ref=e113]:
              - listitem [ref=e114]:
                - link "Tournament report" [ref=e115] [cursor=pointer]:
                  - /url: /en/blog/categories/tournament-report/
        - article [ref=e116]:
          - generic [ref=e118]:
            - paragraph [ref=e119]:
              - time [ref=e120]: 1 May 2026
            - heading [level=3] [ref=e121]:
              - link "Who can challenge Magnus in this year's Norwegian Championship?" [ref=e122] [cursor=pointer]:
                - /url: /en/post/who-can-challenge-magnus-in-this-years-nm/
            - paragraph [ref=e123]: Magnus Klippen has dominated Norwegian table hockey for a decade and then some, and he could win his tenth straight national title this year. Still, the chances of the streak ending have rarely looked better — let's take a closer look.
        - article [ref=e124]:
          - generic [ref=e126]:
            - paragraph [ref=e127]:
              - time [ref=e128]: 14 March 2026
            - heading [level=3] [ref=e129]:
              - 'link "The Prophecy of Singsaker: Trondheim Open 2026 Reviewed" [ref=e130] [cursor=pointer]':
                - /url: /en/post/the-prophecy-of-singsaker-trondheim-open-2026-reviewed/
            - paragraph [ref=e131]: Nine players gathered in the music classroom at Singsaker school for Trondheim Open 2026, where a Monte Carlo simulation turned out to be a prophecy in disguise. Amund Risa Fylling reclaimed the title, denying everyone a first NBF gold.
    - region [ref=e132]:
      - generic [ref=e133]:
        - heading "About NBHF" [level=2] [ref=e134]
        - paragraph [ref=e135]: The Norwegian Table Hockey Association has organised table hockey tournaments since 1991. The association works to promote the sport, support local leagues and make table hockey accessible to everyone.
        - link "→" [ref=e137] [cursor=pointer]:
          - /url: /en/om-oss/
  - contentinfo [ref=e138]:
    - generic [ref=e139]:
      - generic [ref=e140]:
        - link "NTHF – Norwegian Table Hockey Association" [ref=e141] [cursor=pointer]:
          - /url: /en/
          - generic [ref=e142]:
            - generic [ref=e143]: NTHF
            - generic [ref=e144]: Norwegian Table Hockey Association
        - paragraph [ref=e145]:
          - text: "Contact:"
          - link "amund.fylling@puck.no" [ref=e146] [cursor=pointer]:
            - /url: mailto:amund.fylling@puck.no
      - navigation "PLAY TABLE HOCKEY" [ref=e147]:
        - paragraph [ref=e148]:
          - link "PLAY TABLE HOCKEY" [ref=e149] [cursor=pointer]:
            - /url: /en/spill-bordhockey/
        - list [ref=e150]:
          - listitem [ref=e151]:
            - link "Local leagues" [ref=e152] [cursor=pointer]:
              - /url: /en/lokalligaer/
          - listitem [ref=e153]:
            - link "Learn table hockey" [ref=e154] [cursor=pointer]:
              - /url: /en/lær-bordhockey/
          - listitem [ref=e155]:
            - link "Tournaments" [ref=e156] [cursor=pointer]:
              - /url: /en/turneringer/
      - navigation "RESOURCES" [ref=e157]:
        - paragraph [ref=e158]:
          - link "RESOURCES" [ref=e159] [cursor=pointer]:
            - /url: /en/ressurser/
        - list [ref=e160]:
          - listitem [ref=e161]:
            - link "Timers" [ref=e162] [cursor=pointer]:
              - /url: /en/timere/
          - listitem [ref=e163]:
            - link "World ranking ITHF (opens in new tab)" [ref=e164] [cursor=pointer]:
              - /url: https://stiga.trefik.cz/ithf/ranking/index.aspx
              - text: World ranking ITHF
              - generic [ref=e165]: (opens in new tab)
          - listitem [ref=e166]:
            - link "EURO 2026 qualification" [ref=e167] [cursor=pointer]:
              - /url: /en/kvalifisering-mesterskap/
      - navigation "ABOUT US" [ref=e168]:
        - paragraph [ref=e169]:
          - link "ABOUT US" [ref=e170] [cursor=pointer]:
            - /url: /en/om-oss/
        - list [ref=e171]:
          - listitem [ref=e172]:
            - link "About us" [ref=e173] [cursor=pointer]:
              - /url: /en/om-oss/
          - listitem [ref=e174]:
            - link "Annual meeting minutes" [ref=e175] [cursor=pointer]:
              - /url: /en/årsmøter/
      - navigation "Shortcuts" [ref=e176]:
        - paragraph [ref=e177]: Shortcuts
        - list [ref=e178]:
          - listitem [ref=e179]:
            - link "HOME" [ref=e180] [cursor=pointer]:
              - /url: /en/
          - listitem [ref=e181]:
            - link "NEWS" [ref=e182] [cursor=pointer]:
              - /url: /en/blog/
          - listitem [ref=e183]:
            - link "GALLERIES" [ref=e184] [cursor=pointer]:
              - /url: /en/bilder/
          - listitem [ref=e185]:
            - link "Privacy" [ref=e186] [cursor=pointer]:
              - /url: /en/privacy/
          - listitem [ref=e187]:
            - link "RSS" [ref=e188] [cursor=pointer]:
              - /url: /en/blog-feed.xml
          - listitem [ref=e189]:
            - link "ITHF (opens in new tab)" [ref=e190] [cursor=pointer]:
              - /url: https://www.ithf.info/stiga/ithf/ithf.asp
              - text: ITHF
              - generic [ref=e191]: (opens in new tab)
    - paragraph [ref=e193]: © 2026 Norwegian Table Hockey Association
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import AxeBuilder from '@axe-core/playwright';
  3   | 
  4   | test.describe('Automated Accessibility Audits (axe)', () => {
  5   |   const routesToTest = [
  6   |     '/',
  7   |     '/en/',
  8   |     '/lokalligaer/',
  9   |     '/turneringer/',
  10  |     '/turneringer/norway-open-2026/',
  11  |     '/post/nm-2026-dabs-drama-og-10-gull-på-rad/',
  12  |   ];
  13  | 
  14  |   for (const route of routesToTest) {
  15  |     test(`no critical or serious axe violations on ${route}`, async ({ page }) => {
  16  |       await page.goto(route);
  17  |       // Exclude third-party embedded iframes (e.g. YouTube player DOMs) because their internal
  18  |       // accessibility structure is served by YouTube and outside local federation control.
  19  |       // Host page wrapper attributes (title, loading=lazy, referrerpolicy) are verified statically by audit-generated.mjs.
  20  |       const accessibilityScanResults = await new AxeBuilder({ page }).exclude('iframe').analyze();
  21  | 
  22  |       const seriousOrCritical = accessibilityScanResults.violations.filter(
  23  |         (v) => v.impact === 'critical' || v.impact === 'serious',
  24  |       );
  25  | 
  26  |       expect(
  27  |         seriousOrCritical,
  28  |         `Axe accessibility violations found on ${route}:\n` +
  29  |           JSON.stringify(seriousOrCritical, null, 2),
> 30  |       ).toEqual([]);
      |         ^ Error: Axe accessibility violations found on /en/:
  31  |     });
  32  |   }
  33  | });
  34  | 
  35  | test.describe('Mobile Navigation Accessibility', () => {
  36  |   test.use({ viewport: { width: 375, height: 667 } });
  37  | 
  38  |   test('mobile menu opens, updates aria-expanded, closes on Escape with focus return and closes on link click', async ({ page }) => {
  39  |     await page.goto('/');
  40  | 
  41  |     const menuToggle = page.locator('[data-menu-toggle]');
  42  |     const nav = page.locator('[data-nav]');
  43  | 
  44  |     // Initial state
  45  |     await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
  46  |     await expect(nav).toHaveClass(/hidden/);
  47  | 
  48  |     // 1. Open mobile menu
  49  |     await menuToggle.click();
  50  |     await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
  51  |     await expect(nav).not.toHaveClass(/hidden/);
  52  | 
  53  |     // Escape key closes menu and returns focus
  54  |     await page.keyboard.press('Escape');
  55  |     await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
  56  |     await expect(nav).toHaveClass(/hidden/);
  57  |     await expect(menuToggle).toBeFocused();
  58  | 
  59  |     // Link click closes menu
  60  |     await menuToggle.click();
  61  |     await expect(nav).not.toHaveClass(/hidden/);
  62  |     const firstLink = nav.locator('a').first();
  63  |     await firstLink.click();
  64  |     await expect(nav).toHaveClass(/hidden/);
  65  |   });
  66  | });
  67  | 
  68  | test.describe('Desktop Submenu Keyboard Navigation', () => {
  69  |   test.use({ viewport: { width: 1024, height: 768 } });
  70  | 
  71  |   test('desktop submenu is activatable by keyboard toggle button and closes with Escape', async ({ page }) => {
  72  |     await page.goto('/');
  73  | 
  74  |     const subToggle = page.locator('[data-submenu-toggle]').first();
  75  |     const navItem = subToggle.locator('xpath=ancestor::*[contains(@class, "group") or @data-nav-item]');
  76  |     const submenu = navItem.locator('[data-submenu]');
  77  | 
  78  |     // Submenu initial closed state
  79  |     await expect(subToggle).toHaveAttribute('aria-expanded', 'false');
  80  | 
  81  |     // Click toggle button to open
  82  |     await subToggle.click();
  83  |     await expect(subToggle).toHaveAttribute('aria-expanded', 'true');
  84  |     await expect(submenu).toBeVisible();
  85  | 
  86  |     // Escape closes submenu and returns focus to subToggle
  87  |     await page.keyboard.press('Escape');
  88  |     await expect(subToggle).toHaveAttribute('aria-expanded', 'false');
  89  |     await expect(subToggle).toBeFocused();
  90  |   });
  91  | });
  92  | 
  93  | test.describe('PostCard Stretched Link Behavior', () => {
  94  |   test('clicking card body navigates to post, clicking category pill navigates to category', async ({ page }) => {
  95  |     await page.goto('/');
  96  | 
  97  |     const firstCard = page.locator('article').first();
  98  |     const categoryPill = firstCard.locator('ul[aria-label] a').first();
  99  |     const categoryHref = await categoryPill.getAttribute('href');
  100 | 
  101 |     // Click category pill -> navigates to category page
  102 |     await categoryPill.click();
  103 |     await expect(page).toHaveURL(new RegExp(encodeURI(categoryHref!)));
  104 | 
  105 |     // Return home and click post title link -> navigates to post
  106 |     await page.goto('/');
  107 |     const postTitleLink = page.locator('article').first().locator('h3 a, h2 a').first();
  108 |     const postHref = await postTitleLink.getAttribute('href');
  109 |     await postTitleLink.click();
  110 |     await expect(page).toHaveURL(new RegExp(encodeURI(postHref!)));
  111 |   });
  112 | });
  113 | 
  114 | test.describe('Registration Form & Player Combobox', () => {
  115 |   test('combobox keyboard navigation, ranking error fallback, and unranked fallback', async ({ page }) => {
  116 |     // Intercept ranking.json to mock failure
  117 |     await page.route('/ranking.json', (route) => route.abort('failed'));
  118 | 
  119 |     await page.goto('/turneringer/norway-open-2026/');
  120 |     const formSection = page.locator('[data-registration]');
  121 |     await formSection.scrollIntoViewIfNeeded();
  122 | 
  123 |     const comboInput = page.locator('[data-combo-input]').first();
  124 |     const errorMsg = page.locator('[data-combo-error]').first();
  125 | 
  126 |     // Focus input triggers ranking fetch failure and shows visible error
  127 |     await comboInput.focus();
  128 |     await expect(errorMsg).toBeVisible();
  129 |     await expect(errorMsg).toContainText('Verdensrankingen kunne ikke lastes');
  130 | 
```