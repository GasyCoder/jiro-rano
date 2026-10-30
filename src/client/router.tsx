import { type ComponentType, lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import { RequireAuth, RequireSuperadmin } from '@/auth/auth';
import { BuildingProvider } from '@/auth/building';
import { AppLayout } from '@/components/layout';
import { Spinner } from '@/components/ui/feedback';
import ChangePasswordPage from '@/pages/ChangePasswordPage';
import LoginPage from '@/pages/LoginPage';

/** Chaque page est chargée à la demande : le premier affichage reste léger sur mobile. */
function page(loader: () => Promise<{ default: ComponentType }>) {
  const Component = lazy(loader);
  return (
    <Suspense fallback={<Spinner />}>
      <Component />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/change-password', element: <ChangePasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/report/:allocationId', element: page(() => import('@/pages/bills/ReportPage')) },
      {
        element: (
          <BuildingProvider>
            <AppLayout />
          </BuildingProvider>
        ),
        children: [
          { index: true, element: page(() => import('@/pages/dashboard/DashboardPage')) },
          { path: 'bills', element: page(() => import('@/pages/bills/BillsPage')) },
          { path: 'bills/new', element: page(() => import('@/pages/bills/NewBillPage')) },
          { path: 'bills/:billId', element: page(() => import('@/pages/bills/BillDetailPage')) },
          { path: 'readings', element: page(() => import('@/pages/readings/ReadingsPage')) },
          { path: 'building', element: page(() => import('@/pages/building/BuildingPage')) },
          { path: 'account', element: page(() => import('@/pages/AccountPage')) },
          { path: 'admin/audit', element: page(() => import('@/pages/admin/AuditPage')) },
          {
            element: <RequireSuperadmin />,
            children: [
              { path: 'buildings/new', element: page(() => import('@/pages/building/BuildingCreatePage')) },
              { path: 'admin/users', element: page(() => import('@/pages/admin/UsersPage')) },
              { path: 'admin/settings', element: page(() => import('@/pages/admin/SettingsPage')) },
            ],
          },
          { path: '*', element: page(() => import('@/pages/NotFoundPage')) },
        ],
      },
    ],
  },
]);
