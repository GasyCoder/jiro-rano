import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { BuildingDto } from '@shared/api';
import { useCurrentBuilding } from '@/auth/building';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, PageHeader } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/toast';
import { BuildingForm, type BuildingFormValues, EMPTY_BUILDING } from '@/features/manage/building-form';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { queryKeys } from '@/lib/query';

export default function BuildingCreatePage() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setBuildingId } = useCurrentBuilding();

  const create = async ({ active: _active, ...values }: BuildingFormValues) => {
    try {
      const building = await api<BuildingDto>('/api/buildings', { method: 'POST', body: values });
      toast.success(t('building.created'));
      // Les bâtiments accessibles viennent de /api/auth/me : on attend le rafraîchissement avant de basculer.
      await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.me }), queryClient.invalidateQueries({ queryKey: queryKeys.buildings })]);
      setBuildingId(building.id);
      navigate('/building?tab=meters');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <PageHeader title={t('building.create.title')} />
      <Alert variant="info" className="mb-4">
        {t('building.create.description')}
      </Alert>
      <Card>
        <CardContent className="pt-4 sm:pt-5">
          <BuildingForm defaultValues={EMPTY_BUILDING} onSubmit={create} submitLabel={t('building.create.submit')} showActive={false} />
        </CardContent>
      </Card>
    </>
  );
}
