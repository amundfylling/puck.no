# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser.spec.ts >> Automated Accessibility Audits (axe) >> no critical or serious axe violations on /
- Location: tests/browser.spec.ts:15:5

# Error details

```
Error: Axe accessibility violations found on /:
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
              "fgColor": "#ae5e6c",
              "bgColor": "#f4f7fb",
              "contrastRatio": 4.23,
              "fontSize": "9.0pt (12px)",
              "fontWeight": "bold",
              "messageKey": null,
              "expectedContrastRatio": "4.5:1"
            },
            "relatedNodes": [
              {
                "html": "<section class=\"border-b border-slate-200 bg-ice\">",
                "target": [
                  ".border-b.bg-ice"
                ]
              }
            ],
            "impact": "serious",
            "message": "Element has insufficient color contrast of 4.23 (foreground color: #ae5e6c, background color: #f4f7fb, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1"
          }
        ],
        "all": [],
        "none": [],
        "impact": "serious",
        "html": "<p class=\"text-xs font-bold uppercase tracking-widest text-brand-dark\">Bordhockey i Norge</p>",
        "target": [
          ".tracking-widest"
        ],
        "failureSummary": "Fix any of the following:\n  Element has insufficient color contrast of 4.23 (foreground color: #ae5e6c, background color: #f4f7fb, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1"
      },
      {
        "any": [
          {
            "id": "color-contrast",
            "data": {
              "fgColor": "#fbfcfe",
              "bgColor": "#ce696b",
              "contrastRatio": 3.49,
              "fontSize": "12.0pt (16px)",
              "fontWeight": "normal",
              "messageKey": null,
              "expectedContrastRatio": "4.5:1"
            },
            "relatedNodes": [
              {
                "html": "<a href=\"/lokalligaer/\" class=\"btn-primary\">Finn en lokalliga</a>",
                "target": [
                  ".btn-primary"
                ]
              }
            ],
            "impact": "serious",
            "message": "Element has insufficient color contrast of 3.49 (foreground color: #fbfcfe, background color: #ce696b, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1"
          }
        ],
        "all": [],
        "none": [],
        "impact": "serious",
        "html": "<a href=\"/lokalligaer/\" class=\"btn-primary\">Finn en lokalliga</a>",
        "target": [
          ".btn-primary"
        ],
        "failureSummary": "Fix any of the following:\n  Element has insufficient color contrast of 3.49 (foreground color: #fbfcfe, background color: #ce696b, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1"
      }
    ]
  }
]

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 93

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
+               "bgColor": "#f4f7fb",
+               "contrastRatio": 4.23,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#ae5e6c",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "bold",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 4.23 (foreground color: #ae5e6c, background color: #f4f7fb, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<section class=\"border-b border-slate-200 bg-ice\">",
+                 "target": Array [
+                   ".border-b.bg-ice",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 4.23 (foreground color: #ae5e6c, background color: #f4f7fb, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+         "html": "<p class=\"text-xs font-bold uppercase tracking-widest text-brand-dark\">Bordhockey i Norge</p>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           ".tracking-widest",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#ce696b",
+               "contrastRatio": 3.49,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#fbfcfe",
+               "fontSize": "12.0pt (16px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 3.49 (foreground color: #fbfcfe, background color: #ce696b, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<a href=\"/lokalligaer/\" class=\"btn-primary\">Finn en lokalliga</a>",
+                 "target": Array [
+                   ".btn-primary",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 3.49 (foreground color: #fbfcfe, background color: #ce696b, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<a href=\"/lokalligaer/\" class=\"btn-primary\">Finn en lokalliga</a>",
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
  - link "Hopp til innhold" [ref=e2] [cursor=pointer]:
    - /url: "#innhold"
  - banner [ref=e3]:
    - generic [ref=e4]:
      - link "NBHF – Norges Bordhockeyforbund" [ref=e5] [cursor=pointer]:
        - /url: /
        - generic [ref=e6]: NBHF
      - generic [ref=e8]:
        - navigation "Velg språk" [ref=e9]:
          - list [ref=e10]:
            - listitem [ref=e11]:
              - link "NO" [ref=e12] [cursor=pointer]:
                - /url: /
            - listitem [ref=e13]: "|"
            - listitem [ref=e14]:
              - link "EN" [ref=e15] [cursor=pointer]:
                - /url: /en/
        - button "Åpne meny" [ref=e16]
  - main [ref=e19]:
    - generic [ref=e21]:
      - generic [ref=e22]:
        - paragraph [ref=e23]: Bordhockey i Norge
        - heading "Prøv bordhockey nær deg" [level=1] [ref=e24]
        - paragraph [ref=e25]: Bli med på en lokal spillekveld i Bergen eller på Jæren. Det er gratis og uforpliktende å prøve.
        - generic [ref=e26]:
          - link "Finn en lokalliga" [ref=e27] [cursor=pointer]:
            - /url: /lokalligaer/
          - link "Se neste turnering" [ref=e28] [cursor=pointer]:
            - /url: "#neste-turnering"
      - img "Bordhockeyspill i aksjon" [ref=e30]
    - region [ref=e31]:
      - generic [ref=e32]:
        - generic [ref=e33]:
          - heading "Lokalligaer" [level=2] [ref=e34]
          - paragraph [ref=e35]: Aktive miljoer som tar imot nye spillere i alle aldre.
        - link "Se detaljer om ligaen →" [ref=e36] [cursor=pointer]:
          - /url: /lokalligaer/
      - generic [ref=e37]:
        - generic [ref=e38]:
          - heading "Bergen" [level=3] [ref=e39]
          - paragraph [ref=e40]: Spillekvelder i Bergen for både nybegynnere og erfarne. Utstyr kan lånes.
          - link "Se detaljer om ligaen →" [ref=e42] [cursor=pointer]:
            - /url: /lokalligaer/
        - generic [ref=e43]:
          - heading "Jæren" [level=3] [ref=e44]
          - paragraph [ref=e45]: Fast ukentlig spillekveld i Kvernhallen på Kvernaland hver onsdag kl. 18:00.
          - link "Se detaljer om ligaen →" [ref=e47] [cursor=pointer]:
            - /url: /lokalligaer/
    - region [ref=e48]:
      - heading "Slik kommer du i gang" [level=2] [ref=e49]
      - generic [ref=e50]:
        - generic [ref=e51]:
          - heading "1. Finn en lokalliga" [level=3] [ref=e52]
          - paragraph [ref=e53]: Velg Bergen eller Jæren for å se spilletider, sted og kontaktinformasjon.
        - generic [ref=e54]:
          - heading "2. Kontakt arrangøren" [level=3] [ref=e55]
          - paragraph [ref=e56]: Send en melding på forhånd eller ta turen innom på en spillekveld.
        - generic [ref=e57]:
          - heading "3. Møt opp og spill" [level=3] [ref=e58]
          - paragraph [ref=e59]: Du trenger ikke eget utstyr eller erfaring. Alt du trenger står klart!
    - region [ref=e60]:
      - generic [ref=e61]:
        - heading "Terminliste" [level=2] [ref=e62]
        - link "Alle turneringer →" [ref=e63] [cursor=pointer]:
          - /url: /turneringer/
      - link "Norway Open 2026 5. september 2026 Sandnes (sted kunngjøres) Meld deg på →" [ref=e65] [cursor=pointer]:
        - /url: /turneringer/norway-open-2026/
        - generic [ref=e66]:
          - heading "Norway Open 2026" [level=3] [ref=e67]
          - paragraph [ref=e68]:
            - text: 5. september 2026
            - generic [ref=e70]: ·
            - generic [ref=e71]: Sandnes (sted kunngjøres)
          - paragraph [ref=e72]: Meld deg på →
    - region [ref=e73]:
      - generic [ref=e74]:
        - heading "Siste nytt" [level=2] [ref=e75]
        - link "Alle nyheter →" [ref=e76] [cursor=pointer]:
          - /url: /blog/
      - generic [ref=e77]:
        - article [ref=e78]:
          - generic [ref=e80]:
            - paragraph [ref=e81]:
              - time [ref=e82]: 7. mai 2026
            - heading [level=3] [ref=e83]:
              - 'link "NM 2026: Dabs, drama og 10 gull på rad" [ref=e84] [cursor=pointer]':
                - /url: /post/nm-2026-dabs-drama-og-10-gull-på-rad/
            - paragraph [ref=e85]: I langhelgen 1. Mai var det endelig duket for NM. 28 spente deltakere inntok Kvernhallen for å kjempe om de 26 pokalene som skulle deles ut i ulike klasser. Undertegnede ble dratt inn i NM-bobla litt tidligere enn først beregnet, da jeg ble ringt på Facetime av Andreas Fjermestad for å overvære cup-trekningen. «Vi tenkte først å trekke cupen uten livestream, men vi kom på at du er den eneste som hadde brydd deg, så vi ringte deg bare direkte heller.
            - list "Kategorier" [ref=e86]:
              - listitem [ref=e87]:
                - link "Turneringsreferat" [ref=e88] [cursor=pointer]:
                  - /url: /blog/categories/turneringsreferat/
        - article [ref=e89]:
          - generic [ref=e91]:
            - paragraph [ref=e92]:
              - time [ref=e93]: 1. mai 2026
            - heading [level=3] [ref=e94]:
              - link "Hvem kan utfordre Magnus i årets NM?" [ref=e95] [cursor=pointer]:
                - /url: /post/hvem-kan-utfordre-magnus-i-årets-nm/
            - paragraph [ref=e96]: Magnus Klippen har dominert norsk bordhockey i et tiår og vel så det. I årets NM har han mulighet til å ta sitt tiende NM-gull ... og det på rad! Naturlig nok er han igjen favoritt til å vinne. Likevel mener jeg sjansen sjelden har vært større for at seiersrekken ryker. La oss ta en nærmere titt.
        - article [ref=e97]:
          - generic [ref=e99]:
            - paragraph [ref=e100]:
              - time [ref=e101]: 14. mars 2026
            - heading [level=3] [ref=e102]:
              - 'link "Profetien på Singsaker: Trondheim Open 2026 oppsummert" [ref=e103] [cursor=pointer]':
                - /url: /post/profetien-på-singsaker-trondheim-open-2026-oppsummert/
            - paragraph [ref=e104]: Den 7. mars vendte bordhockeynorges oppmerksomhet tilbake til Trondheim og Singsaker skole. I musikklasserommet med de karakteristiske røde takstolene var 9 spillere klare til å komponere vakre toner på brettet. Denne illusjonen ble raskt brutt da hjemvendte Espen Moe anklaget Amund Risa Fylling for å spille hockey som Arsenal (kynisk, senterfintefokusert hockey sammenlignet med treg døballfotball) allerede i første av 27 runder i grunnspillet.
    - region [ref=e105]:
      - generic [ref=e106]:
        - heading "Om Norges Bordhockeyforbund" [level=2] [ref=e107]
        - paragraph [ref=e108]: Norges Bordhockeyforbund har arrangert bordhockeyturneringer siden 1991. Forbundet arbeider for å fremme bordhockeysporten, støtte lokalligaer og gjøre sporten mer tilgjengelig for alle.
        - link "Les mer om oss →" [ref=e110] [cursor=pointer]:
          - /url: /om-oss/
  - contentinfo [ref=e111]:
    - generic [ref=e112]:
      - generic [ref=e113]:
        - link "NBHF – Norges Bordhockeyforbund" [ref=e114] [cursor=pointer]:
          - /url: /
          - generic [ref=e115]:
            - generic [ref=e116]: NBHF
            - generic [ref=e117]: Norges Bordhockeyforbund
        - paragraph [ref=e118]:
          - text: "Kontakt:"
          - link "amund.fylling@puck.no" [ref=e119] [cursor=pointer]:
            - /url: mailto:amund.fylling@puck.no
      - navigation "SPILL BORDHOCKEY" [ref=e120]:
        - paragraph [ref=e121]:
          - link "SPILL BORDHOCKEY" [ref=e122] [cursor=pointer]:
            - /url: /spill-bordhockey/
        - list [ref=e123]:
          - listitem [ref=e124]:
            - link "Lokalligaer" [ref=e125] [cursor=pointer]:
              - /url: /lokalligaer/
          - listitem [ref=e126]:
            - link "Lær bordhockey" [ref=e127] [cursor=pointer]:
              - /url: /lær-bordhockey/
          - listitem [ref=e128]:
            - link "Turneringer" [ref=e129] [cursor=pointer]:
              - /url: /turneringer/
      - navigation "RESSURSER" [ref=e130]:
        - paragraph [ref=e131]:
          - link "RESSURSER" [ref=e132] [cursor=pointer]:
            - /url: /ressurser/
        - list [ref=e133]:
          - listitem [ref=e134]:
            - link "Timere" [ref=e135] [cursor=pointer]:
              - /url: /timere/
          - listitem [ref=e136]:
            - link "Verdensranking ITHF (åpnes i ny fane)" [ref=e137] [cursor=pointer]:
              - /url: https://stiga.trefik.cz/ithf/ranking/index.aspx
              - text: Verdensranking ITHF
              - generic [ref=e138]: (åpnes i ny fane)
          - listitem [ref=e139]:
            - link "Kvalifisering EM26" [ref=e140] [cursor=pointer]:
              - /url: /kvalifisering-mesterskap/
      - navigation "OM OSS" [ref=e141]:
        - paragraph [ref=e142]:
          - link "OM OSS" [ref=e143] [cursor=pointer]:
            - /url: /om-oss/
        - list [ref=e144]:
          - listitem [ref=e145]:
            - link "Om oss" [ref=e146] [cursor=pointer]:
              - /url: /om-oss/
          - listitem [ref=e147]:
            - link "Referat fra årsmøter" [ref=e148] [cursor=pointer]:
              - /url: /årsmøter/
      - navigation "Snarveier" [ref=e149]:
        - paragraph [ref=e150]: Snarveier
        - list [ref=e151]:
          - listitem [ref=e152]:
            - link "HJEM" [ref=e153] [cursor=pointer]:
              - /url: /
          - listitem [ref=e154]:
            - link "NYHETER" [ref=e155] [cursor=pointer]:
              - /url: /blog/
          - listitem [ref=e156]:
            - link "BILDER" [ref=e157] [cursor=pointer]:
              - /url: /bilder/
          - listitem [ref=e158]:
            - link "Personvern" [ref=e159] [cursor=pointer]:
              - /url: /personvern/
          - listitem [ref=e160]:
            - link "RSS" [ref=e161] [cursor=pointer]:
              - /url: /blog-feed.xml
          - listitem [ref=e162]:
            - link "ITHF (åpnes i ny fane)" [ref=e163] [cursor=pointer]:
              - /url: https://www.ithf.info/stiga/ithf/ithf.asp
              - text: ITHF
              - generic [ref=e164]: (åpnes i ny fane)
    - paragraph [ref=e166]: © 2026 Norges Bordhockeyforbund
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
      |         ^ Error: Axe accessibility violations found on /:
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