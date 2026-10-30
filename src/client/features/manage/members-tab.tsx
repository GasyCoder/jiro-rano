import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, UserMinus, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { ConsumerDto, MemberDto } from '@shared/api';
import { BUILDING_ROLE_PERMISSIONS, BUILDING_ROLES, PERMISSIONS, type Permission } from '@shared/domain';
import { useAuth } from '@/auth/auth';
import { useCurrentBuilding } from '@/auth/building';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, Spinner } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { queryKeys } from '@/lib/query';

const MemberFormSchema = z.object({
  email: z.string(),
  role: z.enum(BUILDING_ROLES),
  permissions: z.array(z.enum(PERMISSIONS)),
  consumerId: z.string(),
});
type MemberFormValues = z.infer<typeof MemberFormSchema>;
const EmailSchema = z.email().max(254);

const EMPTY: MemberFormValues = { email: '', role: 'VIEWER', permissions: [], consumerId: '' };
/** Les droits d'un membre viennent de /api/auth/me : rafraîchir aussi l'utilisateur courant. */
const AFFECTED_KEYS = [['members'], ['me'], ['buildings']];

function MemberDialog({ open, member, consumers, onClose }: { open: boolean; member: MemberDto | null; consumers: ConsumerDto[]; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { buildingId } = useCurrentBuilding();
  const form = useForm<MemberFormValues>({ resolver: zodResolver(MemberFormSchema), defaultValues: EMPTY });
  const role = form.watch('role');
  const selected = form.watch('permissions');

  useEffect(() => {
    if (!open) return;
    form.reset(
      member
        ? { email: member.userEmail, role: member.role, permissions: member.extraPermissions, consumerId: member.consumerId ?? '' }
        : EMPTY,
    );
  }, [open, member, form]);

  const extraChoices = PERMISSIONS.filter((p) => !BUILDING_ROLE_PERMISSIONS[role].includes(p));

  const togglePermission = (permission: Permission, checked: boolean) => {
    const next = checked ? [...selected, permission] : selected.filter((p) => p !== permission);
    form.setValue('permissions', next, { shouldDirty: true });
  };

  const mutation = useMutation({
    mutationFn: (values: MemberFormValues) => {
      // Les permissions déjà incluses dans le rôle choisi n'ont pas à être stockées en supplément.
      const permissions = values.permissions.filter((p) => !BUILDING_ROLE_PERMISSIONS[values.role].includes(p));
      const consumerId = values.consumerId || null;
      return member
        ? api(`/api/members/${member.id}`, { method: 'PATCH', body: { role: values.role, permissions, consumerId } })
        : api(`/api/buildings/${buildingId}/members`, { method: 'POST', body: { email: values.email.trim(), role: values.role, permissions, consumerId } });
    },
    onSuccess: async () => {
      toast.success(t('building.members.saved'));
      await Promise.all(AFFECTED_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = form.formState.errors;
  const submit = form.handleSubmit((values) => {
    // L'e-mail n'est saisi qu'à l'ajout : contrôlé ici plutôt que dans un schéma qui dépendrait du mode.
    if (!member && !EmailSchema.safeParse(values.email.trim()).success) {
      form.setError('email', { message: 'Adresse e-mail invalide' });
      return;
    }
    mutation.mutate(values);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={member ? t('building.members.edit') : t('building.members.add')}
      description={member ? `${member.userName} · ${member.userEmail}` : undefined}
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
        {!member ? (
          <Field label={t('building.members.field.email')} htmlFor="mb-email" error={errors.email?.message} hint={t('building.members.field.emailHint')}>
            <Input id="mb-email" type="email" inputMode="email" autoComplete="off" {...form.register('email')} />
          </Field>
        ) : null}
        <Field label={t('building.members.field.role')} htmlFor="mb-role" hint={t(`building.members.roleHint.${role}`)}>
          <Select id="mb-role" {...form.register('role')}>
            {BUILDING_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`building.members.role.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        {extraChoices.length > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-slate-700">{t('building.members.field.permissions')}</legend>
            {extraChoices.map((permission) => (
              <Checkbox
                key={permission}
                label={t(`admin.permission.${permission}`)}
                checked={selected.includes(permission)}
                onChange={(e) => togglePermission(permission, e.target.checked)}
              />
            ))}
          </fieldset>
        ) : null}
        <Field label={t('building.members.field.consumer')} htmlFor="mb-consumer">
          <Select id="mb-consumer" {...form.register('consumerId')}>
            <option value="">{t('building.members.field.noConsumer')}</option>
            {consumers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}

export function MembersTab() {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { buildingId } = useCurrentBuilding();
  const [dialog, setDialog] = useState<{ open: boolean; member: MemberDto | null }>({ open: false, member: null });

  const membersQuery = useQuery({
    queryKey: queryKeys.members(buildingId ?? 'none'),
    queryFn: () => api<MemberDto[]>(`/api/buildings/${buildingId}/members`),
    enabled: Boolean(buildingId),
  });
  const consumersQuery = useQuery({
    queryKey: queryKeys.consumers(buildingId ?? 'none', true),
    queryFn: () => api<ConsumerDto[]>(`/api/buildings/${buildingId}/consumers?includeInactive=true`),
    enabled: Boolean(buildingId),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/members/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success(t('building.members.removed'));
      await Promise.all(AFFECTED_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onRemove = async (member: MemberDto) => {
    const result = await confirm({ title: t('building.members.removeTitle', { name: member.userName }), confirmLabel: t('building.members.remove'), destructive: true });
    if (result.confirmed) remove.mutate(member.id);
  };

  if (membersQuery.isLoading) return <Spinner />;
  if (membersQuery.isError) return <Alert variant="error">{errorMessage(membersQuery.error)}</Alert>;
  const members = membersQuery.data ?? [];
  const consumers = (consumersQuery.data ?? []).filter((c) => c.active);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => setDialog({ open: true, member: null })}>
          <Plus /> {t('building.members.add')}
        </Button>
      </div>
      {members.length === 0 ? (
        <EmptyState icon={<UserPlus />} title={t('building.members.empty')} />
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {members.map((member) => {
            const occupies = consumersQuery.data?.find((c) => c.id === member.consumerId);
            const self = member.userId === user?.id;
            return (
              <li key={member.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">
                      {member.userName}
                      {self ? <span className="text-slate-500"> ({t('building.members.you')})</span> : null}
                    </span>
                    <Badge variant={member.role === 'MANAGER' ? 'validated' : 'neutral'}>{t(`building.members.role.${member.role}`)}</Badge>
                  </span>
                  <span className="truncate text-xs text-slate-500">{member.userEmail}</span>
                  {occupies ? <span className="text-xs text-slate-600">{t('building.members.occupies', { name: occupies.name })}</span> : null}
                  {member.extraPermissions.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {member.extraPermissions.map((p) => (
                        <Badge key={p} variant="prorated">
                          + {t(`admin.permission.${p}`)}
                        </Badge>
                      ))}
                    </span>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setDialog({ open: true, member })} aria-label={t('action.edit')} title={t('action.edit')}>
                    <Pencil />
                  </Button>
                  {!self ? (
                    <Button size="icon" variant="ghost" onClick={() => void onRemove(member)} aria-label={t('building.members.remove')} title={t('building.members.remove')}>
                      <UserMinus />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <MemberDialog open={dialog.open} member={dialog.member} consumers={consumers} onClose={() => setDialog({ open: false, member: null })} />
    </div>
  );
}
