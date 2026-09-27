/**
 * Google module — OAuth connect + live Search Console / Analytics reads.
 * Leaf dependency (nothing imports it yet except the Organic frontend via
 * HTTP). See docs/analysis/google.md.
 *
 * @module google/google.module
 */

import { Module } from '@nestjs/common';
import { GoogleCallbackController, GoogleController, GoogleProjectController } from './controllers/google.controller.js';
import { GoogleService } from './google.service.js';

@Module({
  controllers: [GoogleController, GoogleProjectController, GoogleCallbackController],
  providers: [GoogleService],
  exports: [GoogleService],
})
export class GoogleModule {}
