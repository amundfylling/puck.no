import { statSync } from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import type { Post } from './content';
import type { Lang } from './i18n';

const SITE = 'https://www.puck.no';

marked.use({ gfm: true, breaks: false });

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cdata(s: string): string {
  return `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function enclosure(cover: string): string {
  const file = path.join(process.cwd(), 'public', cover);
  let length = 0;
  try {
    length = statSync(file).size;
  } catch {
    return '';
  }
  const type = MIME[path.extname(cover).toLowerCase()] ?? 'application/octet-stream';
  return `<enclosure url="${SITE}${cover}" length="${length}" type="${type}"/>`;
}

/** Full post body as HTML with absolute media URLs (for content:encoded). */
function bodyHtml(post: Post): string {
  const html = marked.parse(post.body ?? '', { async: false });
  return html.replace(/(src|href)="\/media\//g, `$1="${SITE}/media/`);
}

export function buildFeed(posts: Post[], lang: Lang): string {
  const prefix = lang === 'en' ? '/en' : '';
  const feedPath = `${prefix}/blog-feed.xml`;
  const items = posts
    .map((post) => {
      const url = `${SITE}${prefix}/post/${post.data.slug}/`;
      const cats = post.data.categories.map((c) => `<category>${escapeXml(c)}</category>`).join('');
      return `<item>
<title>${escapeXml(post.data.title)}</title>
<link>${url}</link>
<guid isPermaLink="true">${url}</guid>
<pubDate>${post.data.pubDate.toUTCString()}</pubDate>
${cats}
<description>${escapeXml(post.data.description ?? '')}</description>
<content:encoded>${cdata(bodyHtml(post))}</content:encoded>
${post.data.cover ? enclosure(post.data.cover) : ''}
</item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${lang === 'en' ? 'NBHF news' : 'NYHETER | Bordhockeyforbundet'}</title>
<link>${SITE}${prefix}/blog/</link>
<description>${
    lang === 'en'
      ? 'Latest news from Norwegian table hockey'
      : 'Siste nytt fra bordhockeynorge! Her kan man lese seg opp på kommende eller ferdigspilte turneringer og annet spennende innhold.'
  }</description>
<language>${lang === 'en' ? 'en' : 'no'}</language>
<atom:link href="${SITE}${feedPath}" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>
`;
}
