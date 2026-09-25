import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { Button } from '@/components/ui/button';
import { backendFetch } from '@/lib/backend-client';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <AuthCard title="Invalid reset link">
        <p className="text-sm text-muted-foreground">
          This link is missing its token. Request a new one from the sign-in page.
        </p>
      </AuthCard>
    );
  }

  // Same reasoning as accept-invite: check validity before showing the
  // form, so a reused/expired reset link doesn't look like it still works.
  const { valid } = await backendFetch<{ valid: boolean }>('/auth/reset-password/validate', {
    method: 'POST',
    body: JSON.stringify({ token }),
  }).catch(() => ({ valid: false }));

  if (!valid) {
    return (
      <AuthCard title="This reset link has expired">
        <p className="text-sm text-muted-foreground">
          It&apos;s either already been used or is no longer valid. Request a new one from the
          sign-in page.
        </p>
        <Button className="mt-4 w-full" nativeButton={false} render={<Link href="/login">Go to login</Link>} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
