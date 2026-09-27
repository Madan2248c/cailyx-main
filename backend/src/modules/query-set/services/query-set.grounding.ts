/**
 * Flattens a `CompanyContextProfileJson` (Discovery's evidence-bearing
 * schema) into a flat list of searchable grounding terms — the raw material
 * `isRationaleGrounded` checks a bucket's rationale against. No I/O.
 *
 * @module query-set/services/query-set.grounding
 */

import type { CompanyContextProfileJson, FactValue } from '../../discovery/discovery.types.js';
import type { GroundingContext } from '../query-set.types.js';

function scalarValue(field: FactValue | null | undefined): string[] {
  return field?.value ? [field.value] : [];
}

function arrayValues(field: FactValue[] | null | undefined): string[] {
  return (field ?? []).map((f) => f.value).filter(Boolean);
}

/**
 * Every real value in the profile — offerings, positioning, customers,
 * geography, go-to-market, credibility, technology — as one flat string
 * list. Identity/descriptions are included too (a rationale citing the
 * business name or category is still grounded). Sources/conflicts/
 * missing_fields/research_metadata are metadata about the profile, not
 * facts about the business, and are excluded.
 */
export function extractGroundingContext(profile: CompanyContextProfileJson): GroundingContext {
  const terms: string[] = [
    ...scalarValue(profile.identity.business_name),
    ...scalarValue(profile.identity.company_type),
    ...arrayValues(profile.identity.brands),
    ...scalarValue(profile.descriptions.one_line),
    ...scalarValue(profile.descriptions.short),
    ...arrayValues(profile.offerings.products),
    ...arrayValues(profile.offerings.services),
    ...arrayValues(profile.offerings.solutions),
    ...arrayValues(profile.offerings.packages),
    ...scalarValue(profile.offerings.delivery_model),
    ...scalarValue(profile.offerings.pricing_model),
    ...arrayValues(profile.offerings.pricing_details),
    ...arrayValues(profile.positioning.value_propositions),
    ...arrayValues(profile.positioning.differentiators),
    ...arrayValues(profile.positioning.problems_solved),
    ...arrayValues(profile.positioning.outcomes_promised),
    ...arrayValues(profile.positioning.key_messages),
    ...scalarValue(profile.customers.icp_summary),
    ...arrayValues(profile.customers.company_sizes),
    ...arrayValues(profile.customers.industries),
    ...arrayValues(profile.customers.buyer_roles),
    ...arrayValues(profile.customers.user_roles),
    ...arrayValues(profile.customers.use_cases),
    ...arrayValues(profile.customers.named_customers),
    ...scalarValue(profile.geography.headquarters),
    ...arrayValues(profile.geography.offices),
    ...arrayValues(profile.geography.service_areas),
    ...arrayValues(profile.geography.countries),
    ...arrayValues(profile.geography.regions),
    ...scalarValue(profile.go_to_market.business_model),
    ...scalarValue(profile.go_to_market.sales_motion),
    ...arrayValues(profile.go_to_market.distribution_channels),
    ...arrayValues(profile.go_to_market.partners),
    ...arrayValues(profile.go_to_market.marketplaces),
    ...arrayValues(profile.credibility.case_studies),
    ...arrayValues(profile.credibility.awards),
    ...arrayValues(profile.credibility.certifications),
    ...arrayValues(profile.technology.integrations),
    ...arrayValues(profile.technology.platforms_supported),
    ...arrayValues(profile.technology.technology_signals),
  ];
  return terms.filter((t) => t.trim().length > 0);
}
