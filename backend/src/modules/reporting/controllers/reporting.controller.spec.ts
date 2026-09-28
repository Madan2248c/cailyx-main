import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { BrowserClientService } from '../../fetcher/clients/browser-client.service.js';
import { ReportingService } from '../services/reporting.service.js';
import { ClientPortalReportController, ReportController, ReportsController } from './reporting.controller.js';

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), send: vi.fn(), setHeader: vi.fn() };
}

describe('ReportsController / ReportController', () => {
  let reporting: { generate: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; getOne: ReturnType<typeof vi.fn>; review: ReturnType<typeof vi.fn>; approve: ReturnType<typeof vi.fn>; withdraw: ReturnType<typeof vi.fn>; printDocument: ReturnType<typeof vi.fn> };
  let browser: { printPdf: ReturnType<typeof vi.fn> };
  let reportsController: ReportsController;
  let reportController: ReportController;

  beforeEach(async () => {
    reporting = {
      generate: vi.fn(), list: vi.fn(), getOne: vi.fn(), review: vi.fn(), approve: vi.fn(), withdraw: vi.fn(),
      printDocument: vi.fn().mockResolvedValue({ html: '<html>print</html>', fileName: 'acme-day1-report-2026-09-22.pdf' }),
    };
    browser = { printPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4')) };
    const moduleRef = await Test.createTestingModule({
      controllers: [ReportsController, ReportController],
      providers: [{ provide: ReportingService, useValue: reporting }, { provide: BrowserClientService, useValue: browser }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    reportsController = moduleRef.get(ReportsController);
    reportController = moduleRef.get(ReportController);
  });

  it('generate and list pass scope through', async () => {
    await reportsController.generate('client-1', 'project-1', { kind: 'DAY1' });
    expect(reporting.generate).toHaveBeenCalledWith('client-1', 'project-1', 'DAY1');
    await reportsController.list('client-1', 'project-1', 'MONTHLY');
    expect(reporting.list).toHaveBeenCalledWith('client-1', 'project-1', 'MONTHLY');
  });

  it('review, approve, and withdraw pass scope through', async () => {
    await reportController.review('client-1', 'report-1');
    expect(reporting.review).toHaveBeenCalledWith('client-1', 'report-1');
    await reportController.approve('client-1', 'report-1', { approved: true });
    expect(reporting.approve).toHaveBeenCalledWith('client-1', 'report-1', { approved: true });
    await reportController.withdraw('client-1', 'report-1');
    expect(reporting.withdraw).toHaveBeenCalledWith('client-1', 'report-1');
  });

  it('pdf prints the scoped print document and sends it as an attachment', async () => {
    const res = fakeRes();
    await reportController.pdf('client-1', 'report-1', undefined, res as never);
    expect(reporting.printDocument).toHaveBeenCalledWith('client-1', 'report-1');
    expect(browser.printPdf).toHaveBeenCalledWith('<html>print</html>');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="acme-day1-report-2026-09-22.pdf"');
  });

  it('pdf?format=html returns the print HTML without launching the printer', async () => {
    const res = fakeRes();
    await reportController.pdf('client-1', 'report-1', 'html', res as never);
    expect(browser.printPdf).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith('<html>print</html>');
  });
});

describe('ClientPortalReportController', () => {
  let reporting: { getBySlug: ReturnType<typeof vi.fn>; renderHtml: ReturnType<typeof vi.fn> };
  let controller: ClientPortalReportController;

  beforeEach(async () => {
    reporting = { getBySlug: vi.fn(), renderHtml: vi.fn().mockResolvedValue('<html>ok</html>') };
    const moduleRef = await Test.createTestingModule({
      controllers: [ClientPortalReportController],
      providers: [{ provide: ReportingService, useValue: reporting }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(ClientPortalReportController);
  });

  it('scopes the lookup to the caller\'s own clientId from the JWT, not a wildcard', async () => {
    reporting.getBySlug.mockResolvedValue({ content: {} });
    const res = fakeRes();

    await controller.getBySlug('acme-day1-abcd1234', { sub: 'user-1', role: 'CLIENT_POC', clientId: 'client-1' } as never, res as never);

    expect(reporting.getBySlug).toHaveBeenCalledWith('client-1', 'acme-day1-abcd1234');
    expect(res.send).toHaveBeenCalledWith('<html>ok</html>');
  });

  it('passes a null clientId through unscoped for ADMIN', async () => {
    reporting.getBySlug.mockResolvedValue({ content: {} });
    const res = fakeRes();

    await controller.getBySlug('acme-day1-abcd1234', { sub: 'admin-1', role: 'ADMIN', clientId: null } as never, res as never);

    expect(reporting.getBySlug).toHaveBeenCalledWith(null, 'acme-day1-abcd1234');
  });

  it('404s when the report is not found for that caller', async () => {
    reporting.getBySlug.mockRejectedValue(new Error('not found'));
    const res = fakeRes();

    await controller.getBySlug('missing-slug', { sub: 'user-1', role: 'CLIENT_POC', clientId: 'client-1' } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
