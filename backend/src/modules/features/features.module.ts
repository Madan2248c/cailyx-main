/**
 * Features module — per-client on/off switches for portal features, so an
 * admin can turn a section off for one client without a deploy.
 */

import { Module } from '@nestjs/common';
import { FeaturesController } from './controllers/features.controller.js';
import { FeaturesService } from './services/features.service.js';

@Module({
  controllers: [FeaturesController],
  providers: [FeaturesService],
  exports: [FeaturesService],
})
export class FeaturesModule {}
