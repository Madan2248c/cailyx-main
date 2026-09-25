import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FetcherService } from '../../../fetcher/fetcher.service.js';
import type { AuditContext } from '../audit-context.js';
import { JsRenderCheck } from './js-render.check.js';

const CTX: AuditContext = { runId: 'run-1', project: { id: 'p1', name: 'Acme', domain: 'acme.com' }, targetUrl: 'https://acme.com' };

function renderResult(text: string, title = '') {
  return { url: CTX.targetUrl, finalUrl: CTX.targetUrl, html: `<html>${text}</html>`, text, title, timing: { latencyMs: 1 }, jsDisabled: false };
}

describe('JsRenderCheck', () => {
  let check: JsRenderCheck;
  let fetcher: { render: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    fetcher = { render: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [JsRenderCheck, { provide: FetcherService, useValue: fetcher }],
    }).compile();
    check = moduleRef.get(JsRenderCheck);
  });

  it('passes when JS-off text is the same length as JS-on', async () => {
    const text = 'a'.repeat(1000);
    fetcher.render.mockResolvedValueOnce(renderResult(text)).mockResolvedValueOnce(renderResult(text));

    const finding = await check.run(CTX);

    expect(finding.status).toBe('pass');
    expect(finding.severity).toBe('low');
    expect((finding.detail as { contentLossPercent: number }).contentLossPercent).toBe(0);
  });

  it('flags high severity when content loss exceeds the dependency threshold', async () => {
    fetcher.render.mockResolvedValueOnce(renderResult('x'.repeat(1000))).mockResolvedValueOnce(renderResult('x'.repeat(200))); // 80% loss

    const finding = await check.run(CTX);

    expect(finding.status).toBe('fail');
    expect(finding.severity).toBe('high');
    expect((finding.detail as { isJsDependent: boolean }).isJsDependent).toBe(true);
    expect(finding.recommendedFix).toContain('GPTBot');
  });

  it('flags medium severity in the 30-70% band without calling it JS-dependent', async () => {
    fetcher.render.mockResolvedValueOnce(renderResult('x'.repeat(1000))).mockResolvedValueOnce(renderResult('x'.repeat(500))); // 50% loss

    const finding = await check.run(CTX);

    expect(finding.status).toBe('fail');
    expect(finding.severity).toBe('medium');
    expect((finding.detail as { isJsDependent: boolean }).isJsDependent).toBe(false);
  });

  it('reports 0% loss rather than dividing by zero when the JS render is empty', async () => {
    fetcher.render.mockResolvedValueOnce(renderResult('')).mockResolvedValueOnce(renderResult(''));

    const finding = await check.run(CTX);

    expect((finding.detail as { contentLossPercent: number }).contentLossPercent).toBe(0);
    expect(finding.status).toBe('pass');
  });

  it('truncates the preview text in the detail to 500 characters', async () => {
    const long = 'y'.repeat(2000);
    fetcher.render.mockResolvedValueOnce(renderResult(long)).mockResolvedValueOnce(renderResult(long));

    const finding = await check.run(CTX);

    const detail = finding.detail as { jsRenderedText: string; serverRenderedText: string };
    expect(detail.jsRenderedText.length).toBe(500);
    expect(detail.serverRenderedText.length).toBe(500);
  });

  it('renders with jsDisabled true and false, in that order for the finding but requesting both', async () => {
    fetcher.render.mockResolvedValueOnce(renderResult('a')).mockResolvedValueOnce(renderResult('a'));

    await check.run(CTX);

    expect(fetcher.render).toHaveBeenCalledWith(
      expect.objectContaining({ jsDisabled: false, timeout: 30000 }),
      'technical-audit',
      CTX.runId,
    );
    expect(fetcher.render).toHaveBeenCalledWith(
      expect.objectContaining({ jsDisabled: true, timeout: 30000 }),
      'technical-audit',
      CTX.runId,
    );
  });
});
