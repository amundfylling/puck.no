import type { APIRoute } from 'astro';
import { getPosts } from '../lib/content';
import { buildFeed } from '../lib/rss';

export const GET: APIRoute = async () => {
  const posts = await getPosts('no');
  return new Response(buildFeed(posts, 'no'), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
