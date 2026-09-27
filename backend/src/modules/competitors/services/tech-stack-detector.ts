/**
 * Deterministic technology-fingerprint matcher — pure, no I/O. Given the
 * signals one homepage fetch already produced, runs every signature and
 * returns what matched. Ported from the old repo's `tech-stack.service.ts`'s
 * `detect()` method, extracted as a standalone function.
 *
 * @module competitors/services/tech-stack-detector
 */

import * as cheerio from 'cheerio';
import { EVIDENCE_MAX_LEN } from '../competitors.constants.js';
import { TECH_SIGNATURES } from '../tech-stack.signatures.js';
import type { TechStackFinding } from '../competitors.types.js';

/**
 * Run every signature against the four extracted signals. `headers` is
 * tested against every header VALUE (not one named key) since the vendor
 * that sets an identifying header — `server`, `via`, `x-powered-by`,
 * `cf-ray`, `x-amz-cf-id` — varies by CDN.
 */
export function detectTechStack(headers: Record<string, string>, html: string): TechStackFinding[] {
  const $ = cheerio.load(html);
  const headerValues = Object.values(headers);
  const scriptSrcs = $('script[src]')
    .map((_, el) => $(el).attr('src') || '')
    .get()
    .join('\n');
  const generator = $('meta[name="generator"]').attr('content') || '';

  const found: TechStackFinding[] = [];

  for (const sig of TECH_SIGNATURES) {
    const evidence: string[] = [];

    if (sig.headers) {
      for (const re of sig.headers) {
        const match = headerValues.find((v) => re.test(v));
        if (match) evidence.push(match.slice(0, EVIDENCE_MAX_LEN));
      }
    }
    if (sig.scriptSrc) {
      const match = scriptSrcs.match(sig.scriptSrc);
      if (match) evidence.push(match[0].slice(0, EVIDENCE_MAX_LEN));
    }
    if (sig.generator && generator) {
      const match = generator.match(sig.generator);
      if (match) evidence.push(generator.slice(0, EVIDENCE_MAX_LEN));
    }
    if (sig.html) {
      const match = html.match(sig.html);
      if (match) evidence.push(match[0].slice(0, EVIDENCE_MAX_LEN));
    }

    if (evidence.length > 0) {
      found.push({ category: sig.category, name: sig.name, evidence });
    }
  }

  return found;
}
