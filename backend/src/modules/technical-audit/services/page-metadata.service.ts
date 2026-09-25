/**
 * Page metadata capture — title, meta description, headings, and a
 * best-effort "positioning copy" snippet for downstream entity/findings
 * stages.
 *
 * Ported from the old repo's `technical-audit.service.ts`
 * `capturePageMetadata` + `extractPositioningCopy`. Not a check — it never
 * produces an `AuditFinding`, just data other stages (and later modules)
 * read.
 *
 * @module technical-audit/services/page-metadata
 */

import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { FetcherService } from '../../fetcher/fetcher.service.js';
import type { HeadingInfo, PageMetadata } from '../technical-audit.types.js';
import type { AuditContext } from './audit-context.js';

/** A paragraph shorter than this is nav/label text, not real positioning copy. */
const MIN_POSITIONING_COPY_LENGTH = 20;

@Injectable()
export class PageMetadataService {
  constructor(private readonly fetcher: FetcherService) {}

  async capture(ctx: AuditContext): Promise<PageMetadata> {
    const res = await this.fetcher.fetch({ url: ctx.targetUrl, cacheTtlSeconds: 3600 }, 'technical-audit', ctx.runId);
    const $ = cheerio.load(res.body ?? '');

    const title = $('title').first().text().trim();
    const metaDescription = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim();
    const headings = this.extractHeadings($);

    return {
      title,
      metaDescription,
      headings,
      positioningCopy: this.extractPositioningCopy($, headings),
      capturedAt: new Date().toISOString(),
    };
  }

  private extractHeadings($: cheerio.CheerioAPI): HeadingInfo[] {
    const headings: HeadingInfo[] = [];
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      const text = $(el).text().trim();
      if (!text) return;
      headings.push({ level: Number(el.tagName.slice(1)), text });
    });
    return headings;
  }

  /**
   * Three-tier fallback for a short "what this page is about" snippet:
   * (1) the first `<p>` sibling *after* the page's H1, if long enough to be
   * real copy rather than a label; (2) failing that, the first `<p>`
   * anywhere on the page that clears the same length floor; (3) failing
   * that, the H1's own text — or an empty string when there is no H1 at all.
   */
  private extractPositioningCopy($: cheerio.CheerioAPI, headings: HeadingInfo[]): string {
    const h1 = $('h1').first();
    if (h1.length) {
      const nextP = h1.nextAll('p').first();
      if (nextP.length) {
        const text = nextP.text().trim();
        if (text.length >= MIN_POSITIONING_COPY_LENGTH) return text;
      }
    }

    const firstP = $('p')
      .filter((_, el) => $(el).text().trim().length >= MIN_POSITIONING_COPY_LENGTH)
      .first();
    if (firstP.length) return firstP.text().trim();

    return headings.find((h) => h.level === 1)?.text ?? '';
  }
}
