import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { UserDto } from '@shared/api';
import { USER_ROLES } from '@shared/domain';
import { ResetPasswordSchema, UserCreateSchema } from '@shared/schemas';
import { useAuth } from '@/auth/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, PageHeader, Spinner } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { formatTimestamp } from '@/lib/format';
import { queryKeys } from '@/lib/query';

type CreateInput = z.input<typeof UserCreateSchema>;
type CreateOutput = z.output<typeof UserCreateSchema>;
const EditSchema = z.object({ name: z.string().trim().min(1, 'Champ obligatoire').max(120), role: z.enum(USER_ROLES), active: z.boolean() });
type EditValues = z.infer<typeof EditSchema>;
type ResetValues = z.infer<typeof ResetPasswordSchema>;

type DialogState = { kind: 'create' } | { kind: 'edit'; user: UserDto } | { kind: 'reset'; user: UserDto } | null;

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.users });
}

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateUsers();
  const form = useForm<CreateInput, unknown, CreateOutput>({
    resolver: zodResolver(UserCreateSchema),
    defaultValues: { email: '', name: '', role: 'USER', password: '', locale: 'fr' },
  });
  useEffect(() => {
    if (open) form.reset({ email: '', name: '', role: 'USER', password: '', locale: 'fr' });
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: (values: CreateOutput) => api<UserDto>('/api/users', { method: 'POST', body: values }),
    onSuccess: async () => {
      toast.success(t('admin.users.created'));
      await invalidate();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const errors = form.formState.errors;
  const submit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('admin.users.add')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={mutation.isPending}>
            {t('action.save')}
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
        <Field label={t('admin.users.field.email')} htmlFor="u-email" error={errors.email?.message} className="sm:col-span-2">
          <Input id="u-email" type="email" inputMode="email" autoComplete="off" {...form.register('email')} />
        </Field>
        <Field label={t('admin.users.field.name')} htmlFor="u-name" error={errors.name?.message} className="sm:col-span-2">
          <Input id="u-name" {...form.register('name')} />
        </Field>
        <Field label={t('admin.users.field.role')} htmlFor="u-role">
          <Select id="u-role" {...form.register('role')}>
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`account.role.${role}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.users.field.locale')} htmlFor="u-locale">
          <Select id="u-locale" {...form.register('locale')}>
            <option value="fr">{t('admin.users.locale.fr')}</option>
            <option value="mg">{t('admin.users.locale.mg')}</option>
          </Select>
        </Field>
        <Field label={t('admin.users.field.password')} htmlFor="u-password" error={errors.password?.message} hint={t('admin.users.field.passwordHint')} className="sm:col-span-2">
          <Input id="u-password" type="text" autoComplete="new-password" {...form.register('password')} />
        </Field>
      </form>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateUsers();
  const form = useForm<EditValues>({ resolver: zodResolver(EditSchema) });
  useEffect(() => {
    if (user) form.reset({ name: user.name, role: user.role, active: user.active });
  }, [user, form]);

  const mutation = useMutation({
    mutationFn: (values: EditValues) => api<UserDto>(`/api/users/${user?.id}`, { method: 'PATCH', body: values }),
    onSuccess: async () => {
      toast.success(t('admin.users.saved'));
      await invalidate();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const submit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(next) => !next && onClose()}
      title={t('admin.users.edit')}
      description={user?.email}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={mutation.isPending}>
            {t('action.save')}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field label={t('admin.users.field.name')} htmlFor="e-name" error={form.formState.errors.name?.message}>
          <Input id="e-name" {...form.register('name')} />
        </Field>
        <Field label={t('admin.users.field.role')} htmlFor="e-role">
          <Select id="e-role" {...form.register('role')}>
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`account.role.${role}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox label={t('admin.users.field.active')} {...form.register('active')} />
      </form>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateUsers();
  const form = useForm<ResetValues>({ resolver: zodResolver(ResetPasswordSchema), defaultValues: { password: '' } });
  useEffect(() => {
    if (user) form.reset({ password: '' });
  }, [user, form]);

  const mutation = useMutation({
    mutationFn: (values: ResetValues) => api(`/api/users/${user?.id}/reset-password`, { method: 'POST', body: values }),
    onSuccess: async () => {
      toast.success(t('admin.users.passwordReset'));
      await invalidate();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const submit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(next) => !next && onClose()}
      title={t('admin.users.resetPassword')}
      description={user ? `${user.name} · ${user.email}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={mutation.isPending}>
            {t('action.save')}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Alert variant="info">{t('admin.users.resetHint')}</Alert>
        <Field label={t('admin.users.field.password')} htmlFor="r-password" error={form.formState.errors.password?.message} hint={t('admin.users.field.passwordHint')}>
          <Input id="r-password" type="text" autoComplete="new-password" {...form.register('password')} />
        </Field>
      </form>
    </Dialog>
  );
}

export default function UsersPage() {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateUsers();
  const { user: me } = useAuth();
  const [dialog, setDialog] = useState<DialogState>(null);

  const usersQuery = useQuery({ queryKey: queryKeys.users, queryFn: () => api<UserDto[]>('/api/users') });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/users/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success(t('admin.users.deleted'));
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onDelete = async (user: UserDto) => {
    const result = await confirm({ title: t('admin.users.deleteTitle', { name: user.name }), confirmLabel: t('action.delete'), destructive: true });
    if (result.confirmed) remove.mutate(user.id);
  };

  const users = usersQuery.data ?? [];

  return (
    <>
      <PageHeader
        title={t('admin.users.title')}
        description={t('admin.users.description')}
        actions={
          <Button onClick={() => setDialog({ kind: 'create' })}>
            <Plus /> {t('admin.users.add')}
          </Button>
        }
      />
      {usersQuery.isLoading ? (
        <Spinner />
      ) : usersQuery.isError ? (
        <Alert variant="error">{errorMessage(usersQuery.error)}</Alert>
      ) : users.length === 0 ? (
        <EmptyState icon={<Users />} title={t('admin.users.empty')} />
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {users.map((user) => {
            const self = user.id === me?.id;
            return (
              <li key={user.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">
                      {user.name}
                      {self ? <span className="text-slate-500"> ({t('admin.users.you')})</span> : null}
                    </span>
                    <Badge variant={user.role === 'SUPERADMIN' ? 'validated' : 'neutral'}>{t(`account.role.${user.role}`)}</Badge>
                    {!user.active ? <Badge variant="danger">{t('admin.users.inactive')}</Badge> : null}
                    {user.mustChangePassword ? <Badge variant="warning">{t('admin.users.mustChange')}</Badge> : null}
                  </span>
                  <span className="truncate text-xs text-slate-500">{user.email}</span>
                  <span className="text-xs text-slate-500">
                    {user.lastLoginAt ? t('admin.users.lastLogin', { date: formatTimestamp(user.lastLoginAt) }) : t('admin.users.never')}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setDialog({ kind: 'edit', user })} aria-label={t('action.edit')} title={t('action.edit')}>
                    <Pencil />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setDialog({ kind: 'reset', user })}
                    aria-label={t('admin.users.resetPassword')}
                    title={t('admin.users.resetPassword')}
                  >
                    <KeyRound />
                  </Button>
                  {!self ? (
                    <Button size="icon" variant="ghost" onClick={() => void onDelete(user)} aria-label={t('action.delete')} title={t('action.delete')}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CreateUserDialog open={dialog?.kind === 'create'} onClose={() => setDialog(null)} />
      <EditUserDialog user={dialog?.kind === 'edit' ? dialog.user : null} onClose={() => setDialog(null)} />
      <ResetPasswordDialog user={dialog?.kind === 'reset' ? dialog.user : null} onClose={() => setDialog(null)} />
    </>
  );
}
