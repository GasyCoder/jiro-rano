import type { InputHTMLAttributes } from 'react';
import type { AllocationDraftConsumerDto, AllocationDraftDto } from '@shared/api';
import { ALLOCATION_MODES, type AllocationMode } from '@shared/domain';
import type { AllocationConfig, AllocationConsumerConfig } from '@shared/schemas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { useT } from '@/i18n';
import { readingLabel } from './rows';

type WaterChoice = 'EQUAL' | 'PROPORTIONAL_KWH' | 'PROPORTIONAL_WEIGHT' | 'MANUAL';

function waterChoice(water: AllocationConfig['water']): WaterChoice {
  if (water.mode === 'PROPORTIONAL') return water.key === 'WEIGHT' ? 'PROPORTIONAL_WEIGHT' : 'PROPORTIONAL_KWH';
  return water.mode;
}

function waterConfig(choice: WaterChoice): AllocationConfig['water'] {
  if (choice === 'PROPORTIONAL_KWH') return { mode: 'PROPORTIONAL', key: 'KWH' };
  if (choice === 'PROPORTIONAL_WEIGHT') return { mode: 'PROPORTIONAL', key: 'WEIGHT' };
  return choice === 'MANUAL' ? { mode: 'MANUAL' } : { mode: 'EQUAL' };
}

/** Champ numérique : vide = null. */
function NumberInput({ value, onValue, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | null | undefined; onValue: (value: number | null) => void }) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      step="any"
      className="tabular"
      value={value ?? ''}
      onChange={(e) => onValue(e.target.value === '' || !Number.isFinite(e.target.valueAsNumber) ? null : e.target.valueAsNumber)}
      {...props}
    />
  );
}

