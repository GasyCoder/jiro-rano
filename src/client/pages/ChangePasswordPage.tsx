import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router';
import { z } from 'zod';
import { ChangePasswordSchema } from '@shared/schemas';
import { useAuth } from '@/auth/auth';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Spinner } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { AuthShell } from './LoginPage';

const Schema = ChangePasswordSchema.extend({ confirmPassword: z.string() }).refine((v) => v.newPassword === v.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Les deux mots de passe ne correspondent pas',
});
type Values = z.infer<typeof Schema>;

/** Formulaire réutilisé par la page forcée et par « Mon compte ». */
export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(Schema), defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } });

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setError(null);
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      toast.success(t('auth.passwordChanged'));
      await refresh();
      form.reset();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Field label={t('auth.currentPassword')} htmlFor="current-password" error={form.formState.errors.currentPassword?.message}>
        <Input id="current-password" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
      </Field>
      <Field label={t('auth.newPassword')} htmlFor="new-password" error={form.formState.errors.newPassword?.message} hint={t('auth.newPasswordHint')}>
        <Input id="new-password" type="password" autoComplete="new-password" {...form.register('newPassword')} />
      </Field>
      <Field label={t('auth.confirmPassword')} htmlFor="confirm-password" error={form.formState.errors.confirmPassword?.message}>
        <Input id="confirm-password" type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
      </Field>
      <Button type="submit" loading={form.formState.isSubmitting}>
        {t('action.save')}
      </Button>
    </form>
  );
}

export default function ChangePasswordPage() {
  const t = useT();
  const navigate = useNavigate();
  const { me, isLoading } = useAuth();
  if (isLoading) return <Spinner className="min-h-dvh" />;
  if (!me) return <Navigate to="/login" replace />;
  return (
    <AuthShell>
      <CardHeader>
        <CardTitle>{t('auth.changePassword.title')}</CardTitle>
        {me.user.mustChangePassword ? <CardDescription>{t('auth.changePassword.required')}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <ChangePasswordForm onDone={() => navigate('/', { replace: true })} />
      </CardContent>
    </AuthShell>
  );
}
