import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuditEventsModule } from './common/events/audit-events.js';
import { GlobalJwtModule } from './common/jwt/global-jwt.module.js';
import configuration from './config/configuration.js';
import { validationSchema } from './config/validation.schema.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AeoAuditModule } from './modules/aeo-audit/aeo-audit.module.js';
import { CompetitorsModule } from './modules/competitors/competitors.module.js';
import { EmailModule } from './modules/email/email.module.js';
import { Day1PipelineModule } from './modules/day1-pipeline/day1-pipeline.module.js';
import { DataforseoModule } from './modules/dataforseo/dataforseo.module.js';
import { GoogleModule } from './modules/google/google.module.js';
import { GapAnalysisModule } from './modules/gap-analysis/gap-analysis.module.js';
import { MeasurementModule } from './modules/measurement/measurement.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { QuerySetModule } from './modules/query-set/query-set.module.js';
import { RemediationModule } from './modules/remediation/remediation.module.js';
import { ReportingModule } from './modules/reporting/reporting.module.js';
import { SocialActivityModule } from './modules/social-activity/social-activity.module.js';
import { TechnicalAuditModule } from './modules/technical-audit/technical-audit.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

// Built before `observeEnabled` is read: forRoot loads .env into process.env synchronously.
const configModule = ConfigModule.forRoot({ isGlobal: true, load: [configuration], validationSchema });

/** Telemetry runs only with real keys; no placeholder credentials ship. */
export const observeEnabled = Boolean(process.env.OBSERVE_APP_KEY && process.env.OBSERVE_APP_SECRET);

@Module({
  imports: [
    configModule,
    // Module job queues (Discovery, Technical Audit, Social Activity). They
    // share the same Redis instance the fetcher module's cache/rate-limiter
    // use — one Redis config, independent consumers of it. See
    // docs/analysis/discovery.md.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // family 0 = dual-stack lookup; Railway's private network can be IPv6-only.
        connection: { url: config.get<string>('REDIS_URL'), family: 0 },
      }),
    }),
    PrismaModule,
    GlobalJwtModule,
    AuditEventsModule,
    AuthModule,
    ProjectsModule,
    TechnicalAuditModule,
    SocialActivityModule,
    QuerySetModule,
    MeasurementModule,
    AeoAuditModule,
    GapAnalysisModule,
    CompetitorsModule,
    ReportingModule,
    EmailModule,
    Day1PipelineModule,
    GoogleModule,
    DataforseoModule,
    RemediationModule,
    // Distributed tracing, correlated logs, request/job metrics and error
    // telemetry (https://observe.nestjs.com). Set OBSERVE_APP_KEY and
    // OBSERVE_APP_SECRET to turn it on.
    ...(observeEnabled
      ? [
          ObserveModule.forRoot({
            appKey: process.env.OBSERVE_APP_KEY as string,
            appSecret: process.env.OBSERVE_APP_SECRET as string,
            serviceId: process.env.OBSERVE_SERVICE_ID ?? 'cailyx-backend',
          }),
        ]
      : []),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
