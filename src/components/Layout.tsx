import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useSesion } from '../lib/sesion';
import { puede, type Modulo } from '../lib/permisos';
import MenuOrganizacion from './MenuOrganizacion';

const ENLACES: { to: string; nombre: string; corto: string; modulo?: Modulo; icono: ReactNode }[] = [
  { to: '/', nombre: 'Inicio', corto: 'Inicio', icono: <path d="M4 11l8-7 8 7v9H4z" /> },
  { to: '/calendario', nombre: 'Calendario', corto: 'Calendario', modulo: 'calendario', icono: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></> },
  { to: '/workout-builder', nombre: 'Workout Builder', corto: 'Entreno', modulo: 'workout_builder', icono: <path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12" /> },
  { to: '/sports-science', nombre: 'Sports Science Hub', corto: 'Sports Science', modulo: 'sports_science', icono: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /> },
  { to: '/usuarios', nombre: 'Usuarios', corto: 'Usuarios', modulo: 'usuarios', icono: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" /></> },
];

// En el móvil, Ajustes y Plataforma van arriba para no saturar la barra de abajo.
const EXTRA = ['/ajustes', '/plataforma'];

export default function Layout({ children }: { children: ReactNode }) {
  const { perfil, permisos, esDueno, salir } = useSesion();
  const visibles = ENLACES.filter((e) => !e.modulo || (permisos && puede(permisos, e.modulo)));
  if (perfil?.es_admin) visibles.push({ to: '/ajustes', nombre: 'Ajustes', corto: 'Ajustes', icono: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></> });
  if (esDueno) visibles.push({ to: '/plataforma', nombre: 'Plataforma', corto: 'Plataforma', icono: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></> });
  return (
    <>
      <header className="topbar">
        <MenuOrganizacion />
        <nav className="topnav" aria-label="Principal">
          {visibles.map((e) => (
            <NavLink key={e.to} to={e.to} end={e.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{e.nombre}</NavLink>
          ))}
        </nav>
        <div className="user">
          {visibles.filter((e) => EXTRA.includes(e.to)).map((e) => (
            <NavLink key={e.to} to={e.to} className="solo-movil" style={{ color: '#fff', fontSize: 13 }}>{e.nombre}</NavLink>
          ))}
          <span>{perfil?.nombre}</span>
          <button type="button" onClick={salir}>Salir</button>
        </div>
      </header>
      <main className="page">{children}</main>
      <nav className="bottomnav" aria-label="Principal" style={{ ['--n' as string]: visibles.filter((e) => !EXTRA.includes(e.to)).length }}>
        {visibles.filter((e) => !EXTRA.includes(e.to)).map((e) => (
          <NavLink key={e.to} to={e.to} end={e.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{e.icono}</svg>
            {e.corto}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
