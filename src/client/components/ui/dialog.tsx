import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/** Fenêtre modale centrée (bureau) / plein écran bas (mobile). */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-white shadow-xl focus:outline-none',
            'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4">
            <div className="flex flex-col gap-1">
              <DialogPrimitive.Title className="text-base font-semibold text-slate-900">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-sm text-slate-500">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Fermer">
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          <div className="overflow-y-auto p-4">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Panneau latéral (bureau) / tiroir bas (mobile), pour la simulation ou un formulaire long. */
export function Sheet({ open, onOpenChange, title, description, children, footer, className }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-white shadow-xl focus:outline-none',
            'md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-full md:max-w-xl md:rounded-none md:rounded-l-2xl',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4">
            <div className="flex flex-col gap-1">
              <DialogPrimitive.Title className="text-base font-semibold text-slate-900">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-sm text-slate-500">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Fermer">
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
