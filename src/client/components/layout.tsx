import { Building2, Gauge, LayoutDashboard, LogOut, Menu, Receipt, ScrollText, Settings, ShieldCheck, User, Users } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '@/auth/auth';
import { useCurrentBuilding } from '@/auth/building';
import { type MessageKey, useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Sheet } from './ui/dialog';
import { Select } from './ui/form';

type NavItem = { to: string; label: MessageKey; icon: ReactNode; end?: boolean };

function useNavItems() {
  const { isSuperadmin } = useAuth();
  const { can } = useCurrentBuilding();
  const main: NavItem[] = [
    { to: '/', label: 'nav.dashboard', icon: <LayoutDashboard />, end: true },
    { to: '/bills', label: 'nav.bills', icon: <Receipt /> },
    { to: '/readings', label: 'nav.readings', icon: <Gauge /> },
  ];
  const secondary: NavItem[] = [];
  if (can('building.update') || can('consumer.manage') || can('meter.manage') || can('building.manage_members')) {
    secondary.push({ to: '/building', label: 'nav.building', icon: <Building2 /> });
  }
  if (isSuperadmin) {
    secondary.push({ to: '/admin/users', label: 'nav.users', icon: <Users /> });
    secondary.push({ to: '/admin/settings', label: 'nav.settings', icon: <Settings /> });
  }
  if (can('audit.read')) secondary.push({ to: '/admin/audit', label: 'nav.audit', icon: <ScrollText /> });
  secondary.push({ to: '/account', label: 'nav.account', icon: <User /> });
  return { main, secondary };
}

function BuildingSwitcher({ className }: { className?: string }) {
  const t = useT();
  const { memberships } = useAuth();
  const { buildingId, membership, setBuildingId } = useCurrentBuilding();
  if (memberships.length === 0) return <p className={cn('text-sm text-slate-500', className)}>{t('nav.noBuilding')}</p>;
  if (memberships.length === 1) return <p className={cn('truncate text-sm font-medium text-slate-800', className)}>{membership?.buildingName}</p>;
  return (
    <Select aria-label={t('nav.switchBuilding')} value={buildingId ?? ''} onChange={(e) => setBuildingId(e.target.value)} className={cn('h-9', className)}>
      {memberships.map((m) => (
        <option key={m.buildingId} value={m.buildingId}>
          {m.buildingName}
        </option>
      ))}
    </Select>
  );
}

function NavLinkItem({ item, onNavigate, compact }: { item: NavItem; onNavigate?: () => void; compact?: boolean }) {
  const t = useT();
  return (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg text-sm font-medium transition-colors [&_svg]:size-5',
          compact ? 'flex-col justify-center gap-1 py-2 text-[11px]' : 'px-3 py-2',
          isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        )
      }
    >
      {item.icon}
      <span>{t(item.label)}</span>
    </NavLink>
  );
}

function Logo() {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="font-semibold text-slate-900">{t('app.name')}</span>
    </div>
  );
}

/** Mise en page : barre latérale sur ordinateur, barre d'onglets en bas sur mobile. */
export function AppLayout() {
  const t = useT();
  const navigate = useNavigate();
  const { user, logout, isSuperadmin } = useAuth();
  const { main, secondary } = useNavItems();
  const [menuOpen, setMenuOpen] = useState(false);

  const onLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-dvh md:flex">
      <aside className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-4 border-r border-slate-200 bg-white p-4 md:flex">
        <Logo />
        <BuildingSwitcher />
        <nav className="flex flex-col gap-1">
          {main.map((item) => (
            <NavLinkItem key={item.to} item={item} />
          ))}
        </nav>
        <nav className="flex flex-col gap-1 border-t border-slate-100 pt-3">
          {secondary.map((item) => (
            <NavLinkItem key={item.to} item={item} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-slate-100 pt-3">
          <p className="truncate text-xs text-slate-500">
            {isSuperadmin ? <ShieldCheck className="mr-1 inline size-3.5" /> : null}
            {user?.name}
          </p>
          <button type="button" onClick={() => void onLogout()} className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <LogOut className="size-4" /> {t('nav.logout')}
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:hidden">
          <Logo />
          <BuildingSwitcher className="max-w-[45%]" />
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-5 pb-28 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>

      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
        {main.map((item) => (
          <NavLinkItem key={item.to} item={item} compact />
        ))}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium text-slate-600 [&_svg]:size-5"
        >
          <Menu />
          <span>Menu</span>
        </button>
      </nav>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title={user?.name ?? t('app.name')}>
        <nav className="flex flex-col gap-1">
          {secondary.map((item) => (
            <NavLinkItem key={item.to} item={item} onNavigate={() => setMenuOpen(false)} />
          ))}
          <button
            type="button"
            onClick={() => void onLogout()}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 [&_svg]:size-5"
          >
            <LogOut /> {t('nav.logout')}
          </button>
        </nav>
      </Sheet>
    </div>
  );
}
