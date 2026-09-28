import { Global, Injectable, Logger, Module } from '@nestjs/common';

/**
 * A tiny in-process "an audit just finished" signal.
 *
 * Audit modules (Technical Audit, Social Activity, AEO Audit) announce a
 * completed run; downstream modules (Remediation) react. It exists so a
 * consumer never has to be imported by the modules it listens to: the
 * Remediation module already imports every audit module to read them, so a
 * direct call back would be a circular dependency.
 *
 * Fire-and-forget by design: a listener's failure is logged and never fails
 * the audit that announced it.
 */
export type AuditModuleName = 'technical-audit' | 'social-activity' | 'aeo-audit';

export interface AuditCompletedEvent {
  module: AuditModuleName;
  projectId: string;
  runId: string;
}

type Listener = (event: AuditCompletedEvent) => unknown;

@Injectable()
export class AuditEvents {
  private readonly logger = new Logger(AuditEvents.name);
  private readonly listeners = new Set<Listener>();

  /** Subscribe; returns an unsubscribe function. */
  onCompleted(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Announce a completed run. Never throws, never blocks the caller. */
  completed(event: AuditCompletedEvent): void {
    for (const listener of this.listeners) {
      void Promise.resolve()
        .then(() => listener(event))
        .catch((err: unknown) => {
          this.logger.warn(`Listener for ${event.module} run ${event.runId} failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
  }
}

@Global()
@Module({ providers: [AuditEvents], exports: [AuditEvents] })
export class AuditEventsModule {}
