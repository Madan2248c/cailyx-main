import { describe, expect, it } from 'vitest';
import type { CompanyContextProfileJson, FactValue } from '../../discovery/discovery.types.js';
import { extractGroundingContext } from './query-set.grounding.js';

function fact(value: string): FactValue {
  return {
    fact_id: 'f1',
    value,
    status: 'supported',
    fact_type: 'explicit',
    confidence: 1,
    last_checked_at: new Date().toISOString(),
    evidence_ids: [],
    evidence: [],
  };
}

function emptyProfile(): CompanyContextProfileJson {
  return {
    identity: {
      business_name: null,
      legal_name: null,
      alternate_names: [],
      brands: [],
      company_type: null,
      parent_company: null,
      subsidiaries: [],
      founded_year: null,
      primary_domain: null,
      related_domains: [],
      logo_url: null,
    },
    descriptions: { one_line: null, short: null, detailed: null },
    offerings: {
      products: [],
      services: [],
      solutions: [],
      packages: [],
      delivery_model: null,
      pricing_model: null,
      pricing_details: [],
      free_trial: null,
      demo_available: null,
    },
    positioning: {
      value_propositions: [],
      differentiators: [],
      problems_solved: [],
      outcomes_promised: [],
      key_messages: [],
      claims_and_proof: [],
    },
    customers: {
      icp_summary: null,
      company_sizes: [],
      industries: [],
      buyer_roles: [],
      user_roles: [],
      use_cases: [],
      named_customers: [],
      customer_examples: [],
    },
    geography: {
      headquarters: null,
      offices: [],
      service_areas: [],
      countries: [],
      regions: [],
      languages: [],
      remote_or_local_delivery: null,
    },
    go_to_market: {
      business_model: null,
      sales_motion: null,
      self_serve: null,
      primary_ctas: [],
      distribution_channels: [],
      partners: [],
      marketplaces: [],
    },
    credibility: {
      case_studies: [],
      testimonials: [],
      awards: [],
      certifications: [],
      security_and_compliance: [],
      review_profiles: [],
      ratings: [],
    },
    organization: { founders: [], leadership: [], team_members: [], team_size: null, hiring_areas: [], contact_details: [] },
    digital_presence: { social_profiles: [], app_profiles: [], developer_profiles: [], content_channels: [], community_links: [] },
    technology: { integrations: [], platforms_supported: [], api_available: null, technology_signals: [] },
    sources: [],
    conflicts: [],
    missing_fields: [],
    research_metadata: {} as CompanyContextProfileJson['research_metadata'],
  };
}

describe('extractGroundingContext', () => {
  it('flattens scalar and array fields into a flat term list', () => {
    const profile = emptyProfile();
    profile.identity.business_name = fact('Northwind Robotics');
    profile.offerings.services = [fact('warehouse automation'), fact('picking robots')];
    profile.customers.icp_summary = fact('Mid-market logistics operators');

    const terms = extractGroundingContext(profile);
    expect(terms).toContain('Northwind Robotics');
    expect(terms).toContain('warehouse automation');
    expect(terms).toContain('picking robots');
    expect(terms).toContain('Mid-market logistics operators');
  });

  it('yields an empty list for an all-null/empty profile — never fabricates terms', () => {
    expect(extractGroundingContext(emptyProfile())).toEqual([]);
  });

  it('excludes sources/conflicts/missing_fields/research_metadata (profile metadata, not facts)', () => {
    const profile = emptyProfile();
    profile.offerings.services = [fact('real fact')];
    const terms = extractGroundingContext(profile);
    expect(terms).toEqual(['real fact']);
  });
});
