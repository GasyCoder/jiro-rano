import { cn } from '@/lib/utils';

/** Onglets simples (boutons) : défilables horizontalement sur mobile. */
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (value: T) => void; items: { value: T; label: string }[]; className?: string }) {
  return (
    <div className={cn('-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1', className)} role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={item.value === value}
          onClick={() => onChange(item.value)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
            item.value === value ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
