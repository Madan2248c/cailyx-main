import Link from 'next/link';
import { AcceptInviteForm } from '@/components/auth/accept-invite-form';
import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { backendFetch } from '@/lib/backend-client';

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <AuthCard title="Invalid invite link">
        <p className="text-sm text-muted-foreground">
          This link is missing its token. Ask whoever invited you to resend it.
        </p>
      </AuthCard>
    );
  }

  // Checked server-side, before rendering the form — otherwise an
  // already-used or expired link would still show the "set your password"
  // form right up until submission, which reads as if the link still works.
  const { valid } = await backendFetch<{ valid: boolean }>('/auth/accept-invite/validate', {
    method: 'POST',
    body: JSON.stringify({ token }),
  }).catch(() => ({ valid: false }));

  if (!valid) {
    return (
      <AuthCard title="This invite link has expired">
        <p className="text-sm text-muted-foreground">
          It&apos;s either already been used or is no longer valid. Ask whoever invited you to send a
          new one, or sign in if you&apos;ve already set up your account.
        </p>
        <Button className="mt-4 w-full" nativeButton={false} render={<Link href="/login">Go to login</Link>} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set up your account" subtitle="Create a password to finish onboarding.">
      <AcceptInviteForm token={token} />
    </AuthCard>
  );
}
