import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Indicateur : libellé, valeur (chiffres proportionnels), évolution signée vs une période nommée.
 * Pour une facture, une hausse est défavorable : flèche rouge vers le haut, verte vers le bas.
 */
export function StatTile({
  label,
  value,
  sub,
  delta,
  deltaLabel,
  badge,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  badge?: ReactNode;
}) {
  const Icon = delta == null || delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  return (
    <Card className="flex flex-col gap-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {badge}
      </div>
      <p className="text-xl font-semibold text-slate-900 sm:text-2xl">{value}</p>
      {delta !== undefined ? (
        <p className="flex items-center gap-1 text-xs text-slate-600">
          <Icon
            className={cn('size-3.5 shrink-0', delta == null || delta === 0 ? 'text-slate-400' : delta > 0 ? 'text-red-600' : 'text-emerald-600')}
            aria-hidden
          />
          {delta == null ? deltaLabel : `${delta > 0 ? '+' : ''}${formatNumber(delta, 1)} % ${deltaLabel ?? ''}`}
        </p>
      ) : null}
      {sub ? <p className="text-xs text-slate-500">{sub}</p> : null}
    </Card>
  );
}
