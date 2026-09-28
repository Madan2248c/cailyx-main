import Link from 'next/link';
import { OrbitArt } from '@/components/portal/states';

export const metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <main className="theme-graphite flex min-h-screen flex-1 flex-col items-center justify-center gap-3 bg-canvas px-4 text-center">
      <OrbitArt className="h-24 w-32" />
      <h1 className="text-2xl font-semibold">We couldn&apos;t find that page</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The link may be old, or the page may have moved. Head back to your projects and pick up from there.
      </p>
      <Link
        href="/client"
        className="mt-2 inline-flex h-9 items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        Back to your projects
      </Link>
    </main>
  );
}
