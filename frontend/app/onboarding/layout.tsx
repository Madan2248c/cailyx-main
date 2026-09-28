import type { ReactNode } from 'react';

/** Onboarding is client-facing, so it shares the client portal's Graphite theme scope. */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <div className="theme-graphite flex min-h-screen flex-1 flex-col bg-canvas">{children}</div>;
}
