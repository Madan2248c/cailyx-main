import { describe, expect, it, vi } from 'vitest';
import type { AuditContext } from '../audit-context.js';
import { SchemaCheck } from './schema.check.js';

const CTX: AuditContext = { runId: 'run-1', project: { id: 'p1', name: 'Acme', domain: 'acme.com' }, targetUrl: 'https://acme.com/' };

function buildFetcher(overrides: {
  fetchSchema?: ReturnType<typeof vi.fn>;
  verifyUrl?: ReturnType<typeof vi.fn>;
}) {
  return {
    fetchSchema: overrides.fetchSchema ?? vi.fn(),
    verifyUrl: overrides.verifyUrl ?? vi.fn(),
  } as unknown as import('../../../fetcher/fetcher.service.js').FetcherService;
}

describe('SchemaCheck', () => {
  it('fails with medium severity when no schema is found at all', async () => {
    const fetcher = buildFetcher({ fetchSchema: vi.fn().mockResolvedValue({ url: CTX.targetUrl, status: 200, schemas: [], raw: '' }) });
    const check = new SchemaCheck(fetcher);

    const finding = await check.run(CTX);

    expect(finding.status).toBe('fail');
    expect(finding.severity).toBe('medium');
    expect(finding.recommendedFix).toContain('No JSON-LD structured data found');
    expect((finding.detail as { schemasFound: boolean }).schemasFound).toBe(false);
  });

  it('passes when an Organization schema has every required field', async () => {
    const fetcher = buildFetcher({
      fetchSchema: vi.fn().mockResolvedValue({
        url: CTX.targetUrl,
        status: 200,
        schemas: [
          {
            type: 'Organization',
            fields: { name: 'Acme', url: 'https://acme.com', logo: 'https://acme.com/logo.png', sameAs: ['https://x.com/acme'], description: 'We make widgets' },
          },
        ],
        raw: '',
      }),
      verifyUrl: vi.fn().mockResolvedValue({ url: 'https://x.com/acme', finalUrl: 'https://x.com/acme', resolves: true, identityMatch: true, checkedAt: new Date().toISOString() }),
    });
    const check = new SchemaCheck(fetcher);

    const finding = await check.run(CTX);

    expect(finding.status).toBe('pass');
    expect(finding.severity).toBe('low');
    expect((finding.detail as { missingFields: string[] }).missingFields).toEqual([]);
  });

  it('fails, but only at low/medium severity, when more than 3 required fields are missing', async () => {
    const fetcher = buildFetcher({
      fetchSchema: vi.fn().mockResolvedValue({
        url: CTX.targetUrl,
        status: 200,
        schemas: [{ type: 'Organization', fields: { name: 'Acme' } }], // url, logo, sameAs, description all missing = 4 > 3
        raw: '',
      }),
    });
    const check = new SchemaCheck(fetcher);

    const finding = await check.run(CTX);

    expect(finding.status).toBe('fail');
    // Severity does not escalate above 'low' for a missing-fields-only failure.
    expect(finding.severity).toBe('low');
    expect((finding.detail as { missingFields: string[] }).missingFields).toHaveLength(4);
  });

  it('tolerates 3 or fewer missing fields as a pass', async () => {
    const fetcher = buildFetcher({
      fetchSchema: vi.fn().mockResolvedValue({
        url: CTX.targetUrl,
        status: 200,
        // Missing: logo, sameAs, description (3) — should still pass.
        schemas: [{ type: 'Organization', fields: { name: 'Acme', url: 'https://acme.com' } }],
        raw: '',
      }),
    });
    const check = new SchemaCheck(fetcher);

    const finding = await check.run(CTX);

    expect(finding.status).toBe('pass');
  });

  it('detects Organization via substring match (e.g. GovernmentOrganization)', async () => {
    const fetcher = buildFetcher({
      fetchSchema: vi.fn().mockResolvedValue({
        url: CTX.targetUrl,
        status: 200,
        schemas: [{ type: 'GovernmentOrganization', fields: { name: 'Acme Dept' } }],
        raw: '',
      }),
    });
    const check = new SchemaCheck(fetcher);

    const finding = await check.run(CTX);

    expect((finding.detail as { hasOrganization: boolean }).hasOrganization).toBe(true);
  });

  it('verifies at most 10 sameAs URLs, and defaults a failed verification to unresolved', async () => {
    const many = Array.from({ length: 15 }, (_, i) => `https://social.example/${i}`);
    const verifyUrl = vi.fn().mockRejectedValue(new Error('network error'));
    const fetcher = buildFetcher({
      fetchSchema: vi.fn().mockResolvedValue({
        url: CTX.targetUrl,
        status: 200,
        schemas: [{ type: 'Organization', fields: { name: 'Acme', sameAs: many } }],
        raw: '',
      }),
      verifyUrl,
    });
    const check = new SchemaCheck(fetcher);

    const finding = await check.run(CTX);

    expect(verifyUrl).toHaveBeenCalledTimes(10);
    const verification = (finding.detail as { sameAsVerification: Array<{ resolves: boolean }> }).sameAsVerification;
    expect(verification).toHaveLength(10);
    expect(verification.every((v) => v.resolves === false)).toBe(true);
  });

  it('handles both array and single-string sameAs values', async () => {
    const fetcher = buildFetcher({
      fetchSchema: vi.fn().mockResolvedValue({
        url: CTX.targetUrl,
        status: 200,
        schemas: [
          { type: 'Organization', fields: { name: 'Acme', sameAs: 'https://x.com/acme' } },
          { type: 'WebSite', fields: { sameAs: ['https://y.com/acme'] } },
        ],
        raw: '',
      }),
      verifyUrl: vi.fn().mockResolvedValue({ url: '', finalUrl: '', resolves: true, checkedAt: '' }),
    });
    const check = new SchemaCheck(fetcher);

    const finding = await check.run(CTX);

    expect((finding.detail as { sameAsUrls: string[] }).sameAsUrls.sort()).toEqual(['https://x.com/acme', 'https://y.com/acme']);
  });
});
