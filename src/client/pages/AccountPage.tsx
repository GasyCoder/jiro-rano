import { useAuth } from '@/auth/auth';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/feedback';
import { useT } from '@/i18n';
import { formatTimestamp } from '@/lib/format';
import { ChangePasswordForm } from './ChangePasswordPage';

export default function AccountPage() {
  const t = useT();
  const { user, memberships } = useAuth();
  if (!user) return null;
  return (
    <>
      <PageHeader title={t('account.title')} description={user.email} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{user.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>
              <Badge variant={user.role === 'SUPERADMIN' ? 'validated' : 'neutral'}>{t(`account.role.${user.role}`)}</Badge>
            </p>
            <p className="text-slate-500">Dernière connexion : {formatTimestamp(user.lastLoginAt)}</p>
            <div>
              <p className="mb-2 font-medium text-slate-700">{t('account.buildings')}</p>
              <ul className="flex flex-col gap-1">
                {memberships.map((m) => (
                  <li key={m.buildingId} className="flex items-center justify-between gap-2">
                    <span>{m.buildingName}</span>
                    <Badge>{m.role}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('auth.changePassword.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm onDone={() => undefined} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
