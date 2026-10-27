import { NavLink, Outlet, useNavigate } from 'react-router';
import { useIntegrations, useLogout } from '../api/hooks';
import { Button } from './ui';

const links = [
  { to: '/guilds', label: 'Servers' },
  { to: '/roles', label: 'Roles' },
  { to: '/boards', label: 'Boards' },
  { to: '/notifications', label: 'Notifications' },
  { to: '/settings', label: 'Settings' },
];

function IntegrationDot() {
  const q = useIntegrations();
  let color = 'bg-gray-300';
  let title = 'Checking integrations…';
  if (q.data) {
    const ok = q.data.trello.ok && q.data.discord.ok;
    color = ok ? 'bg-green-500' : 'bg-red-500';
    title = ok
      ? `Trello: ${q.data.trello.username ?? 'ok'} · Discord bot: ${q.data.discord.botUsername ?? 'ok'}`
      : [
          q.data.trello.ok ? null : `Trello: ${q.data.trello.error}`,
          q.data.discord.ok ? null : `Discord: ${q.data.discord.error}`,
        ]
          .filter(Boolean)
          .join('\n');
  } else if (q.isError) {
    color = 'bg-red-500';
    title = 'Could not load integration status';
  }
  return (
    <NavLink
      to="/settings"
      title={title}
      className="flex items-center gap-1.5 text-xs text-gray-500"
    >
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
      <span className="hidden sm:inline">integrations</span>
    </NavLink>
  );
}

export function Layout() {
  const logout = useLogout();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <NavLink to="/boards" className="mr-2 text-base font-bold text-indigo-700">
            Discrello
          </NavLink>
          <nav className="flex flex-wrap items-center gap-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `rounded-md px-2.5 py-1 text-sm font-medium ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <IntegrationDot />
            <Button
              size="sm"
              variant="ghost"
              busy={logout.isPending}
              onClick={() =>
                logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })
              }
            >
              Logout
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