function ConsumerEditor({
  entry,
  cfg,
  canOverride,
  water,
  currentKwh,
  onPatch,
}: {
  entry: AllocationDraftConsumerDto;
  cfg: AllocationConsumerConfig;
  canOverride: boolean;
  water: WaterChoice;
  currentKwh: number | undefined;
  onPatch: (patch: Partial<AllocationConsumerConfig>) => void;
}) {
  const t = useT();
  const { consumer, meter, readings, suggestedStartId, suggestedEndId } = entry;
  const id = consumer.id;

  const setMethod = (method: AllocationMode) => {
    if (method === 'SUB_METER') {
      onPatch({ method, readingStartId: cfg.readingStartId ?? suggestedStartId, readingEndId: cfg.readingEndId ?? suggestedEndId });
    } else {
      onPatch({ method });
    }
  };

  const readingOptions = readings.map((reading) => (
    <option key={reading.id} value={reading.id}>
      {readingLabel(reading)}
      {reading.id === suggestedStartId || reading.id === suggestedEndId ? ` · ${t('allocation.editor.suggested')}` : ''}
      {reading.validated ? '' : ` · ${t('allocation.editor.toValidate')}`}
    </option>
  ));

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-slate-900">{consumer.name}</p>
        <p className="text-xs text-slate-500">{meter ? t('allocation.editor.meter', { meter: meter.label }) : t('allocation.editor.noMeter')}</p>
      </div>

      <Field label={t('allocation.editor.method')} htmlFor={`method-${id}`}>
        <Select id={`method-${id}`} value={cfg.method} onChange={(e) => setMethod(e.target.value as AllocationMode)}>
          {ALLOCATION_MODES.map((mode) => (
            <option key={mode} value={mode} disabled={mode === 'SUB_METER' && !meter}>
              {t(`allocation.mode.${mode}`)}
            </option>
          ))}
        </Select>
      </Field>

      {cfg.method === 'SUB_METER' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <p className="text-xs text-slate-500 sm:col-span-2">{t('allocation.editor.subMeterHint')}</p>
          <Field label={t('allocation.editor.readingStart')} htmlFor={`start-${id}`}>
            <Select id={`start-${id}`} value={cfg.readingStartId ?? ''} onChange={(e) => onPatch({ readingStartId: e.target.value || null })}>
              <option value="">{t('allocation.editor.noReading')}</option>
              {readingOptions}
            </Select>
          </Field>
          <Field label={t('allocation.editor.readingEnd')} htmlFor={`end-${id}`}>
            <Select id={`end-${id}`} value={cfg.readingEndId ?? ''} onChange={(e) => onPatch({ readingEndId: e.target.value || null })}>
              <option value="">{t('allocation.editor.noReading')}</option>
              {readingOptions}
            </Select>
          </Field>
        </div>
      ) : null}

      {cfg.method === 'MANUAL_APPROXIMATION' ? (
        <Field
          label={
            <span className="flex items-center gap-2">
              {t('allocation.editor.manualKwh')} <Badge variant="estimated">{t('provenance.ESTIMATED')}</Badge>
            </span>
          }
          htmlFor={`manual-${id}`}
          hint={t('allocation.editor.manualKwhHint')}
        >
          <NumberInput id={`manual-${id}`} min={0} value={cfg.manualKwh} onValue={(manualKwh) => onPatch({ manualKwh })} />
        </Field>
      ) : null}

      {cfg.method === 'WEIGHTED_SHARE' ? (
        <Field label={t('allocation.editor.weight')} htmlFor={`weight-${id}`} hint={t('allocation.editor.weightedHint')}>
          <NumberInput id={`weight-${id}`} min={0} value={cfg.weight ?? consumer.weight} onValue={(weight) => onPatch({ weight })} />
        </Field>
      ) : null}
      {cfg.method === 'DIFFERENCE' ? <p className="text-xs text-slate-500">{t('allocation.editor.differenceHint')}</p> : null}
      {cfg.method === 'EQUAL_SHARE' ? <p className="text-xs text-slate-500">{t('allocation.editor.equalHint')}</p> : null}

      {water === 'MANUAL' ? (
        <Field label={t('allocation.editor.manualWater')} htmlFor={`water-${id}`}>
          <NumberInput id={`water-${id}`} min={0} value={cfg.manualWaterAmount} onValue={(manualWaterAmount) => onPatch({ manualWaterAmount })} />
        </Field>
      ) : null}
      {water === 'PROPORTIONAL_WEIGHT' ? (
        <Field label={t('allocation.editor.waterWeight')} htmlFor={`water-weight-${id}`}>
          <NumberInput id={`water-weight-${id}`} min={0} value={cfg.waterWeight ?? consumer.waterWeight} onValue={(waterWeight) => onPatch({ waterWeight })} />
        </Field>
      ) : null}

      {canOverride ? (
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-2">
          <Checkbox
            label={
              <span className="flex items-center gap-2">
                {t('allocation.editor.override')} {cfg.override ? <Badge variant="manual">{t('provenance.MANUAL')}</Badge> : null}
              </span>
            }
            checked={Boolean(cfg.override)}
            onChange={(e) => onPatch({ override: e.target.checked ? { kwh: currentKwh ?? 0, reason: '' } : null })}
          />
          {cfg.override ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <p className="text-xs text-slate-500 sm:col-span-2">{t('allocation.editor.overrideHint')}</p>
              <Field label={t('allocation.editor.overrideKwh')} htmlFor={`override-kwh-${id}`}>
                <NumberInput
                  id={`override-kwh-${id}`}
                  min={0}
                  value={cfg.override.kwh}
                  onValue={(kwh) => onPatch({ override: { reason: cfg.override?.reason ?? '', kwh: kwh ?? 0 } })}
                />
              </Field>
              <Field label={t('allocation.editor.overrideReason')} htmlFor={`override-reason-${id}`}>
                <Input
                  id={`override-reason-${id}`}
                  value={cfg.override.reason}
                  maxLength={500}
                  onChange={(e) => onPatch({ override: { kwh: cfg.override?.kwh ?? 0, reason: e.target.value } })}
                />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Éditeur de configuration de répartition. Ne fait que modifier un objet en mémoire :
 * l'enregistrement est une action séparée et explicite.
 */
export function AllocationEditor({
  draft,
  config,
  onChange,
  currentKwh,
}: {
  draft: AllocationDraftDto;
  config: AllocationConfig;
  onChange: (config: AllocationConfig) => void;
  currentKwh?: Map<string, number>;
}) {
  const t = useT();
  const water = waterChoice(config.water);

  const patchConsumer = (consumerId: string, patch: Partial<AllocationConsumerConfig>) =>
    onChange({ ...config, consumers: config.consumers.map((c) => (c.consumerId === consumerId ? { ...c, ...patch } : c)) });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">{t('allocation.editor.description')}</p>
      <ul className="flex flex-col gap-3">
        {draft.consumers.map((entry) => {
          const cfg = config.consumers.find((c) => c.consumerId === entry.consumer.id);
          if (!cfg) return null;
          return (
            <ConsumerEditor
              key={entry.consumer.id}
              entry={entry}
              cfg={cfg}
              canOverride={draft.canOverride}
              water={water}
              currentKwh={currentKwh?.get(entry.consumer.id)}
              onPatch={(patch) => patchConsumer(entry.consumer.id, patch)}
            />
          );
        })}
      </ul>
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
        <p className="font-medium text-slate-900 sm:col-span-2">{t('allocation.editor.general')}</p>
        <Field label={t('allocation.editor.waterMode')} htmlFor="water-mode">
          <Select id="water-mode" value={water} onChange={(e) => onChange({ ...config, water: waterConfig(e.target.value as WaterChoice) })}>
            {(['EQUAL', 'PROPORTIONAL_KWH', 'PROPORTIONAL_WEIGHT', 'MANUAL'] as const).map((choice) => (
              <option key={choice} value={choice}>
                {t(`allocation.editor.water.${choice}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('allocation.editor.tolerance')} htmlFor="tolerance">
          <NumberInput
            id="tolerance"
            min={0}
            value={config.toleranceAr ?? draft.config.toleranceAr ?? 2}
            onValue={(toleranceAr) => onChange({ ...config, toleranceAr: toleranceAr ?? 0 })}
          />
        </Field>
      </div>
      <div>
        <Button variant="ghost" size="sm" onClick={() => onChange(draft.config)}>
          {t('allocation.editor.reset')}
        </Button>
      </div>
    </div>
  );
}
