import { NavLink, Outlet } from 'react-router-dom';

const navItem =
  'px-3 py-2 rounded-md text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <span className="text-base font-semibold tracking-tight">FeatureMap</span>
          <nav className="flex items-center gap-1">
            <NavLink to="/" className={navItem} end>
              概览
            </NavLink>
            <NavLink to="/features" className={navItem}>
              功能
            </NavLink>
            <NavLink to="/changes" className={navItem}>
              变更
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
