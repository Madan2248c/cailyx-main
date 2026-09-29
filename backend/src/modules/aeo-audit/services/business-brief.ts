/**
 * Business brief for the stance judge: a short plain-text summary of what the
 * subject company is, sells, and to whom, built from its stored
 * CompanyContextProfile. Without it the judge cannot tell a competitor from a
 * supplier or a merchant ("Amazon" is a rival to a marketplace, but only a
 * partner to a company that resells Amazon gift cards).
 *
 * The profile stores every fact as `{ value, status, evidence, ... }`, so this
 * only reads `value`, skips anything unsupported, and never invents a field:
 * a missing audience stays missing (the judge is told to infer it from the
 * offering instead of being handed a made-up one).
 *
 * @module aeo-audit/services/business-brief
 */

const MAX_ITEMS = 4;
const MAX_ITEM_CHARS = 260;
const MAX_BRIEF_CHARS = 1600;

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A fact's usable text values, whether the field is one fact, a list of facts, or a plain list. */
function values(node: any): string[] {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(values);
  if (typeof node === 'string') return node.trim() ? [node.trim()] : [];
  if (typeof node === 'object') {
    if ('value' in node) {
      if (node.status && node.status !== 'supported') return [];
      return values(node.value);
    }
  }
  return [];
}

const clip = (s: string) => (s.length > MAX_ITEM_CHARS ? `${s.slice(0, MAX_ITEM_CHARS - 1)}…` : s);
const list = (node: any) => [...new Set(values(node))].slice(0, MAX_ITEMS).map(clip);

export function buildBusinessBrief(profileJson: unknown, subjectName: string): string {
  const p = (profileJson ?? {}) as Record<string, any>;
  const lines: string[] = [`Subject: ${subjectName}`];

  const short = list(p.descriptions?.short)[0];
  if (short) lines.push(`What it is: ${short}`);

  const offers = list(p.offerings?.services);
  const products = list(p.offerings?.products);
  if (offers.length + products.length > 0) lines.push(`What it sells or does: ${[...products, ...offers].slice(0, MAX_ITEMS).join(' | ')}`);

  const props = list(p.positioning?.value_propositions);
  if (props.length > 0) lines.push(`Why customers choose it: ${props.join(' | ')}`);

  const icp = list(p.customers?.icp_summary);
  const roles = list(p.customers?.buyer_roles);
  const useCases = list(p.customers?.use_cases);
  const industries = list(p.customers?.industries);
  if (icp.length > 0) lines.push(`Ideal customer: ${icp.join(' | ')}`);
  if (roles.length > 0) lines.push(`Buyers: ${roles.join(', ')}`);
  if (useCases.length > 0) lines.push(`Use cases: ${useCases.join(' | ')}`);
  if (industries.length > 0) lines.push(`Industries served: ${industries.join(', ')}`);

  const where = [...list(p.geography?.headquarters), ...list(p.geography?.countries), ...list(p.geography?.regions)];
  if (where.length > 0) lines.push(`Where it operates: ${[...new Set(where)].join('; ')}`);

  const model = list(p.go_to_market?.business_model)[0];
  if (model) lines.push(`Business model: ${model}`);

  return lines.join('\n').slice(0, MAX_BRIEF_CHARS);
}
