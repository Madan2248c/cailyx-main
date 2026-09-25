import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import {
  classifyPageType,
  classificationConfidenceFor,
  cleanValueList,
  containsVerbatim,
  extractJsonLd,
  extractServiceCandidates,
  extractValuePropCandidates,
  fingerprint,
  hostOf,
  internalNavLinks,
  isCandidatePhrase,
  isHomepageUrl,
  isSitemapFile,
  looksLike404,
  normalizeDomain,
  originOf,
  parseRobotsSitemaps,
  parseSitemapLocs,
  rawJsonLd,
  urlKey,
} from './pipeline-utils.js';

const $ = (html: string) => cheerio.load(html);

describe('urlKey / normalizeDomain', () => {
  it('treats a trailing slash and case as the same URL', () => {
    expect(urlKey('https://Acme.com/Services/')).toBe(urlKey('https://acme.com/Services'));
  });

  it('does NOT collapse two different paths or query strings', () => {
    expect(urlKey('https://acme.com/services')).not.toBe(urlKey('https://acme.com/services/tax'));
    expect(urlKey('https://acme.com/x?a=1')).not.toBe(urlKey('https://acme.com/x?a=2'));
  });

  it('normalizes a domain the same way the Projects module does', () => {
    expect(normalizeDomain('HTTPS://WWW.Acme.com/pricing?x=1')).toBe('www.acme.com');
    expect(originOf('www.acme.com')).toBe('https://www.acme.com');
  });

  it('identifies the site root regardless of trailing slash or case', () => {
    expect(isHomepageUrl('https://acme.com/', 'https://acme.com')).toBe(true);
    expect(isHomepageUrl('https://acme.com/services', 'https://acme.com')).toBe(false);
  });
});

describe('classifyPageType — pattern order is load-bearing', () => {
  it('does not mistake an offering page under /about for a service page', () => {
    expect(classifyPageType('https://acme.com/about/services', false)).toBe('about');
  });

  it('does not mistake a pricing page under /login for a pricing page', () => {
    expect(classifyPageType('https://acme.com/login/pricing', false)).toBe('login');
  });

  it('classifies the site root as the homepage whatever the URL looks like', () => {
    expect(classifyPageType('https://acme.com/pricing', true)).toBe('homepage');
  });

  it('maps the documented classes', () => {
    expect(classifyPageType('https://acme.com/pricing/plans', false)).toBe('pricing');
    expect(classifyPageType('https://acme.com/case-studies/acme-co', false)).toBe('case-study');
    expect(classifyPageType('https://acme.com/who-we-serve', false)).toBe('industries');
    expect(classifyPageType('https://acme.com/our-team', false)).toBe('leadership');
    expect(classifyPageType('https://acme.com/integrations', false)).toBe('partner');
    expect(classifyPageType('https://acme.com/security', false)).toBe('security');
    expect(classifyPageType('https://acme.com/blog/post-1', false)).toBe('blog');
    expect(classifyPageType('https://acme.com/cart', false)).toBe('cart');
    expect(classifyPageType('https://acme.com/legal/privacy', false)).toBe('policy');
    expect(classifyPageType('https://acme.com/zzz', false)).toBe('other');
  });

  it('reports low confidence for the unmatched fallback, high for a named pattern', () => {
    expect(classificationConfidenceFor('other')).toBe(0.3);
    expect(classificationConfidenceFor('homepage')).toBe(1);
    expect(classificationConfidenceFor('pricing')).toBe(0.9);
  });
});

