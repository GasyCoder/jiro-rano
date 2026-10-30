import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';
import { Field, Textarea } from './form';

type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** Exige une justification écrite (enregistrée dans l'audit). */
  requireReason?: boolean;
  reasonLabel?: string;
};

type ConfirmResult = { confirmed: boolean; reason: string };
type ConfirmFn = (options: ConfirmOptions) => Promise<ConfirmResult>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Confirmation explicite des actions importantes (validation, suppression, correction). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [reason, setReason] = useState('');
  const resolver = useRef<((result: ConfirmResult) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    setReason('');
    setOptions(next);
    return new Promise<ConfirmResult>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (confirmed: boolean) => {
    resolver.current?.({ confirmed, reason: reason.trim() });
    resolver.current = null;
    setOptions(null);
  };

  const reasonMissing = Boolean(options?.requireReason) && reason.trim().length < 3;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={options !== null}
        onOpenChange={(open) => !open && close(false)}
        title={options?.title ?? ''}
        description={options?.description}
        footer={
          <>
            <Button variant="outline" onClick={() => close(false)}>
              Annuler
            </Button>
            <Button variant={options?.destructive ? 'destructive' : 'default'} disabled={reasonMissing} onClick={() => close(true)}>
              {options?.confirmLabel ?? 'Confirmer'}
            </Button>
          </>
        }
      >
        {options?.requireReason ? (
          <Field label={options.reasonLabel ?? 'Raison (enregistrée dans le journal)'} htmlFor="confirm-reason">
            <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={500} />
          </Field>
        ) : (
          <p className="text-sm text-slate-600">Cette action sera enregistrée dans le journal d’audit.</p>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm doit être utilisé dans ConfirmProvider');
  return context;
}
