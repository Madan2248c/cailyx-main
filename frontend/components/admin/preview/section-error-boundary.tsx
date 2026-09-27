'use client';

import { Component, type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface Props {
  label: string;
  children: ReactNode;
}

interface State {
  message: string | null;
}

/**
 * Per-section boundary for admin preview tabs: a 403 (or any render
 * failure) in one tab renders as an unavailable section instead of
 * crashing the whole preview page.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(err: unknown): State {
    return { message: err instanceof Error ? err.message : 'Something went wrong' };
  }

  componentDidCatch(): void {
    // Swallowed intentionally — the fallback UI below reports the failure.
  }

  render(): ReactNode {
    if (this.state.message !== null) {
      return (
        <Card>
          <CardContent className="flex flex-col gap-1 pt-6">
            <p className="text-sm font-medium">{this.props.label} is unavailable in preview</p>
            <p className="text-sm text-muted-foreground">{this.state.message}</p>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}
