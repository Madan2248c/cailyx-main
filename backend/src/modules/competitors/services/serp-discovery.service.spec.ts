import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { DataForSeoSerpService } from '../../discovery/services/dataforseo-serp.service.js';
import { SerpDiscoveryService } from './serp-discovery.service.js';

function fact(value: string) {
  return { fact_id: 'f1', value, status: 'supported', fact_type: 'explicit', confidence: 1, last_checked_at: '', evidence_ids: [], evidence: [] };
}

describe('SerpDiscoveryService', () => {
  let prisma: PrismaMock;
  let serp: { search: ReturnType<typeof vi.fn> };
  let service: SerpDiscoveryService;

  function setup() {
    prisma = createPrismaMock();
    serp = { search: vi.fn() };
    service = new SerpDiscoveryService(asPrismaService(prisma) as unknown as PrismaService, serp as unknown as DataForSeoSerpService);
  }

  it('skips with a reason when no CompanyContextProfile exists — never guesses queries', async () => {
    setup();
    prisma.companyContextProfile.findFirst.mockResolvedValue(null);
    const result = await service.discover('project-1', 'acme.io');
    expect(result.skipped).toMatch(/CompanyContextProfile/);
    expect(serp.search).not.toHaveBeenCalled();
  });

  it('skips when the profile has no usable grounding terms', async () => {
    setup();
    prisma.companyContextProfile.findFirst.mockResolvedValue({ profileJson: { identity: {}, customers: {}, offerings: {} } });
    const result = await service.discover('project-1', 'acme.io');
    expect(result.skipped).toMatch(/no usable/);
    expect(serp.search).not.toHaveBeenCalled();
  });

  it('builds queries from company_type / industry / service and excludes the own domain from results', async () => {
    setup();
    prisma.companyContextProfile.findFirst.mockResolvedValue({
      profileJson: {
        identity: { company_type: fact('CRM software') },
        customers: { industries: [fact('real estate')] },
        offerings: { services: [fact('lead automation')] },
      },
    });
    serp.search.mockResolvedValue({
      links: [{ url: 'https://acme.io/', title: null, position: 1 }, { url: 'https://rival-a.com/', title: null, position: 2 }, { url: 'https://rival-b.com/pricing', title: null, position: 3 }],
      costUsd: 0.002,
      cached: false,
      skipped: null,
    });

    const result = await service.discover('project-1', 'acme.io');

    expect(serp.search).toHaveBeenCalledTimes(3); // company_type + industry + service
    expect(result.domains.sort()).toEqual(['rival-a.com', 'rival-b.com']);
    expect(result.domains).not.toContain('acme.io');
    expect(result.costUsd).toBeCloseTo(0.006, 5);
  });

  it('reports the skip reason only when every query was skipped, not when some succeeded', async () => {
    setup();
    prisma.companyContextProfile.findFirst.mockResolvedValue({ profileJson: { identity: { company_type: fact('CRM software') }, customers: {}, offerings: {} } });
    serp.search.mockResolvedValue({ links: [], costUsd: 0, cached: false, skipped: 'DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set' });
    const result = await service.discover('project-1', 'acme.io');
    expect(result.skipped).toMatch(/DATAFORSEO/);
    expect(result.domains).toEqual([]);
  });
});
