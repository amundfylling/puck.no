import { getPublicImageDimensions } from '../lib/media.ts';

function hasAttribute(tag, name) {
  return new RegExp(`\\s${name}\\s*=`, 'i').test(tag);
}

function addAttributes(tag, attributes) {
  const serialized = Object.entries(attributes)
    .filter(([name, value]) => value != null && !hasAttribute(tag, name))
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('');
  return serialized ? tag.replace(/\s*\/?\s*>$/, `${serialized}>`) : tag;
}

/**
 * Add layout-stable dimensions and browser loading hints to local Markdown
 * images without changing the Markdown source. Raw HTML image fragments are
 * handled as well as normal Markdown image nodes.
 *
 * @type {import('satteri').HastPluginDefinition}
 */
export const satteriRehypeMedia = {
  name: 'rehype-local-media',
  element: {
    filter: ['img'],
    async visit(node, ctx) {
      const src = typeof node.properties?.src === 'string' ? node.properties.src : null;
      const dimensions = await getPublicImageDimensions(src);
      if (dimensions) {
        if (node.properties?.width == null) ctx.setProperty(node, 'width', dimensions.width);
        if (node.properties?.height == null) ctx.setProperty(node, 'height', dimensions.height);
      }
      if (node.properties?.loading == null) ctx.setProperty(node, 'loading', 'lazy');
      if (node.properties?.decoding == null) ctx.setProperty(node, 'decoding', 'async');
    },
  },
  async raw(node, ctx) {
    if (typeof node.value !== 'string' || !/<img\b/i.test(node.value)) return;

    const matches = [...node.value.matchAll(/<img\b[^>]*>/gi)];
    if (matches.length === 0) return;

    let cursor = 0;
    let next = '';
    for (const match of matches) {
      const tag = match[0];
      const srcMatch = tag.match(/\ssrc\s*=\s*(["'])(.*?)\1/i);
      const src = srcMatch?.[2] ?? null;
      const dimensions = await getPublicImageDimensions(src);
      const enhanced = addAttributes(tag, {
        width: dimensions?.width,
        height: dimensions?.height,
        loading: 'lazy',
        decoding: 'async',
      });
      next += node.value.slice(cursor, match.index) + enhanced;
      cursor = (match.index ?? 0) + tag.length;
    }
    next += node.value.slice(cursor);
    if (next !== node.value) ctx.replaceNode(node, { ...node, value: next });
  },
};
