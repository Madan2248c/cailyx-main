import { describe, expect, it } from 'vitest';
import { buildBusinessBrief } from './business-brief.js';

const fact = (value: unknown, status = 'supported') => ({ value, status, fact_id: 'f', evidence: [] });

describe('buildBusinessBrief', () => {
  const profile = {
    descriptions: { short: fact('Faydo sells discounted gift cards.') },
    offerings: { services: [fact('Prepaid brand gift cards up to 35% off'), fact('Deal discovery and search')] },
    positioning: { value_propositions: [fact('Save on 300+ brands')] },
    geography: { headquarters: fact('Bhubaneswar, India'), countries: [] },
    customers: { icp_summary: null, use_cases: [], industries: [] },
    go_to_market: { business_model: fact('early-stage startup') },
  };

  it('summarises what the company is, sells and where, from fact values', () => {
    const brief = buildBusinessBrief(profile, 'Faydo');
    expect(brief).toContain('Subject: Faydo');
    expect(brief).toContain('Faydo sells discounted gift cards.');
    expect(brief).toContain('Prepaid brand gift cards up to 35% off | Deal discovery and search');
    expect(brief).toContain('Bhubaneswar, India');
  });

  it('never invents an audience that the profile does not state', () => {
    expect(buildBusinessBrief(profile, 'Faydo')).not.toMatch(/Ideal customer|Buyers:/);
  });

  it('ignores facts that are not supported', () => {
    const brief = buildBusinessBrief({ offerings: { services: [fact('Made-up thing', 'unsupported')] } }, 'Faydo');
    expect(brief).not.toContain('Made-up thing');
  });

  it('copes with an empty or missing profile', () => {
    expect(buildBusinessBrief(null, 'Faydo')).toBe('Subject: Faydo');
    expect(buildBusinessBrief({}, 'Faydo')).toBe('Subject: Faydo');
  });

  it('states the ideal customer when the profile has one', () => {
    const brief = buildBusinessBrief({ customers: { icp_summary: fact('Urban Indian shoppers who buy gift cards') } }, 'Faydo');
    expect(brief).toContain('Ideal customer: Urban Indian shoppers who buy gift cards');
  });
});
