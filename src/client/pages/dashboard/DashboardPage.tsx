import { useQuery } from '@tanstack/react-query';
import { Building2, Plus, Receipt } from 'lucide-react';
import { Link } from 'react-router';
import type { ConsumerDto, DashboardDto } from '@shared/api';
import { useAuth } from '@/auth/auth';
import { useCurrentBuilding } from '@/auth/building';
import { CalculationStatusBadge, AllocationStatusBadge, ProvenanceBadge } from '@/components/badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, Spinner } from '@/components/ui/feedback';
import { consumerColorMap, OTHER_COLOR } from '@/features/manage/chart-kit';
import { BuildingKwhChart, ConsumerKwhChart, MonthlyCostChart, StackedConsumerChart } from '@/features/manage/dashboard-charts';
import { StatTile } from '@/features/manage/stat-tile';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { formatAriary, formatBillMonth, formatKwh, formatPercent, formatPeriod } from '@/lib/format';
import { queryKeys } from '@/lib/query';

export default function DashboardPage() {
  const t = useT();
  const { isSuperadmin } = useAuth();
  const { buildingId, building, can } = useCurrentBuilding();

  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard(buildingId ?? 'none'),
    queryFn: () => api<DashboardDto>(`/api/buildings/${buildingId}/dashboard`),
    enabled: Boolean(buildingId),
  });
  const consumersQuery = useQuery({
    queryKey: queryKeys.consumers(buildingId ?? 'none', true),
    queryFn: () => api<ConsumerDto[]>(`/api/buildings/${buildingId}/consumers?includeInactive=true`),
    enabled: Boolean(buildingId),
  });

  if (!buildingId) {
    return (
      <EmptyState
        icon={<Building2 />}
        title={t('dashboard.noBuilding.title')}
        description={isSuperadmin ? t('dashboard.noBuilding.admin') : t('dashboard.noBuilding.user')}
        action={
          isSuperadmin ? (
            <Button asChild>
              <Link to="/buildings/new">
                <Plus /> {t('dashboard.createBuilding')}
              </Link>
            </Button>
          ) : null
        }
      />
    );
  }

  const newBillButton = can('bill.write') ? (
    <Button asChild>
      <Link to="/bills/new">
        <Plus /> {t('dashboard.newBill')}
      </Link>
    </Button>
  ) : null;
  const header = <PageHeader title={t('dashboard.title')} description={building?.name} actions={newBillButton} />;

  if (dashboardQuery.isLoading) return <>{header}<Spinner /></>;
  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <>
        {header}
        <Alert variant="error" title={t('state.error')}>
          {errorMessage(dashboardQuery.error)}
          <Button variant="link" className="h-auto px-0" onClick={() => void dashboardQuery.refetch()}>
            {t('action.retry')}
          </Button>
        </Alert>
      </>
    );
  }

  const { latestBill, latestAllocation, evolution, monthly, consumersCount } = dashboardQuery.data;
  const colors = consumerColorMap(consumersQuery.data);
  const names = new Map((consumersQuery.data ?? []).map((c) => [c.id, c.name]));

  if (!latestBill) {
    return (
      <>
        {header}
        <EmptyState icon={<Receipt />} title={t('dashboard.noBill.title')} description={t('dashboard.noBill.description')} action={newBillButton} />
      </>
    );
  }

  const status = latestAllocation?.status;
  const totalPayable = latestAllocation?.items.reduce((sum, item) => sum + item.payableAmount, 0) ?? 0;

  return (
    <>
      {header}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t('dashboard.kpi.currentBill')}
          value={<span className="capitalize">{formatBillMonth(latestBill.periodEnd)}</span>}
          sub={formatPeriod(latestBill.periodStart, latestBill.periodEnd)}
          badge={<CalculationStatusBadge status={latestBill.calculationStatus} />}
        />
        <StatTile
          label={t('dashboard.kpi.consumption')}
          value={`${formatKwh(latestBill.electricityKwh)} kWh`}
          delta={evolution.kwhPercent}
          deltaLabel={evolution.kwhPercent == null ? t('dashboard.kpi.noPrevious') : t('dashboard.kpi.vsPrevious')}
        />
        <StatTile
          label={t('dashboard.kpi.amount')}
          value={formatAriary(latestBill.totalAmount, 0)}
          delta={evolution.amountPercent}
          deltaLabel={evolution.amountPercent == null ? t('dashboard.kpi.noPrevious') : t('dashboard.kpi.vsPrevious')}
        />
        <StatTile label={t('dashboard.kpi.consumers')} value={consumersCount} sub={t('dashboard.kpi.consumersHint')} />
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {latestBill.calculationStatus === 'OUTDATED' ? <Alert variant="warning">{t('dashboard.allocation.outdated')}</Alert> : null}
        {status === 'CALCULATED' ? <Alert variant="warning">{t('dashboard.allocation.provisional')}</Alert> : null}
        {status === 'DRAFT' ? <Alert variant="error">{t('dashboard.allocation.draft')}</Alert> : null}
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>{t('dashboard.allocation.title')}</CardTitle>
            <CardDescription>
              {formatPeriod(latestBill.periodStart, latestBill.periodEnd)}
              {latestAllocation ? ` · ${t('dashboard.allocation.version', { version: latestAllocation.version })}` : ''}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {latestAllocation ? <AllocationStatusBadge status={latestAllocation.status} /> : null}
            <Button variant="outline" size="sm" asChild>
              <Link to={`/bills/${latestBill.id}`}>{t('dashboard.allocation.viewBill')}</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {latestAllocation && latestAllocation.items.length > 0 ? (
            <ul className="flex flex-col divide-y divide-slate-100">
              {latestAllocation.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: colors.get(item.consumerId) ?? OTHER_COLOR }} aria-hidden />
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate font-medium text-slate-900">{item.consumerName}</span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="tabular">
                          {formatKwh(item.kwh)} kWh · {formatPercent(item.ratio)}
                        </span>
                        <ProvenanceBadge provenance={item.provenance} />
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="tabular font-semibold text-slate-900">{formatAriary(item.payableAmount, 0)}</p>
                    <p className="text-xs text-slate-500">{t('dashboard.col.payable')}</p>
                  </div>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 pt-3 font-semibold text-slate-900">
                <span>
                  {t('dashboard.total')} · <span className="tabular">{formatKwh(latestBill.electricityKwh)} kWh</span>
                </span>
                <span className="tabular">{formatAriary(totalPayable, 0)}</span>
              </li>
            </ul>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-slate-600">{t('dashboard.allocation.none')}</p>
              {can('allocation.calculate') ? (
                <Button asChild size="sm">
                  <Link to={`/bills/${latestBill.id}`}>{t('dashboard.allocation.calculate')}</Link>
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ConsumerKwhChart allocation={latestAllocation} colors={colors} />
        <StackedConsumerChart monthly={monthly} colors={colors} names={names} />
        <BuildingKwhChart monthly={monthly} />
        <MonthlyCostChart monthly={monthly} />
      </div>
    </>
  );
}
