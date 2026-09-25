/**
 * Schema.org / structured-data check — is there JSON-LD, and is it complete
 * enough for an AI assistant to resolve the entity?
 *
 * Ported verbatim from the old repo's `technical-audit.service.ts`
 * `checkSchema` — the field checklist, the substring-match Organization/
 * Person detection, the 10-URL `sameAs` verification cap, and the
 * status/severity thresholds are all tuned/deliberate, not arbitrary.
 *
 * @module technical-audit/services/checks/schema
 */

import { Injectable } from '@nestjs/common';
import { FetcherService } from '../../../fetcher/fetcher.service.js';
import type { SchemaBlock } from '../../../fetcher/fetcher.types.js';
import type { AuditContext } from '../audit-context.js';
import type { AuditFinding, SchemaAnalysis } from '../../technical-audit.types.js';

/** Fields checked on the first Organization/LocalBusiness schema found — a field is missing if its value is falsy. */
const ORG_REQUIRED_FIELDS = ['name', 'url', 'logo', 'sameAs', 'description'] as const;
/** More than this many missing fields fails the check even though a schema exists. */
const MAX_TOLERATED_MISSING_FIELDS = 3;
/** Cost control — verifying a `sameAs` URL is a real fetch, so only the first N are checked. */
const MAX_SAME_AS_VERIFIED = 10;

@Injectable()
export class SchemaCheck {
  constructor(private readonly fetcher: FetcherService) {}

  async run(ctx: AuditContext): Promise<AuditFinding> {
    const schemaResult = await this.fetcher.fetchSchema(ctx.targetUrl, 'technical-audit', ctx.runId);
    const schemas = schemaResult.schemas;
    const schemaTypes = schemas.map((s) => s.type);

    // Substring match, deliberate — catches `GovernmentOrganization`,
    // `MedicalOrganization`, etc., not just an exact `Organization` type.
    const hasOrganization = schemaTypes.some((t) => t.includes('Organization') || t.includes('LocalBusiness'));
    const hasPerson = schemaTypes.some((t) => t.includes('Person'));

    const sameAsUrls: string[] = [];
    for (const schema of schemas) {
      const sameAs = schema.fields['sameAs'];
      if (Array.isArray(sameAs)) sameAsUrls.push(...sameAs.filter((u): u is string => typeof u === 'string'));
      else if (typeof sameAs === 'string') sameAsUrls.push(sameAs);
    }

    // Only checked against the FIRST matching schema — a page with several
    // Organization-ish blocks is judged by whichever one schema.org parsing
    // returned first, matching the old code exactly.
    const missingFields: string[] = [];
    if (hasOrganization) {
      const orgSchema = schemas.find((s) => s.type.includes('Organization') || s.type.includes('LocalBusiness'));
      for (const field of ORG_REQUIRED_FIELDS) {
        if (!orgSchema?.fields[field]) missingFields.push(field);
      }
    }

    const sameAsVerification = await this.verifySameAs(sameAsUrls, schemas, ctx);

    const schemasFound = schemas.length > 0;
    const status = !schemasFound || missingFields.length > MAX_TOLERATED_MISSING_FIELDS ? 'fail' : 'pass';

    const analysis: SchemaAnalysis = {
      schemasFound,
      schemaTypes,
      hasOrganization,
      hasPerson,
      sameAsCount: sameAsUrls.length,
      sameAsUrls,
      missingFields,
      rawSchemas: schemas,
      sameAsVerification,
    };

    return {
      type: 'schema',
      status,
      // Severity never escalates past 'medium' for a missing-fields-only
      // failure — only "no schema at all" is worth flagging above 'low'.
      severity: !schemasFound ? 'medium' : 'low',
      confidence: 'confirmed',
      recommendedFix: this.recommendedFix(schemasFound, missingFields, schemaTypes, sameAsUrls),
      detail: { ...analysis },
    };
  }

  /** First 10 `sameAs` URLs only — verification is a real fetch per URL, so this bounds cost. */
  private async verifySameAs(
    sameAsUrls: string[],
    schemas: SchemaBlock[],
    ctx: AuditContext,
  ): Promise<Array<{ url: string; resolves: boolean; identityMatch?: boolean }>> {
    // Whichever schema happens to carry a truthy `name` first — not
    // necessarily the Organization schema identified above. Ported as-is.
    const expectedName = schemas.find((s) => s.fields['name'])?.fields['name'];
    return Promise.all(
      sameAsUrls.slice(0, MAX_SAME_AS_VERIFIED).map(async (url) => {
        try {
          const verification = await this.fetcher.verifyUrl(
            { url, expectedName: typeof expectedName === 'string' ? expectedName : undefined },
            'technical-audit',
            ctx.runId,
          );
          return { url, resolves: verification.resolves, identityMatch: verification.identityMatch };
        } catch {
          return { url, resolves: false, identityMatch: false };
        }
      }),
    );
  }

  private recommendedFix(schemasFound: boolean, missingFields: string[], schemaTypes: string[], sameAsUrls: string[]): string {
    if (!schemasFound) {
      return 'No JSON-LD structured data found. Add Organization schema with name, url, logo, description, and sameAs links to help AI assistants understand the entity.';
    }
    if (missingFields.length > 0) {
      return `Schema found but missing recommended fields: ${missingFields.join(', ')}. Add these to improve entity recognition by AI assistants.`;
    }
    return `Schema found: ${schemaTypes.join(', ')}. ${sameAsUrls.length} sameAs links present. Structured data looks complete.`;
  }
}