describe('isCandidatePhrase', () => {
  it('keeps an offering-shaped phrase', () => {
    expect(isCandidatePhrase('Fractional CMO Services')).toBe(true);
    expect(isCandidatePhrase('Wealth Management')).toBe(true);
  });

  it('drops nav CTAs, tier labels, sentences and merchandising chrome', () => {
    expect(isCandidatePhrase('Book a demo')).toBe(false);
    expect(isCandidatePhrase('Starter')).toBe(false);
    expect(isCandidatePhrase('We help teams grow')).toBe(false);
    expect(isCandidatePhrase('Trusted by 400+ teams.')).toBe(false);
    expect(isCandidatePhrase('Shop by Category')).toBe(false);
    expect(isCandidatePhrase('New Arrivals')).toBe(false);
    expect(isCandidatePhrase('Get started')).toBe(false);
    expect(isCandidatePhrase('Read more')).toBe(false);
  });

  it('drops over-long phrases and single words', () => {
    expect(isCandidatePhrase('Outsourced accounting and bookkeeping for growing companies everywhere')).toBe(false);
    expect(isCandidatePhrase('Consulting')).toBe(false);
    expect(isCandidatePhrase('')).toBe(false);
  });
});

describe('looksLike404', () => {
  it('detects a 404 title and a "not found" title', () => {
    expect(looksLike404('404 — Page not found', '')).toBe(true);
    expect(looksLike404('Page Not Found | Acme', '')).toBe(true);
  });

  it('treats a short body as an error page but a long body as a real page', () => {
    expect(looksLike404(null, 'Sorry, not found.')).toBe(true);
    const longBody = 'Acme has offices in four cities and has been in business since 1998. '.repeat(6) + 'not found';
    expect(looksLike404('About us', longBody)).toBe(false);
  });

  it('does not fire on an ordinary page', () => {
    expect(looksLike404('About us', 'We are a consulting firm.')).toBe(false);
    expect(looksLike404(null, null)).toBe(false);
  });
});

describe('fingerprint', () => {
  it('ignores whitespace differences — the catch-all-route signal', () => {
    expect(fingerprint('Acme builds things.\n\nWe are based in Leeds.')).toBe(
      fingerprint('Acme builds things.   We are based in Leeds.'),
    );
  });

  it('separates genuinely different content', () => {
    expect(fingerprint('Acme builds widgets.')).not.toBe(fingerprint('Acme builds sprockets.'));
  });
});

describe('containsVerbatim', () => {
  it('matches across whitespace and case differences', () => {
    expect(containsVerbatim('We offer Fractional CMO Services today.', 'fractional cmo   services')).toBe(true);
  });

  it('does not match a paraphrase or an empty needle', () => {
    expect(containsVerbatim('We offer Fractional CMO Services.', 'Fractional CFO Services')).toBe(false);
    expect(containsVerbatim('anything', '')).toBe(false);
  });
});

describe('extractJsonLd', () => {
  it('expands @graph and keeps only relevant types and declared fields', () => {
    const entities = extractJsonLd(
      $(
        `<script type="application/ld+json">${JSON.stringify({
          '@graph': [
            { '@type': 'Organization', name: 'Acme', legalName: 'Acme Ltd', sameAs: ['https://x.com/acme'], junk: 'drop me' },
            { '@type': 'BreadcrumbList', name: 'ignored' },
          ],
        })}</script>`,
      ),
    );

    expect(entities).toHaveLength(1);
    expect(entities[0]!.type).toBe('Organization');
    expect(entities[0]!.fields.name).toBe('Acme');
    expect(entities[0]!.fields.sameAs).toEqual(['https://x.com/acme']);
    expect(entities[0]!.fields).not.toHaveProperty('junk');
  });

  it('picks the first relevant type when @type is an array', () => {
    const entities = extractJsonLd(
      $(`<script type="application/ld+json">${JSON.stringify({ '@type': ['ProfessionalService', 'Organization'], name: 'Acme' })}</script>`),
    );
    expect(entities[0]!.type).toBe('ProfessionalService');
  });

  it('skips a malformed block instead of throwing', () => {
    const entities = extractJsonLd($(`<script type="application/ld+json">{ not json </script>`));
    expect(entities).toEqual([]);
  });

  it('keeps an array-form document as its own node list', () => {
    const entities = extractJsonLd(
      $(`<script type="application/ld+json">${JSON.stringify([{ '@type': 'Organization', name: 'Acme' }])}</script>`),
    );
    expect(entities).toHaveLength(1);
  });
});

