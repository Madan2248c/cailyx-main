import { Module } from '@nestjs/common';
import { Day1PipelineModule } from '../day1-pipeline/day1-pipeline.module.js';
import { ProjectsController } from './controllers/projects.controller.js';
import { ProjectsService } from './services/projects.service.js';

/**
 * Projects depends on Day1Pipeline (creating a project starts the Day-1
 * pipeline, whose first stage is discovery), and never the other way
 * round — the pipeline reads its key off its own row, which keeps the
 * dependency acyclic.
 */
@Module({
  imports: [Day1PipelineModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
