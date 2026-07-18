export type Lang = 'no' | 'en';

export interface NavItem {
  label: string;
  href: string;
  external?: boolean;
  children?: NavItem[];
}

/** Main navigation, mirroring the old Wix site structure. */
export function navItems(lang: Lang): NavItem[] {
  const p = (path: string) => (lang === 'en' ? `/en${path}` : path);
  if (lang === 'en') {
    return [
      { label: 'HOME', href: '/en' },
      {
        label: 'PLAY TABLE HOCKEY',
        href: p('/spill-bordhockey'),
        children: [
          { label: 'Local leagues', href: p('/lokalligaer') },
          { label: 'Learn table hockey', href: p('/lær-bordhockey') },
          { label: 'Tournaments', href: p('/turneringer') },
        ],
      },
      { label: 'NEWS', href: p('/blog') },
      {
        label: 'RESOURCES',
        href: p('/ressurser'),
        children: [
          { label: 'Timers', href: p('/timere') },
          {
            label: 'World ranking ITHF',
            href: 'https://stiga.trefik.cz/ithf/ranking/index.aspx',
            external: true,
          },
          { label: 'EURO 2026 qualification', href: p('/kvalifisering-mesterskap') },
        ],
      },
      { label: 'GALLERIES', href: p('/bilder') },
      {
        label: 'ABOUT US',
        href: p('/om-oss'),
        children: [
          { label: 'About us', href: p('/om-oss') },
          { label: 'Annual meeting minutes', href: p('/årsmøter') },
        ],
      },
    ];
  }
  return [
    { label: 'HJEM', href: '/' },
    {
      label: 'SPILL BORDHOCKEY',
      href: '/spill-bordhockey',
      children: [
        { label: 'Lokalligaer', href: '/lokalligaer' },
        { label: 'Lær bordhockey', href: '/lær-bordhockey' },
        { label: 'Turneringer', href: '/turneringer' },
      ],
    },
    { label: 'NYHETER', href: '/blog' },
    {
      label: 'RESSURSER',
      href: '/ressurser',
      children: [
        { label: 'Timere', href: '/timere' },
        {
          label: 'Verdensranking ITHF',
          href: 'https://stiga.trefik.cz/ithf/ranking/index.aspx',
          external: true,
        },
        { label: 'Kvalifisering EM26', href: '/kvalifisering-mesterskap' },
      ],
    },
    { label: 'BILDER', href: '/bilder' },
    {
      label: 'OM OSS',
      href: '/om-oss',
      children: [
        { label: 'Om oss', href: '/om-oss' },
        { label: 'Referat fra årsmøter', href: '/årsmøter' },
      ],
    },
  ];
}

/** UI strings (chrome, not content). */
export const ui = {
  skipLink: { no: 'Hopp til innhold', en: 'Skip to content' },
  menuLabel: { no: 'Hovedmeny', en: 'Main menu' },
  openMenu: { no: 'Åpne meny', en: 'Open menu' },
  closeMenu: { no: 'Lukk meny', en: 'Close menu' },
  languageSwitcher: { no: 'Velg språk', en: 'Choose language' },
  readMore: { no: 'Les mer', en: 'Read more' },
  latestNews: { no: 'Siste nytt', en: 'Latest news' },
  allNews: { no: 'Alle nyheter', en: 'All news' },
  nextTournament: { no: 'Neste turnering', en: 'Next tournament' },
  upcoming: { no: 'Kommende', en: 'Upcoming' },
  past: { no: 'Tidligere', en: 'Past' },
  upcomingTournaments: { no: 'Kommende turneringer', en: 'Upcoming tournaments' },
  pastTournaments: { no: 'Tidligere turneringer', en: 'Past tournaments' },
  registeredPlayers: { no: 'Påmeldte spillere', en: 'Registered players' },
  name: { no: 'Navn', en: 'Name' },
  country: { no: 'Land', en: 'Country' },
  wr: { no: 'WR', en: 'WR' },
  registerPlayer: { no: 'Registrer spiller', en: 'Register player' },
  registrationPlaceholder: {
    no: 'Påmeldingsskjema kommer her (fase 3).',
    en: 'Registration form will be placed here (phase 3).',
  },
  openDocument: { no: 'Åpne dokument', en: 'Open document' },
  opensInNewTab: { no: '(åpnes i ny fane)', en: '(opens in new tab)' },
  categories: { no: 'Kategorier', en: 'Categories' },
  allPosts: { no: 'Alle innlegg', en: 'All posts' },
  pageOf: { no: 'Side', en: 'Page' },
  previous: { no: 'Forrige', en: 'Previous' },
  next: { no: 'Neste', en: 'Next' },
  published: { no: 'Publisert', en: 'Published' },
  play: { no: 'Spill av', en: 'Play' },
  pause: { no: 'Sett på pause', en: 'Pause' },
  images: { no: 'bilder', en: 'images' },
  close: { no: 'Lukk', en: 'Close' },
  previousImage: { no: 'Forrige bilde', en: 'Previous image' },
  nextImage: { no: 'Neste bilde', en: 'Next image' },
  photoOf: { no: 'Bilde', en: 'Image' },
  of: { no: 'av', en: 'of' },
  footerContact: { no: 'Kontakt', en: 'Contact' },
  schedule: { no: 'Tidsskjema', en: 'Schedule' },
  date: { no: 'Dato', en: 'Date' },
  prices: { no: 'Priser', en: 'Prices' },
  playingSystem: { no: 'Spillesystem', en: 'Playing system' },
  viewTournament: { no: 'Se turnering', en: 'View tournament' },
  tournaments: { no: 'Turneringer', en: 'Tournaments' },
  backToBlog: { no: 'Tilbake til bloggen', en: 'Back to the blog' },
} as const;

export type UiKey = keyof typeof ui;

export function t(lang: Lang, key: UiKey): string {
  return ui[key][lang];
}

/**
 * Blog post slug pairs (NO slug -> EN slug) for the two translated posts.
 * Used for the language switcher and hreflang.
 */
export const postMirrorsNoToEn: Record<string, string> = {
  'norway-open-2025-dramatikk-verdensstjerner-og-kanelboller':
    'norway-open-2025-drama-world-stars-and-cinnamon-buns',
  'hvem-vinner-bordhockey-nm-2025': 'who-will-win-the-norwegian-championship-2025',
};
export const postMirrorsEnToNo: Record<string, string> = Object.fromEntries(
  Object.entries(postMirrorsNoToEn).map(([no, en]) => [en, no]),
);

/** Page slugs whose route differs from the old Wix slug (old -> new). */
export const renamedPages: Record<string, string> = {
  'services-1': 'spill-bordhockey',
};

/** Route path for a static page slug in a given language. */
export function pagePath(slug: string, lang: Lang): string {
  const s = renamedPages[slug] ?? slug;
  if (s === 'index') return lang === 'en' ? '/en' : '/';
  return lang === 'en' ? `/en/${s}` : `/${s}`;
}
