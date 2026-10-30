import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Trash2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import type { BuildingDto } from '@shared/api';
import { useAuth } from '@/auth/auth';
import { useCurrentBuilding } from '@/auth/building';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm';
import { Alert, EmptyState, PageHeader, Spinner } from '@/components/ui/feedback';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { BuildingForm, type BuildingFormValues } from '@/features/manage/building-form';
import { ConsumersTab } from '@/features/manage/consumers-tab';
import { MembersTab } from '@/features/manage/members-tab';
import { MetersTab } from '@/features/manage/meters-tab';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { queryKeys } from '@/lib/query';

type Tab = 'info' | 'consumers' | 'meters' | 'members';

function InfoTab({ building }: { building: BuildingDto }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isSuperadmin } = useAuth();
  const { can } = useCurrentBuilding();
  const canEdit = can('building.update');

  const save = async (values: BuildingFormValues) => {
    try {
      await api<BuildingDto>(`/api/buildings/${building.id}`, { method: 'PATCH', body: values });
      toast.success(t('building.saved'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.building(building.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.buildings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(building.id) }),
      ]);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = useMutation({
    mutationFn: () => api(`/api/buildings/${building.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success(t('building.deleted'));
      await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.me }), queryClient.invalidateQueries({ queryKey: queryKeys.buildings })]);
      navigate('/', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onDelete = async () => {
    const result = await confirm({
      title: t('building.danger.title'),
      description: t('building.danger.description'),
      confirmLabel: t('action.delete'),
      destructive: true,
    });
    if (result.confirmed) remove.mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      {!canEdit ? <Alert variant="info">{t('building.readOnly')}</Alert> : null}
      <Card>
        <CardContent className="pt-4 sm:pt-5">
          <BuildingForm
            key={building.updatedAt}
            readOnly={!canEdit}
            submitLabel={t('action.save')}
            onSubmit={save}
            defaultValues={{
              name: building.name,
              address: building.address ?? '',
              description: building.description ?? '',
              jiramaClientNumber: building.jiramaClientNumber ?? '',
              jiramaMeterReference: building.jiramaMeterReference ?? '',
              managerName: building.managerName ?? '',
              defaultWaterMode: building.defaultWaterMode,
              roundingToleranceAr: building.roundingToleranceAr,
              active: building.active,
            }}
          />
        </CardContent>
      </Card>
      {isSuperadmin ? (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle>{t('building.danger.title')}</CardTitle>
            <CardDescription>{t('building.danger.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => void onDelete()} loading={remove.isPending}>
              <Trash2 /> {t('building.danger.title')}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function BuildingPage() {
  const t = useT();
  const { buildingId, building, isLoading, can } = useCurrentBuilding();
  const [params, setParams] = useSearchParams();

  if (!buildingId) return <EmptyState icon={<Building2 />} title={t('nav.noBuilding')} />;
  if (isLoading || !building) return <Spinner />;

  const tabs: { value: Tab; label: string }[] = [
    { value: 'info', label: t('building.tab.info') },
    { value: 'consumers', label: t('building.tab.consumers') },
    { value: 'meters', label: t('building.tab.meters') },
    ...(can('building.manage_members') ? [{ value: 'members' as const, label: t('building.tab.members') }] : []),
  ];
  const requested = params.get('tab');
  const tab: Tab = tabs.find((item) => item.value === requested)?.value ?? 'info';

  return (
    <>
      <PageHeader title={building.name} description={building.address ?? t('building.title')} />
      <Tabs value={tab} onChange={(value) => setParams({ tab: value }, { replace: true })} items={tabs} className="mb-4" />
      {tab === 'info' ? <InfoTab building={building} /> : null}
      {tab === 'consumers' ? <ConsumersTab /> : null}
      {tab === 'meters' ? <MetersTab /> : null}
      {tab === 'members' ? <MembersTab /> : null}
    </>
  );
}
