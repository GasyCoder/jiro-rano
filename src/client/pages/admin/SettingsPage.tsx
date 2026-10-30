import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import type { SettingsDto } from '@shared/api';
import { WATER_MODES } from '@shared/domain';
import { SettingsSchema } from '@shared/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, PageHeader, Spinner } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { queryKeys } from '@/lib/query';

type Values = z.infer<typeof SettingsSchema>;

export default function SettingsPage() {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: () => api<SettingsDto>('/api/settings') });
  const form = useForm<Values>({ resolver: zodResolver(SettingsSchema) });

  useEffect(() => {
    const data = settingsQuery.data;
    if (data) form.reset({ defaultToleranceAr: data.defaultToleranceAr, defaultWaterMode: data.defaultWaterMode, managersCanOverride: data.managersCanOverride });
  }, [settingsQuery.data, form]);

  const mutation = useMutation({
    mutationFn: (values: Values) => api<SettingsDto>('/api/settings', { method: 'PUT', body: values }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings, data);
      toast.success(t('admin.settings.saved'));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const header = <PageHeader title={t('admin.settings.title')} description={t('admin.settings.description')} />;
  if (settingsQuery.isLoading) return <>{header}<Spinner /></>;
  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <>
        {header}
        <Alert variant="error">{errorMessage(settingsQuery.error)}</Alert>
      </>
    );
  }
  const data = settingsQuery.data;
  const extractor = data.extractorProvider.includes('claude') ? `Claude (vision IA) · ${data.extractorProvider}` : t('admin.settings.extractorManual');
  const errors = form.formState.errors;

  return (
    <>
      {header}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.settings.defaults')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
              <Field label={t('admin.settings.tolerance')} htmlFor="s-tolerance" error={errors.defaultToleranceAr?.message}>
                <Input id="s-tolerance" type="number" inputMode="decimal" step="0.01" min={0} {...form.register('defaultToleranceAr', { valueAsNumber: true })} />
              </Field>
              <Field label={t('admin.settings.waterMode')} htmlFor="s-water">
                <Select id="s-water" {...form.register('defaultWaterMode')}>
                  {WATER_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`building.waterMode.${mode}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-col gap-1">
                <Checkbox label={t('admin.settings.managersCanOverride')} {...form.register('managersCanOverride')} />
                <p className="pl-6 text-xs text-slate-500">{t('admin.settings.managersCanOverrideHint')}</p>
              </div>
              <div>
                <Button type="submit" loading={mutation.isPending}>
                  {t('action.save')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.settings.system')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">{t('admin.settings.extractor')}</dt>
                <dd className="text-slate-800">{extractor}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t('admin.settings.uploadMax')}</dt>
                <dd className="text-slate-800">{t('admin.settings.uploadMaxValue', { value: data.uploadMaxMb })}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t('admin.settings.version')}</dt>
                <dd className="tabular text-slate-800">{data.version}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
