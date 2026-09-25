import { Module } from '@nestjs/common';
import { DiscoveryModule } from '../discovery/discovery.module.js';
import { ProjectsController } from './controllers/projects.controller.js';
import { ProjectsService } from './services/projects.service.js';

/**
 * Projects depends on Discovery (creating a project starts a discovery run),
 * and never the other way round — Discovery reads projects through Prisma
 * rather than through this module, which keeps the dependency acyclic.
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
