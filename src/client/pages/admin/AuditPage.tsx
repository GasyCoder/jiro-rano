import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { useState } from 'react';
import type { AuditLogDto, Paginated } from '@shared/api';
import { useAuth } from '@/auth/auth';
import { useCurrentBuilding } from '@/auth/building';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, Spinner } from '@/components/ui/feedback';
import { Field, Select } from '@/components/ui/form';
import { fr, type MessageKey, useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { formatTimestamp } from '@/lib/format';
import { queryKeys } from '@/lib/query';

const ENTITY_TYPES = ['building', 'building_member', 'consumer', 'meter', 'meter_reading', 'bill', 'allocation', 'file', 'user', 'settings'] as const;
const PAGE_SIZE = 25;

/** Libellé lisible d'une action connue ; sinon l'identifiant technique (jamais d'action masquée). */
function useLabel() {
  const t = useT();
  return (prefix: 'admin.audit.action.' | 'admin.audit.entity.', value: string) => {
    const key = `${prefix}${value}`;
    return key in fr ? t(key as MessageKey) : value;
  };
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <pre className="max-h-64 overflow-auto rounded-md bg-slate-50 p-2 text-xs text-slate-700">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function AuditEntry({ entry, buildingName }: { entry: AuditLogDto; buildingName: string | null }) {
  const t = useT();
  const label = useLabel();
  const hasDetails = entry.oldValue != null || entry.newValue != null;
  return (
    <li className="flex flex-col gap-1 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-slate-900">{label('admin.audit.action.', entry.action)}</span>
        <span className="tabular text-xs text-slate-500">{formatTimestamp(entry.createdAt)}</span>
      </div>
      <p className="text-xs text-slate-600">
        {entry.userName ?? t('admin.audit.system')} · {label('admin.audit.entity.', entry.entityType)}
        {buildingName ? ` · ${buildingName}` : ''}
        {entry.ip ? ` · ${t('admin.audit.ip', { ip: entry.ip })}` : ''}
      </p>
      {hasDetails ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-brand-700">{t('admin.audit.details')}</summary>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <JsonBlock title={t('admin.audit.before')} value={entry.oldValue} />
            <JsonBlock title={t('admin.audit.after')} value={entry.newValue} />
          </div>
        </details>
      ) : null}
    </li>
  );
}

export default function AuditPage() {
  const t = useT();
  const { isSuperadmin, memberships } = useAuth();
  const { buildingId: currentBuildingId } = useCurrentBuilding();
  const readable = isSuperadmin ? memberships : memberships.filter((m) => m.permissions.includes('audit.read'));
  const defaultBuilding = readable.some((m) => m.buildingId === currentBuildingId) ? (currentBuildingId ?? '') : (readable[0]?.buildingId ?? '');
  const [buildingId, setBuildingId] = useState<string>(defaultBuilding);
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);

  const params = { buildingId: buildingId || undefined, entityType: entityType || undefined, page };
  const canQuery = isSuperadmin || Boolean(buildingId);
  const auditQuery = useQuery({
    queryKey: queryKeys.audit(params),
    queryFn: () => {
      const search = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (buildingId) search.set('buildingId', buildingId);
      if (entityType) search.set('entityType', entityType);
      return api<Paginated<AuditLogDto>>(`/api/audit?${search.toString()}`);
    },
    enabled: canQuery,
    placeholderData: keepPreviousData,
  });

  const header = <PageHeader title={t('admin.audit.title')} description={t('admin.audit.description')} />;
  if (!isSuperadmin && readable.length === 0) {
    return (
      <>
        {header}
        <EmptyState icon={<ScrollText />} title={t('admin.audit.forbidden')} />
      </>
    );
  }

  const names = new Map(memberships.map((m) => [m.buildingId, m.buildingName]));
  const data = auditQuery.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      {header}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Field label={t('admin.audit.building')} htmlFor="audit-building">
          <Select
            id="audit-building"
            value={buildingId}
            onChange={(e) => {
              setBuildingId(e.target.value);
              setPage(1);
            }}
          >
            {isSuperadmin ? <option value="">{t('admin.audit.allBuildings')}</option> : null}
            {readable.map((m) => (
              <option key={m.buildingId} value={m.buildingId}>
                {m.buildingName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.audit.entity')} htmlFor="audit-entity">
          <Select
            id="audit-entity"
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('admin.audit.allEntities')}</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`admin.audit.entity.${type}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {auditQuery.isLoading ? (
        <Spinner />
      ) : auditQuery.isError ? (
        <Alert variant="error">{errorMessage(auditQuery.error)}</Alert>
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={<ScrollText />} title={t('admin.audit.empty')} />
      ) : (
        <>
          <Card className={auditQuery.isFetching ? 'opacity-60 transition-opacity' : undefined}>
            <ul className="flex flex-col divide-y divide-slate-100">
              {data.items.map((entry) => (
                <AuditEntry key={entry.id} entry={entry} buildingName={entry.buildingId && !buildingId ? (names.get(entry.buildingId) ?? null) : null} />
              ))}
            </ul>
          </Card>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-600">
            <span>{t('admin.audit.total', { total: data.total })}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t('action.previous')}>
                <ChevronLeft />
              </Button>
              <span className="tabular">{t('admin.audit.page', { page, pages })}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label={t('action.next')}>
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