describe('rawJsonLd', () => {
  it('returns the raw script text so an excerpt can be checked verbatim', () => {
    const raw = rawJsonLd($(`<script type="application/ld+json">{"@type":"Organization","legalName":"Acme Ltd"}</script>`));
    expect(raw).toContain('Acme Ltd');
  });

  it('returns null when the page has no JSON-LD', () => {
    expect(rawJsonLd($('<html><body>nothing</body></html>'))).toBeNull();
  });
});

describe('extractServiceCandidates', () => {
  it('keeps heading and card titles that read as offerings', () => {
    const candidates = extractServiceCandidates(
      $(
        `<main>
           <h2>Tax Planning</h2>
           <div class="card"><h4>Wealth Management</h4></div>
           <div class="service-tile"><h4>Retirement Advice</h4></div>
         </main>`,
      ),
    );
    expect(candidates).toEqual(['Tax Planning', 'Wealth Management', 'Retirement Advice']);
  });

  it("does not read a team grid's people, a testimonial, nav or footer as services", () => {
    const candidates = extractServiceCandidates(
      $(
        `<div>
           <div class="team-member"><h2>Jordan Blake</h2></div>
           <div class="testimonial"><h3>Best firm we have used</h3></div>
           <nav><h2>About us</h2></nav>
           <footer><h3>Contact us</h3></footer>
         </div>`,
      ),
    );
    expect(candidates).toEqual([]);
  });

  it('drops nav/footer blocks nested under a card class too', () => {
    const candidates = extractServiceCandidates(
      $(`<div class="card"><footer><h4>Contact Us</h4></footer></div>`),
    );
    expect(candidates).toEqual([]);
  });
});

describe('extractValuePropCandidates', () => {
  it('keeps an H1 or hero line in the length window, sentence-shaped included', () => {
    const candidates = extractValuePropCandidates(
      $(
        `<h1>We help teams grow faster</h1>
         <div class="hero"><p>Accounting without the busywork, for founders who would rather build.</p></div>`,
      ),
    );
    expect(candidates).toHaveLength(2);
  });

  it('drops copy outside the 15-160 character window', () => {
    const candidates = extractValuePropCandidates(
      $(`<h1>Short</h1><div class="hero"><p>${'a'.repeat(200)}</p></div>`),
    );
    expect(candidates).toEqual([]);
  });
});

describe('link + sitemap parsing', () => {
  it('keeps only same-origin links, deduped, in document order', () => {
    const links = internalNavLinks(
      `<nav><a href="/services">S</a><a href="https://acme.com/services">dup</a><a href="https://other.com/x">off</a><a href="/about">A</a></nav>`,
      'https://acme.com',
    );
    expect(links).toEqual(['https://acme.com/services', 'https://acme.com/about']);
  });

  it('reads <loc> entries and robots Sitemap: directives', () => {
    expect(parseSitemapLocs('<urlset><url><loc> https://acme.com/a </loc></url></urlset>')).toEqual(['https://acme.com/a']);
    expect(parseRobotsSitemaps('User-agent: *\nDisallow: /x\nSitemap: https://acme.com/sitemap.xml\n')).toEqual([
      'https://acme.com/sitemap.xml',
    ]);
  });

  it('recognizes sitemap files, including gzipped ones', () => {
    expect(isSitemapFile('https://acme.com/sitemap.xml')).toBe(true);
    expect(isSitemapFile('https://acme.com/sitemap.xml.gz')).toBe(true);
    expect(isSitemapFile('https://acme.com/services')).toBe(false);
  });
});

describe('small helpers', () => {
  it('cleans a value list case-insensitively', () => {
    expect(cleanValueList([' Tax ', 'tax', '', 'Audit'])).toEqual(['Tax', 'Audit']);
  });

  it('strips www and lowercases a host, and survives junk', () => {
    expect(hostOf('https://WWW.Acme.com/x')).toBe('acme.com');
    expect(hostOf('not a url')).toBeNull();
  });
});
