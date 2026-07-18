import type { APIRoute } from 'astro';
import { getPosts } from '../../lib/content';
import { buildFeed } from '../../lib/rss';

export const GET: APIRoute = async () => {
  const posts = await getPosts('en');
  return new Response(buildFeed(posts, 'en'), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
