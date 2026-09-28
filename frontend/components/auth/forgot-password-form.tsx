'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const successRef = useRef<HTMLHeadingElement>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? 'Could not send reset link. Try again.');
      }
      // Backend always returns a generic message here by design, whether or
      // not the email exists — nothing to branch on.
      setMessage(data.message ?? 'If that email exists, a reset link has been sent.');
      requestAnimationFrame(() => successRef.current?.focus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (message) {
    return (
      <div className="flex flex-col gap-2">
        <h2 ref={successRef} tabIndex={-1} className="text-base font-medium outline-none">
          Check your email
        </h2>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {message}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'forgot-error' : undefined}
        />
      </div>
      <FieldError id="forgot-error" message={error} />
      <Button
        type="submit"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        className="mt-2 w-full"
      >
        {isSubmitting ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
