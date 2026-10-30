import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { WATER_MODES } from '@shared/domain';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { useT } from '@/i18n';

/** Mêmes contraintes que BuildingSchema (serveur) ; les champs vides sont convertis en null côté serveur. */
const BuildingFormSchema = z.object({
  name: z.string().trim().min(1, 'Champ obligatoire').max(120),
  address: z.string().max(300),
  description: z.string().max(2000),
  jiramaClientNumber: z.string().max(60),
  jiramaMeterReference: z.string().max(60),
  managerName: z.string().max(120),
  defaultWaterMode: z.enum(WATER_MODES),
  roundingToleranceAr: z.number({ error: 'Nombre requis' }).min(0).max(1000),
  active: z.boolean(),
});
export type BuildingFormValues = z.infer<typeof BuildingFormSchema>;

export const EMPTY_BUILDING: BuildingFormValues = {
  name: '',
  address: '',
  description: '',
  jiramaClientNumber: '',
  jiramaMeterReference: '',
  managerName: '',
  defaultWaterMode: 'EQUAL',
  roundingToleranceAr: 2,
  active: true,
};

export function BuildingForm({
  defaultValues,
  onSubmit,
  submitLabel,
  readOnly = false,
  showActive = true,
}: {
  defaultValues: BuildingFormValues;
  onSubmit: (values: BuildingFormValues) => Promise<unknown>;
  submitLabel: string;
  readOnly?: boolean;
  showActive?: boolean;
}) {
  const t = useT();
  const form = useForm<BuildingFormValues>({ resolver: zodResolver(BuildingFormSchema), defaultValues });
  const { errors, isSubmitting } = form.formState;

  return (
    <form className="flex flex-col gap-4" onSubmit={form.handleSubmit((values) => onSubmit(values))} noValidate>
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('building.field.name')} htmlFor="b-name" error={errors.name?.message} className="sm:col-span-2">
          <Input id="b-name" aria-invalid={Boolean(errors.name)} {...form.register('name')} />
        </Field>
        <Field label={t('building.field.address')} htmlFor="b-address" className="sm:col-span-2">
          <Input id="b-address" {...form.register('address')} />
        </Field>
        <Field label={t('building.field.description')} htmlFor="b-description" className="sm:col-span-2">
          <Textarea id="b-description" rows={2} {...form.register('description')} />
        </Field>
        <Field label={t('building.field.clientNumber')} htmlFor="b-client">
          <Input id="b-client" {...form.register('jiramaClientNumber')} />
        </Field>
        <Field label={t('building.field.meterReference')} htmlFor="b-meter">
          <Input id="b-meter" {...form.register('jiramaMeterReference')} />
        </Field>
        <Field label={t('building.field.manager')} htmlFor="b-manager" className="sm:col-span-2">
          <Input id="b-manager" {...form.register('managerName')} />
        </Field>
        <Field label={t('building.field.waterMode')} htmlFor="b-water">
          <Select id="b-water" {...form.register('defaultWaterMode')}>
            {WATER_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`building.waterMode.${mode}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('building.field.tolerance')} htmlFor="b-tolerance" error={errors.roundingToleranceAr?.message} hint={t('building.field.toleranceHint')}>
          <Input id="b-tolerance" type="number" inputMode="decimal" step="0.01" min={0} {...form.register('roundingToleranceAr', { valueAsNumber: true })} />
        </Field>
        {showActive ? <Checkbox label={t('building.field.active')} className="sm:col-span-2" {...form.register('active')} /> : null}
      </fieldset>
      {!readOnly ? (
        <div>
          <Button type="submit" loading={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
