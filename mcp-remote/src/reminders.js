/**
 * Daily tournament reminder emails.
 *
 * One month before a tournament starts, everyone who has ever registered for a
 * tournament on puck.no gets an email linking to it — unless they are already
 * registered for it or have unsubscribed. Players who are not Norwegian only
 * hear about Norway Open.
 *
 * Sending is OFF unless REMINDER_EMAILS_ENABLED = "true" and RESEND_API_KEY is
 * set. Without them the job only logs how many emails it would send.
 * REMINDER_TEST_RECIPIENT sends one sample per tournament and language to that
 * single address instead (nothing is recorded as sent).
 */
import { getTextFile } from './github.js';
import { parseNoDate } from './lib/dates.js';
import { parseMdText } from './lib/frontmatter.js';
import { getTournamentConfig } from './lib/tournamentConfig.js';

const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
const RESEND_BATCH_SIZE = 100;
// A missed daily run (outage, deploy) still sends within this many days.
const SEND_WINDOW_DAYS = 7;
const DEFAULT_SITE_URL = 'https://www.puck.no';

const emailKey = (email) => String(email ?? '').trim().toLowerCase();
export const isNorwayOpen = (slug) => slug.startsWith('norway-open');

function osloParts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

/** 09:00 Europe/Oslo — the cron fires at both UTC offsets, only one matches. */
export function isOsloReminderTime(date) {
  return osloParts(date).hour === '09';
}

