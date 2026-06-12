import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { LibraryPage } from './pages/LibraryPage';
import { CharacterDetailPage } from './pages/CharacterDetailPage';
import { LorebooksPage } from './pages/LorebooksPage';
import { LorebookDetailPage } from './pages/LorebookDetailPage';
import { PersonasPage } from './pages/PersonasPage';
import { PersonaEditorPage } from './pages/PersonaEditorPage';
import { ImportsPage } from './pages/ImportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { useTheme } from './components/ui';

const navItems = [
  { to: '/', label: 'Library' },
  { to: '/lorebooks', label: 'Lorebooks' },
  { to: '/personas', label: 'Personas' },
  { to: '/imports', label: 'Imports' },
  { to: '/settings', label: 'Settings' },
];

export function App() {
  const [dark, toggleTheme] = useTheme();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <NavLink to="/" className="flex items-baseline">
            <span className="font-display text-xl font-medium text-accent-deep">Chartreuse</span>
          </NavLink>
          <nav className="flex flex-1 items-center gap-1 text-sm">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 transition-colors ${
                    isActive
                      ? 'bg-accent-soft text-accent-deep'
                      : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            onClick={toggleTheme}
            title="Toggle theme"
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm hover:border-accent/50"
          >
            {dark ? '☀️' : '🌙'}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/characters/:id" element={<CharacterDetailPage />} />
          <Route path="/lorebooks" element={<LorebooksPage />} />
          <Route path="/lorebooks/:id" element={<LorebookDetailPage />} />
          <Route path="/personas" element={<PersonasPage />} />
          <Route path="/personas/new" element={<PersonaEditorPage />} />
          <Route path="/personas/:id" element={<PersonaEditorPage />} />
          <Route path="/imports" element={<ImportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
