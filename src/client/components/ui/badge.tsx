import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      neutral: 'border-slate-200 bg-slate-100 text-slate-700',
      measured: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      prorated: 'border-sky-200 bg-sky-50 text-sky-800',
      estimated: 'border-amber-300 bg-amber-50 text-amber-900',
      manual: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800',
      computed: 'border-indigo-200 bg-indigo-50 text-indigo-800',
      validated: 'border-brand-200 bg-brand-50 text-brand-800',
      warning: 'border-amber-300 bg-amber-50 text-amber-900',
      danger: 'border-red-200 bg-red-50 text-red-700',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
