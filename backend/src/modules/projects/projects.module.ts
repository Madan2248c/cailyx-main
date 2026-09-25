import { Module } from '@nestjs/common';
import { ProjectsController } from './controllers/projects.controller.js';
import { ProjectsService } from './services/projects.service.js';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
