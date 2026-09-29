'use client';

import { Component, type ReactNode } from 'react';
import { PortalPage, Tile } from '@/components/portal/layout';
import { EmptyState } from '@/components/portal/states';

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
    // Swallowed intentionally: the fallback UI below reports the failure.
  }

  render(): ReactNode {
    if (this.state.message !== null) {
      return (
        <PortalPage>
          <Tile>
            <EmptyState title={`${this.props.label} is unavailable in preview`} body={this.state.message} />
          </Tile>
        </PortalPage>
      );
    }
    return this.props.children;
  }
}
