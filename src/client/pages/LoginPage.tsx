import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { LoginSchema } from '@shared/schemas';
import type { z } from 'zod';
import { useAuth } from '@/auth/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Spinner } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/api';

type Values = z.infer<typeof LoginSchema>;

export function AuthShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <img src="/favicon.svg" alt="" className="size-12" />
        <p className="text-lg font-semibold text-slate-900">{t('app.name')}</p>
        <p className="text-sm text-slate-500">{t('app.tagline')}</p>
      </div>
      <Card className="w-full max-w-sm">{children}</Card>
    </div>
  );
}

export default function LoginPage() {
  const t = useT();
  const { me, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(LoginSchema), defaultValues: { email: '', password: '' } });
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (isLoading) return <Spinner className="min-h-dvh" />;
  if (me) return <Navigate to={me.user.mustChangePassword ? '/change-password' : from} replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const result = await login(values.email, values.password);
      navigate(result.user.mustChangePassword ? '/change-password' : from, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <AuthShell>
      <CardHeader>
        <CardTitle>{t('auth.login.title')}</CardTitle>
        <CardDescription>{t('auth.login.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {error ? <Alert variant="error">{error}</Alert> : null}
          <Field label={t('auth.email')} htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="username" inputMode="email" {...form.register('email')} />
          </Field>
          <Field label={t('auth.password')} htmlFor="password" error={form.formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
          </Field>
          <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
            {t('auth.login.submit')}
          </Button>
        </form>
      </CardContent>
    </AuthShell>
  );
}
