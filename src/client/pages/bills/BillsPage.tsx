import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus, Receipt } from 'lucide-react';
import { Link } from 'react-router';
import type { BillDto } from '@shared/api';
import { useCurrentBuilding } from '@/auth/building';
import { AllocationStatusBadge, CalculationStatusBadge } from '@/components/badges';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, PageHeader, Spinner } from '@/components/ui/feedback';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { formatAriary, formatBillMonth, formatKwh, formatPeriod } from '@/lib/format';
import { queryKeys } from '@/lib/query';

function BillCard({ bill }: { bill: BillDto }) {
  const t = useT();
  return (
    <li>
      <Link
        to={`/bills/${bill.id}`}
        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-200 hover:bg-brand-50/40"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
          <div className="min-w-0 sm:w-56">
            <p className="font-semibold text-slate-900 capitalize">{formatBillMonth(bill.periodEnd)}</p>
            <p className="text-sm text-slate-500">{formatPeriod(bill.periodStart, bill.periodEnd)}</p>
          </div>
          <div className="tabular flex gap-6 text-sm sm:w-64">
            <div>
              <p className="text-xs text-slate-500">{t('bills.detail.kwh')}</p>
              <p className="font-medium">{formatKwh(bill.electricityKwh)} kWh</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('bills.detail.total')}</p>
              <p className="font-medium">{formatAriary(bill.totalAmount)}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <CalculationStatusBadge status={bill.calculationStatus} />
            {bill.currentAllocation ? (
              <>
                <span className="text-xs text-slate-500">{t('bills.list.allocation', { version: bill.currentAllocation.version })}</span>
                <AllocationStatusBadge status={bill.currentAllocation.status} />
              </>
            ) : (
              <span className="text-xs text-slate-500">{t('bills.list.noAllocation')}</span>
            )}
          </div>
        </div>
        <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden />
      </Link>
    </li>
  );
}

export default function BillsPage() {
  const t = useT();
  const { buildingId, can } = useCurrentBuilding();
  const billsQuery = useQuery({
    queryKey: queryKeys.bills(buildingId ?? 'none'),
    queryFn: () => api<BillDto[]>(`/api/buildings/${buildingId}/bills`),
    enabled: Boolean(buildingId),
  });

  const newBill = can('bill.write') ? (
    <Button asChild>
      <Link to="/bills/new">
        <Plus /> {t('bills.list.new')}
      </Link>
    </Button>
  ) : null;

  if (!buildingId) return <EmptyState icon={<Receipt />} title={t('bills.list.noBuilding')} />;

  return (
    <>
      <PageHeader title={t('bills.list.title')} description={t('bills.list.description')} actions={newBill} />
      {billsQuery.isLoading ? (
        <Spinner />
      ) : billsQuery.isError ? (
        <Alert variant="error" title={t('state.error')}>
          {errorMessage(billsQuery.error)}
        </Alert>
      ) : billsQuery.data && billsQuery.data.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {billsQuery.data.map((bill) => (
            <BillCard key={bill.id} bill={bill} />
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Receipt />} title={t('bills.list.empty')} description={t('bills.list.emptyHint')} action={newBill} />
      )}
    </>
  );
}
