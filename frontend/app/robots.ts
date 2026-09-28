import type { MetadataRoute } from 'next';

/** A private client portal: nothing here belongs in a search index. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
