import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { AuthProvider } from '@/auth/auth';
import { ConfirmProvider } from '@/components/ui/confirm';
import { ToastProvider } from '@/components/ui/toast';
import { queryClient } from '@/lib/query';
import { router } from '@/router';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Élément #root introuvable');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
