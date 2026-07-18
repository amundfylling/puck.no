import galleriesData from '../data/galleries.json';

export interface Gallery {
  slug: string;
  title: string;
  images: string[];
}

export const galleries: Gallery[] = Object.entries(galleriesData).map(([slug, g]) => ({
  slug,
  title: (g as { title: string }).title,
  images: (g as { images: string[] }).images,
}));

export const thumbOf = (slug: string, src: string) =>
  src.replace(`/media/galleries/${slug}/`, `/media/galleries/${slug}/thumbs/`);
