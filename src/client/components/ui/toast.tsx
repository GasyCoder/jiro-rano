import { CheckCircle2, XCircle } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

type Toast = { id: number; message: string; variant: 'success' | 'error' };
type ToastApi = { success: (message: string) => void; error: (message: string) => void };

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, variant: Toast['variant']) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, message, variant }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), variant === 'error' ? 7000 : 4000);
  }, []);
  const api = useMemo<ToastApi>(() => ({ success: (m) => push(m, 'success'), error: (m) => push(m, 'error') }), [push]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex max-w-md items-start gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg',
              toast.variant === 'success' ? 'bg-slate-900' : 'bg-red-700',
            )}
          >
            {toast.variant === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast doit être utilisé dans ToastProvider');
  return context;
}
