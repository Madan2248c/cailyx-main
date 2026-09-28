/**
 * Robots.txt check — is the site's robots.txt blocking AI crawlers?
 *
 * Ported from the old repo's `technical-audit.service.ts` `checkRobotsTxt` /
 * `analyzeRobotsTxt`, with one deliberate correction: the old code's
 * Allow/Disallow precedence was **exact-string match**, not the longest-match
 * precedence its own docstring claimed, and it treated an empty `Disallow:`
 * value as "block everything" — the opposite of the spec (an empty value
 * restricts nothing). Both are real defects, not tuning choices.
 *
 * Rather than port those two bugs, this check determines each bot's
 * allow/disallow verdict through the already-shipped, already-tested
 * `RobotsService` (`fetcher/services/robots.service.ts`) — a spec-correct
 * longest-match parser with the right empty-value handling, used by every
 * crawler in this codebase. `parseRobotsTxt`/`selectGroup` are exported from
 * that service specifically so this check can build its per-bot `paths`
 * display list from the identical parse, rather than maintaining a second
 * parser that could silently disagree with the first.
 *
 * @module technical-audit/services/checks/robots
 */

import { Injectable } from '@nestjs/common';
import { ALL_BOTS } from '../../../fetcher/fetcher.constants.js';
import { FetcherService } from '../../../fetcher/fetcher.service.js';
import { parseRobotsTxt, RobotsService, selectGroup, type RobotsGroup } from '../../../fetcher/services/robots.service.js';
import type { AuditContext } from '../audit-context.js';
import type { AuditFinding, BlockLayer, RobotsAnalysis, RobotsRule } from '../../technical-audit.types.js';

const RAW_CONTENT_LIMIT = 2000;
const BOT_CATEGORY = new Map(ALL_BOTS.map((b) => [b.name, b.category]));

@Injectable()
export class RobotsCheck {
  constructor(
    private readonly fetcher: FetcherService,
    private readonly robots: RobotsService,
  ) {}

  async run(ctx: AuditContext): Promise<AuditFinding> {
    const robotsUrl = this.robotsUrl(ctx.targetUrl);
    const res = await this.fetcher.fetch({ url: robotsUrl, cacheTtlSeconds: 86400 }, 'technical-audit', ctx.runId);

    const missingRobotsTxt = res.status === 404 || res.status === 0;
    const rawContent = res.body ?? '';
    const { groups } = parseRobotsTxt(rawContent);

    const rules: RobotsRule[] = missingRobotsTxt
      ? []
      : await Promise.all(ALL_BOTS.map((bot) => this.buildRule(groups, bot.name, ctx.targetUrl)));

    const analysis: RobotsAnalysis = {
      robotsTxtFound: !missingRobotsTxt,
      statusCode: res.status,
      rules,
      missingRobotsTxt,
      rawContent: rawContent.slice(0, RAW_CONTENT_LIMIT),
    };

    // Only a root-level block counts toward the headline — a bot disallowed
    // from one path shows up in `rules` but doesn't drive severity/fix text.
    const blockedBots = rules.filter((r) => r.disallowed && (r.paths.includes('/') || r.paths.includes('/*'))).map((r) => r.botName);
    const byCategory = (category: string) => blockedBots.filter((name) => BOT_CATEGORY.get(name) === category);
    const blockedSearch = byCategory('search');
    const blockedLiveFetch = byCategory('live-fetch');
    const blockedTraining = byCategory('training');

    const status = missingRobotsTxt || blockedBots.length > 0 ? 'fail' : 'pass';
    const severity = blockedSearch.length > 0 ? 'high' : blockedBots.length > 0 ? 'medium' : 'low';

    return {
      type: 'robots',
      status,
      severity,
      confidence: 'confirmed',
      recommendedFix: this.recommendedFix(missingRobotsTxt, blockedSearch, blockedLiveFetch, blockedTraining),
      detail: {
        robotsUrl,
        statusCode: res.status,
        layer: 'robots.txt' satisfies BlockLayer,
        robotsTxtFound: !missingRobotsTxt,
        blockedBots,
        blockedSearch,
        blockedLiveFetch,
        blockedTraining,
        rules,
        rawContent: analysis.rawContent,
      },
    };
  }

  /** One bot's verdict, sourced from `RobotsService`'s spec-correct matcher rather than a second parser. */
  private async buildRule(groups: RobotsGroup[], botName: string, targetUrl: string): Promise<RobotsRule> {
    const bot = ALL_BOTS.find((b) => b.name === botName)!;
    const disallowed = !(await this.robots.isAllowed(this.rootUrl(targetUrl), bot.userAgent));

    // Display-only: which raw Disallow/Allow patterns named this bot's
    // matching group, for the finding's detail. Not itself the source of
    // truth for `disallowed` — that comes from `RobotsService.isAllowed`
    // above, which already applies the correct precedence.
    const group = selectGroup(groups, bot.userAgent);
    const paths = group ? (disallowed ? group.disallow.filter(Boolean) : group.allow.filter(Boolean)) : [];

    return { botName, disallowed, paths: paths.length > 0 ? paths : disallowed ? ['/'] : [], layer: 'robots.txt' };
  }

  /**
   * Priority order (first match wins), ported from the old code: missing
   * robots.txt → blocked search crawlers → blocked live-fetch agents →
   * blocked training crawlers → nothing blocked.
   */
  private recommendedFix(
    missingRobotsTxt: boolean,
    blockedSearch: string[],
    blockedLiveFetch: string[],
    blockedTraining: string[],
  ): string {
    if (missingRobotsTxt) {
      return 'No robots.txt found. Create one with explicit Allow rules for AI crawlers to ensure they can access the site.';
    }
    if (blockedSearch.length > 0) {
      return `Search/index crawlers are BLOCKED: ${blockedSearch.join(', ')}. These bots feed AI answer engines, so blocking them removes the site from AI answers. Remove the Disallow rules for these bots in robots.txt.`;
    }
    if (blockedLiveFetch.length > 0) {
      return `Live-fetch agents are blocked: ${blockedLiveFetch.join(', ')}. Users cannot ask AI assistants to "summarize this page". Consider allowing these bots.`;
    }
    if (blockedTraining.length > 0) {
      return `Training crawlers are blocked: ${blockedTraining.join(', ')}. The site will not be included in model training data. This is usually a deliberate choice, so confirm it is intentional.`;
    }
    return 'No AI bot blocks detected in robots.txt. All AI crawlers are allowed.';
  }

  private robotsUrl(targetUrl: string): string {
    try {
      const u = new URL(targetUrl);
      return `${u.protocol}//${u.host}/robots.txt`;
    } catch {
      return `${targetUrl.replace(/\/$/, '')}/robots.txt`;
    }
  }

  private rootUrl(targetUrl: string): string {
    try {
      const u = new URL(targetUrl);
      return `${u.protocol}//${u.host}/`;
    } catch {
      return targetUrl;
    }
  }
}
