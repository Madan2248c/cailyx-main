import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { GlobalJwtModule } from './common/jwt/global-jwt.module.js';
import configuration from './config/configuration.js';
import { validationSchema } from './config/validation.schema.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AeoAuditModule } from './modules/aeo-audit/aeo-audit.module.js';
import { MeasurementModule } from './modules/measurement/measurement.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { QuerySetModule } from './modules/query-set/query-set.module.js';
import { SocialActivityModule } from './modules/social-activity/social-activity.module.js';
import { TechnicalAuditModule } from './modules/technical-audit/technical-audit.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validationSchema }),
    // Module job queues (Discovery, Technical Audit, Social Activity). They
    // share the same Redis instance the fetcher module's cache/rate-limiter
    // use — one Redis config, independent consumers of it. See
    // docs/analysis/discovery.md.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') },
      }),
    }),
    PrismaModule,
    GlobalJwtModule,
    AuthModule,
    ProjectsModule,
    TechnicalAuditModule,
    SocialActivityModule,
    QuerySetModule,
    MeasurementModule,
    AeoAuditModule,
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'backend',
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
