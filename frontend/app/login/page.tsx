import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  return (
    <AuthCard title="Sign in to Cailyx" subtitle="Enter your email and password to continue.">
      <LoginForm />
    </AuthCard>
  );
}
