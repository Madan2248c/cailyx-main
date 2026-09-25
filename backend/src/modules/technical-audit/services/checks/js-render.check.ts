/**
 * JS-render dependency check — does the page lose meaningful content when
 * JavaScript does not execute?
 *
 * AI crawlers (GPTBot, ClaudeBot, and most others) do not execute JS. A page
 * that only renders its real content client-side is invisible to them even
 * when robots.txt and the CDN allow every bot through.
 *
 * Ported verbatim from the old repo's `technical-audit.service.ts`
 * `checkJsRenderDependency`: two renders of the same page, one with JS
 * enabled and one with it disabled, compared by visible-text length.
 *
 * @module technical-audit/services/checks/js-render
 */

import { Injectable } from '@nestjs/common';
import { FetcherService } from '../../../fetcher/fetcher.service.js';
import type { AuditContext } from '../audit-context.js';
import type { AuditFinding, JsRenderAnalysis } from '../../technical-audit.types.js';

const RENDER_TIMEOUT_MS = 30_000;
/** Above this % content loss, the page is JS-dependent outright — `severity: high`. */
const JS_DEPENDENCY_PERCENT = 70;
/** Above this % content loss but below the dependency line, the check still fails at `severity: medium`. */
const JS_CONTENT_LOSS_FAIL_PERCENT = 30;
/** How much of each render's text is kept in the finding detail. */
const TEXT_PREVIEW_LENGTH = 500;

@Injectable()
export class JsRenderCheck {
  constructor(private readonly fetcher: FetcherService) {}

  async run(ctx: AuditContext): Promise<AuditFinding> {
    const withJs = await this.fetcher.render({ url: ctx.targetUrl, jsDisabled: false, timeout: RENDER_TIMEOUT_MS }, 'technical-audit', ctx.runId);
    const withoutJs = await this.fetcher.render({ url: ctx.targetUrl, jsDisabled: true, timeout: RENDER_TIMEOUT_MS }, 'technical-audit', ctx.runId);

    const textLengthWithJs = withJs.text.length;
    const textLengthWithoutJs = withoutJs.text.length;
    // 0% loss when the JS render itself came back empty — an empty baseline
    // isn't "100% lost", it's "nothing to lose from" (and dividing by zero
    // would otherwise turn a broken render into a false JS-dependency flag).
    const contentLossPercent = textLengthWithJs > 0 ? Math.round((1 - textLengthWithoutJs / textLengthWithJs) * 100) : 0;

    const isJsDependent = contentLossPercent > JS_DEPENDENCY_PERCENT;
    const failsOnLoss = contentLossPercent > JS_CONTENT_LOSS_FAIL_PERCENT;

    const analysis: JsRenderAnalysis = {
      serverRenderedText: withoutJs.text.slice(0, TEXT_PREVIEW_LENGTH),
      jsRenderedText: withJs.text.slice(0, TEXT_PREVIEW_LENGTH),
      textLengthWithoutJs,
      textLengthWithJs,
      isJsDependent,
      contentLossPercent,
      titleWithoutJs: withoutJs.title,
      titleWithJs: withJs.title,
    };

    return {
      type: 'js-render',
      status: isJsDependent || failsOnLoss ? 'fail' : 'pass',
      severity: isJsDependent ? 'high' : failsOnLoss ? 'medium' : 'low',
      confidence: 'confirmed',
      recommendedFix: this.recommendedFix(isJsDependent, failsOnLoss, contentLossPercent),
      detail: { ...analysis },
    };
  }

  private recommendedFix(isJsDependent: boolean, failsOnLoss: boolean, contentLossPercent: number): string {
    if (isJsDependent) {
      return `The page loses ${contentLossPercent}% of its content without JavaScript. AI crawlers like GPTBot and ClaudeBot do not execute JS, meaning they cannot read the page content. Implement server-side rendering (SSR) or static generation (SSG) so the HTML contains the content without requiring JS execution.`;
    }
    if (failsOnLoss) {
      return `The page loses ${contentLossPercent}% of its content without JavaScript. Some AI crawlers may miss important content. Consider server-side rendering for critical content.`;
    }
    return 'The page is well server-rendered. Content is accessible to non-JS AI crawlers.';
  }
}
