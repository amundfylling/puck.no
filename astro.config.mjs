// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { satteri } from '@astrojs/markdown-satteri';

/**
 * Sätteri hast plugin: give internal links in rendered markdown the
 * trailing-slash form the site serves (Cloudflare Pages 308s the slash-less
 * form). Content files stay verbatim — this rewrites at render time. Skips
 * file paths, /media, /api, and the old-URL prefixes that are _redirects
 * sources (/members-area, /event-details — those must keep their exact form).
 * @param {string | null} href
 */
function withSlash(href) {
  if (!href || !href.startsWith('/') || href.startsWith('//')) return null;
  const hashIdx = href.search(/[?#]/);
  const path = hashIdx === -1 ? href : href.slice(0, hashIdx);
  const rest = hashIdx === -1 ? '' : href.slice(hashIdx);
  if (path.endsWith('/') || /^\/(en\/)?(media|api|members-area|event-details)(\/|$)/.test(path)) {
    return null;
  }
  const last = path.split('/').pop() ?? '';
  if (last.includes('.')) return null; // file (pdf, xml, ...)
  return `${path}/${rest}`;
}

/** @type {import('satteri').HastPluginDefinition} */
const trailingSlashLinks = {
  name: 'trailing-slash-links',
  element: {
    filter: ['a'],
    visit(node, ctx) {
      const next = withSlash(typeof node.properties?.href === 'string' ? node.properties.href : null);
      if (next) {
        ctx.replaceNode(node, { ...node, properties: { ...node.properties, href: next } });
      }
    },
  },
  raw(node, ctx) {
    if (typeof node.value !== 'string' || !node.value.includes('href="/')) return;
    const next = node.value.replace(/href="(\/[^"]*)"/g, (m, p) => {
      const s = withSlash(p);
      return s ? `href="${s}"` : m;
    });
    if (next !== node.value) ctx.replaceNode(node, { ...node, value: next });
  },
};

export default defineConfig({
  site: 'https://www.puck.no',
  // Cloudflare Pages serves directory pages with a trailing slash (and 308s
  // the slash-less form) — keep every generated URL in the slash form so no
  // internal link, canonical, or sitemap entry hits that redirect.
  trailingSlash: 'always',
  integrations: [sitemap()],
  markdown: {
    processor: satteri({ hastPlugins: [trailingSlashLinks] }),
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      // Keep every script an external file — the strict CSP (public/_headers)
      // forbids inline scripts, and Astro inlines bundles below Vite's
      // default 4 kB assetsInlineLimit.
      assetsInlineLimit: 0,
    },
  },
});