export function osloDateKey(date) {
  const p = osloParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

const toKey = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Start date one calendar month earlier (31 March → 28/29 February). */
function monthBefore(date) {
  const y = date.getFullYear();
  const m = date.getMonth() - 1;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(date.getDate(), lastDay));
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

const keyOf = (date) => toKey(date.getFullYear(), date.getMonth(), date.getDate());

/** Slugs whose reminder day is today (or up to SEND_WINDOW_DAYS-1 days ago). */
export function dueTournaments(config, todayKey) {
  return Object.entries(config).flatMap(([slug, tournament]) => {
    if (tournament.registrationOpen === false) return [];
    const start = parseNoDate(tournament.date);
    if (!start) return [];
    const remindFrom = monthBefore(start);
    const due = keyOf(remindFrom) <= todayKey &&
      todayKey < keyOf(addDays(remindFrom, SEND_WINDOW_DAYS)) &&
      todayKey < keyOf(start);
    return due ? [slug] : [];
  });
}

function parseArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Countries and ITHF ids linked to one registration row. */
function rowPlayers(row) {
  if (row.type === 'team') {
    const roster = parseArray(row.roster);
    const ids = new Set(parseArray(row.player_ids).filter(Number.isInteger));
    for (const player of roster) if (Number.isInteger(player?.playerId)) ids.add(player.playerId);
    return { countries: roster.map((player) => player?.country).filter(Boolean), ids: [...ids] };
  }
  return {
    countries: row.country ? [row.country] : [],
    ids: Number.isInteger(row.player_id) ? [row.player_id] : [],
  };
}

/** Group registrations by address: { key → { email, countries, slugs, ids } }. */
export function collectRecipients(rows) {
  const recipients = new Map();
  for (const row of rows) {
    const key = emailKey(row.email);
    if (!key.includes('@')) continue;
    let recipient = recipients.get(key);
    if (!recipient) {
      recipient = { email: String(row.email).trim(), countries: new Set(), slugs: new Set(), ids: new Set() };
      recipients.set(key, recipient);
    }
    const { countries, ids } = rowPlayers(row);
    // A team contact address is linked to the whole roster's ids (to detect an
    // existing registration) but only counts as Norwegian if a player is.
    for (const country of countries) recipient.countries.add(country);
    if (row.type !== 'team') for (const id of ids) recipient.ids.add(id);
    recipient.slugs.add(row.tournament_slug);
  }
  return recipients;
}

/**
 * Norwegian = any linked ranked player is NOR. Without ranking data
 * (unranked newcomers) the address counts as Norwegian unless it has only
 * ever registered for Norway Open.
 */
export function isNorwegian(recipient) {
  if (recipient.countries.size) return recipient.countries.has('NOR');
  return [...recipient.slugs].some((slug) => !isNorwayOpen(slug));
}

function registeredIn(rows, slug) {
  const emails = new Set();
  const ids = new Set();
  for (const row of rows) {
    if (row.tournament_slug !== slug) continue;
    emails.add(emailKey(row.email));
    for (const id of rowPlayers(row).ids) ids.add(id);
  }
  return { emails, ids };
}

/** Pure planning step: who gets which tournament, in which language. */
export function planReminders({ rows, dueSlugs, sent, unsubscribed }) {
  const recipients = collectRecipients(rows);
  const plan = [];
  for (const slug of dueSlugs) {
    const registered = registeredIn(rows, slug);
    for (const [key, recipient] of recipients) {
      if (unsubscribed.has(key) || sent.has(`${slug}\n${key}`)) continue;
      if (registered.emails.has(key) || [...recipient.ids].some((id) => registered.ids.has(id))) continue;
      const norwegian = isNorwegian(recipient);
      if (!norwegian && !isNorwayOpen(slug)) continue;
      plan.push({ slug, key, email: recipient.email, lang: norwegian ? 'no' : 'en' });
    }
  }
  return plan;
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);

export function renderReminder({ lang, tournament, url, unsubscribeUrl }) {
  const { name, date, location } = tournament;
  const where = location ? (lang === 'no' ? ` i ${location}` : ` in ${location}`) : '';
  const lines = lang === 'no'
    ? {
      subject: `${name} – ${date}`,
      intro: `${name} spilles ${date}${where}. Det er en måned igjen, og påmeldingen er åpen.`,
      cta: 'Les mer og meld deg på',
      why: 'Du får denne e-posten fordi du tidligere har meldt deg på en turnering på puck.no.',
      unsubscribe: 'Meld deg av disse e-postene',
      greeting: 'Hei!',
      signoff: 'Hilsen Norges Bordhockeyforbund',
    }
    : {
      subject: `${name} – ${date}`,
      intro: `${name} takes place on ${date}${where}. It is one month away and registration is open.`,
      cta: 'Read more and register',
      why: 'You are receiving this email because you have registered for a tournament on puck.no before.',
      unsubscribe: 'Unsubscribe from these emails',
      greeting: 'Hi!',
      signoff: 'Best regards, the Norwegian Table Hockey Federation',
    };
  const text = [
    lines.greeting, '', lines.intro, '', `${lines.cta}: ${url}`, '', lines.signoff, '', '--',
    lines.why, `${lines.unsubscribe}: ${unsubscribeUrl}`, '',
  ].join('\n');
  const html = `<p>${escapeHtml(lines.greeting)}</p>
<p>${escapeHtml(lines.intro)}</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(lines.cta)}</a></p>
<p>${escapeHtml(lines.signoff)}</p>
<hr>
<p style="font-size:12px;color:#64748b">${escapeHtml(lines.why)}
<a href="${escapeHtml(unsubscribeUrl)}">${escapeHtml(lines.unsubscribe)}</a></p>
`;
  return { subject: lines.subject, text, html };
}

async function tournamentTexts(env, slug, config) {
  const read = async (path) => {
    const raw = await getTextFile(env, path);
    return raw ? parseMdText(raw).data : {};
  };
  const no = await read(`src/content/tournaments/${slug}.md`);
  const en = await read(`src/content/tournaments/en/${slug}.md`);
  const name = no.name || slug;
  return {
    no: { name, date: config.date, location: no.location || '' },
    en: { name: en.name || name, date: en.date || config.date, location: en.location || no.location || '' },
  };
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Ensure every address has an unsubscribe token; returns key → token. */
async function tokensFor(env, keys) {
  const unique = [...new Set(keys)];
  const tokens = new Map();
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    await env.DB.batch(chunk.map((key) => env.DB.prepare(
      'INSERT OR IGNORE INTO reminder_recipients (email_key, token) VALUES (?, ?)',
    ).bind(key, randomToken())));
    const { results } = await env.DB.prepare(
      `SELECT email_key, token FROM reminder_recipients WHERE email_key IN (${chunk.map(() => '?').join(', ')})`,
    ).bind(...chunk).all();
    for (const row of results) tokens.set(row.email_key, row.token);
  }
  return tokens;
}

async function sendBatch(env, messages) {
  const res = await fetch(RESEND_BATCH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) throw new Error(`Resend svarte ${res.status}`);
}

function sendMode(env) {
  if (env.REMINDER_TEST_RECIPIENT && env.RESEND_API_KEY) return 'test';
  if (env.REMINDER_EMAILS_ENABLED === 'true' && env.RESEND_API_KEY) return 'live';
  return 'dry-run';
}

export async function runTournamentReminders(env, now = new Date()) {
  const mode = sendMode(env);
  const config = await getTournamentConfig(env);
  const { results: closed } = await env.DB.prepare(
    'SELECT tournament_slug FROM tournament_settings WHERE registration_open = 0',
  ).all();
  const closedSlugs = new Set(closed.map((row) => row.tournament_slug));
  const dueSlugs = dueTournaments(config, osloDateKey(now)).filter((slug) => !closedSlugs.has(slug));
  if (dueSlugs.length === 0) return { mode, tournaments: 0, planned: 0, sent: 0 };

  const { results: rows } = await env.DB.prepare(
    'SELECT tournament_slug, type, email, country, player_id, player_ids, roster FROM registrations',
  ).all();
  const { results: sentRows } = await env.DB.prepare(
    `SELECT tournament_slug, email_key FROM reminder_sends
     WHERE tournament_slug IN (${dueSlugs.map(() => '?').join(', ')})`,
  ).bind(...dueSlugs).all();
  const { results: unsubscribedRows } = await env.DB.prepare(
    'SELECT email_key FROM reminder_recipients WHERE unsubscribed_at IS NOT NULL',
  ).all();
  const plan = planReminders({
    rows,
    dueSlugs,
    sent: new Set(sentRows.map((row) => `${row.tournament_slug}\n${row.email_key}`)),
    unsubscribed: new Set(unsubscribedRows.map((row) => row.email_key)),
  });
  const summary = { mode, tournaments: dueSlugs.length, planned: plan.length, sent: 0 };
  if (mode === 'dry-run' || plan.length === 0) return summary;

  const siteUrl = (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');
  const texts = {};
  for (const slug of dueSlugs) texts[slug] = await tournamentTexts(env, slug, config[slug]);

  // Test mode: one sample per tournament and language, to the test address only.
  const toSend = mode === 'test'
    ? [...new Map(plan.map((item) => [`${item.slug}\n${item.lang}`, item])).values()]
    : plan;
  // Test samples get a dummy token so a click never unsubscribes a real player.
  const tokens = mode === 'test' ? new Map() : await tokensFor(env, toSend.map((item) => item.key));
  const messages = toSend.map((item) => {
    const path = item.lang === 'no' ? `/turneringer/${item.slug}/` : `/en/turneringer/${item.slug}/`;
    const unsubscribeUrl = `${siteUrl}/api/unsubscribe?token=${tokens.get(item.key) ?? 'test'}`;
    const { subject, text, html } = renderReminder({
      lang: item.lang,
      tournament: texts[item.slug][item.lang],
      url: `${siteUrl}${encodeURI(path)}`,
      unsubscribeUrl,
    });
    return {
      item,
      message: {
        from: env.REMINDER_FROM,
        to: [mode === 'test' ? env.REMINDER_TEST_RECIPIENT : item.email],
        ...(env.REMINDER_REPLY_TO ? { reply_to: env.REMINDER_REPLY_TO } : {}),
        subject: mode === 'test' ? `[TEST] ${subject}` : subject,
        text,
        html,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      },
    };
  });

  for (let i = 0; i < messages.length; i += RESEND_BATCH_SIZE) {
    const chunk = messages.slice(i, i + RESEND_BATCH_SIZE);
    await sendBatch(env, chunk.map(({ message }) => message));
    summary.sent += chunk.length;
    if (mode === 'live') {
      const sentAt = now.toISOString();
      await env.DB.batch(chunk.map(({ item }) => env.DB.prepare(
        'INSERT OR IGNORE INTO reminder_sends (tournament_slug, email_key, sent_at) VALUES (?, ?, ?)',
      ).bind(item.slug, item.key, sentAt)));
    }
  }
  return summary;
}
