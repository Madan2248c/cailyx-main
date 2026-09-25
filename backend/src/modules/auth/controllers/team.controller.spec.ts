import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { TeamService } from '../services/team.service.js';
import { TeamController } from './team.controller.js';

describe('TeamController', () => {
  let controller: TeamController;
  let teamService: Record<string, ReturnType<typeof vi.fn>>;

  const admin = { sub: 'admin-1', role: Role.ADMIN, clientId: null };
  const poc = { sub: 'poc-1', role: Role.CLIENT_POC, clientId: 'client-1' };

  beforeEach(async () => {
    teamService = {
      listClients: vi.fn().mockResolvedValue(['client-list']),
      listMembers: vi.fn().mockResolvedValue(['member-list']),
      createClientWithPoc: vi.fn().mockResolvedValue({ client: {}, poc: {} }),
      suspendClient: vi.fn().mockResolvedValue({ success: true }),
      activateClient: vi.fn().mockResolvedValue({ success: true }),
      updateSeatLimit: vi.fn().mockResolvedValue({ success: true }),
      inviteTeamMember: vi.fn().mockResolvedValue({ id: 'member-1' }),
      resendInvite: vi.fn().mockResolvedValue({ success: true }),
      disableUser: vi.fn().mockResolvedValue({ success: true }),
      enableUser: vi.fn().mockResolvedValue({ success: true }),
    };

    // TestingModule.compile() eagerly instantiates the guards named in the
    // controller's class-level @UseGuards(...), so their own dependencies
    // (JwtService, Reflector, PrismaService) would otherwise need wiring up
    // here too. overrideGuard() is the documented way around that — these
    // tests call controller methods directly, never through Nest's HTTP
    // pipeline, so the guards' own logic isn't what's under test here.
    const moduleRef = await Test.createTestingModule({
      controllers: [TeamController],
      providers: [{ provide: TeamService, useValue: teamService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(TeamController);
  });

  it('listClients delegates with no arguments', async () => {
    const result = await controller.listClients();
    expect(teamService.listClients).toHaveBeenCalledWith();
    expect(result).toEqual(['client-list']);
  });

  it('listMembers delegates with the current user', async () => {
    await controller.listMembers(poc);
    expect(teamService.listMembers).toHaveBeenCalledWith(poc);
  });

  it('createClient delegates the DTO and caller id', async () => {
    const dto = { name: 'Acme', pocEmail: 'poc@acme.com' };
    await controller.createClient(dto, admin);
    expect(teamService.createClientWithPoc).toHaveBeenCalledWith(dto, admin.sub);
  });

  it('suspendClient / activateClient delegate the client id', async () => {
    await controller.suspendClient('client-1');
    expect(teamService.suspendClient).toHaveBeenCalledWith('client-1');

    await controller.activateClient('client-1');
    expect(teamService.activateClient).toHaveBeenCalledWith('client-1');
  });

  it('updateSeatLimit delegates the client id and DTO', async () => {
    const dto = { seatLimit: 10 };
    await controller.updateSeatLimit('client-1', dto);
    expect(teamService.updateSeatLimit).toHaveBeenCalledWith('client-1', dto);
  });

  it('invite delegates the DTO and caller', async () => {
    const dto = { email: 'member@acme.com' };
    await controller.invite(dto, poc);
    expect(teamService.inviteTeamMember).toHaveBeenCalledWith(dto, poc);
  });

  it('resendInvite / disableUser / enableUser delegate the target id and caller', async () => {
    await controller.resendInvite('target-1', poc);
    expect(teamService.resendInvite).toHaveBeenCalledWith('target-1', poc);

    await controller.disableUser('target-1', poc);
    expect(teamService.disableUser).toHaveBeenCalledWith('target-1', poc);

    await controller.enableUser('target-1', poc);
    expect(teamService.enableUser).toHaveBeenCalledWith('target-1', poc);
  });
});
