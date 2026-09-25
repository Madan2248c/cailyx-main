/**
 * Content fingerprinting — shared by Discovery (catch-all-route dedup during
 * the crawl) and Technical Audit (cross-page duplicate-content detection).
 * Same algorithm, same reason to want it in one place: two callers computing
 * "is this the same content as that" need to agree on what "same" means, or
 * a page one module treats as a duplicate the other won't.
 *
 * @module fetcher/content-fingerprint
 */

/**
 * A DJB2-style rolling hash of the first 4000 characters of
 * whitespace-normalized content, plus the length of that slice.
 *
 * The cutoff is deliberate and has a known consequence: two genuinely
 * different pages that share their first 4000 characters — realistically
 * only if they share a very long block of boilerplate — fingerprint
 * identically. That trade-off is accepted by both callers: hashing the whole
 * page would make the check meaningless on any page with a dynamic element.
 */
export function fingerprint(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim().slice(0, 4000);
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = (Math.imul(hash, 33) ^ normalized.charCodeAt(i)) >>> 0;
  }
  return String(hash) + ':' + normalized.length;
}
