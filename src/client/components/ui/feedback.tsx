import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const ALERT_STYLES = {
  info: { box: 'border-sky-200 bg-sky-50 text-sky-900', icon: Info },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: CheckCircle2 },
  warning: { box: 'border-amber-300 bg-amber-50 text-amber-950', icon: AlertTriangle },
  error: { box: 'border-red-200 bg-red-50 text-red-900', icon: XCircle },
} as const;

export function Alert({ variant = 'info', title, children, className }: { variant?: keyof typeof ALERT_STYLES; title?: ReactNode; children?: ReactNode; className?: string }) {
  const { box, icon: Icon } = ALERT_STYLES[variant];
  return (
    <div className={cn('flex gap-3 rounded-lg border p-3 text-sm', box, className)} role={variant === 'error' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-sm/relaxed">{children}</div> : null}
      </div>
    </div>
  );
}

export function Spinner({ className, label = 'Chargement…' }: { className?: string; label?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-10 text-sm text-slate-500', className)} role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center', className)}>
      {icon ? <div className="text-slate-400 [&_svg]:size-8">{icon}</div> : null}
      <p className="font-medium text-slate-800">{title}</p>
      {description ? <p className="max-w-md text-sm text-slate-500">{description}</p> : null}
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        {back}
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {description ? <p className="text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
