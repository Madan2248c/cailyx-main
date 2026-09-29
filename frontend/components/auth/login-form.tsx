'use client';

import { CircleAlert, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';

const FIELD_CLASS = 'min-h-11 md:text-base';
const SERVICE_ERROR = /cannot (get|post)|failed to fetch|network|unexpected error|internal server|something went wrong|fetch failed/i;

type LoginError = { message: string; kind: 'credentials' | 'service' | 'validation' };

export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fieldsInvalid = error?.kind === 'credentials' || error?.kind === 'validation';

  function clearError() {
    if (error) setError(null);
  }

  function trackCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(event.getModifierState('CapsLock'));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;

    if (!email.trim() || !password) {
      setError({ kind: 'validation', message: 'Enter your email and password to sign in.' });
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
      router.push('/dashboard');
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      if (!raw || SERVICE_ERROR.test(raw)) {
        setError({
          kind: 'service',
          message: "We couldn't reach the sign-in service. Please try again in a moment.",
        });
      } else {
        setError({ kind: 'credentials', message: raw });
      }
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      {error ? (
        <div
          id="login-error"
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm text-destructive"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p className="leading-snug">{error.message}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          placeholder="you@company.com"
          value={email}
          disabled={isSubmitting}
          onChange={(e) => {
            setEmail(e.target.value);
            clearError();
          }}
          aria-invalid={fieldsInvalid || undefined}
          aria-describedby={error ? 'login-error' : undefined}
          className={FIELD_CLASS}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="rounded text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            placeholder="Enter your password"
            value={password}
            disabled={isSubmitting}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError();
            }}
            onKeyDown={trackCapsLock}
            onKeyUp={trackCapsLock}
            onBlur={() => setCapsLock(false)}
            aria-invalid={fieldsInvalid || undefined}
            aria-describedby={error ? 'login-error' : undefined}
            className={`${FIELD_CLASS} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-lg text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        </div>
        {capsLock ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Caps Lock is on.
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        className="mt-1 h-11 w-full text-sm"
      >
        {isSubmitting ? (
          <>
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            Signing in…
          </>
        ) : (
          'Sign in'
        )}
      </Button>
    </form>
  );
}
