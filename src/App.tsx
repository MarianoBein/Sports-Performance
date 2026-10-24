import { Navigate, Route, Routes } from 'react-router-dom';
import { useSesion } from './lib/sesion';
import { puede, type Modulo } from './lib/permisos';
import Layout from './components/Layout';
import Entrar from './pages/Entrar';
import Alta from './pages/Alta';
import Inicio from './pages/Inicio';
import Proximamente from './pages/Proximamente';
import Usuarios from './pages/Usuarios';
import Plataforma from './pages/Plataforma';
import Calendario from './pages/Calendario';
import ExportarSemana from './pages/ExportarSemana';
import Ajustes from './pages/Ajustes';
import Wellness from './pages/Wellness';
import Rpe from './pages/Rpe';
import SportsScience from './pages/SportsScience';
import type { ReactNode } from 'react';

function Protegida({ children, modulo, soloDueno }: { children: ReactNode; modulo?: Modulo; soloDueno?: boolean }) {
  const { cargando, sesion, perfil, permisos, esDueno } = useSesion();
  if (cargando) return <p className="page muted">Cargando…</p>;
  if (!sesion) return <Navigate to="/entrar" replace />;
  if (soloDueno) return esDueno ? <Layout>{children}</Layout> : <Navigate to="/" replace />;
  if (!perfil) return <Navigate to="/alta?pendiente=1" replace />;
  if (modulo && permisos && !puede(permisos, modulo)) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<Entrar />} />
      <Route path="/alta" element={<Alta />} />
      <Route path="/" element={<Protegida><Inicio /></Protegida>} />
      <Route path="/calendario" element={<Protegida modulo="calendario"><Calendario /></Protegida>} />
      <Route path="/calendario/exportar" element={<Protegida modulo="calendario"><ExportarSemana /></Protegida>} />
      <Route path="/workout-builder" element={<Protegida modulo="workout_builder"><Proximamente titulo="Workout Builder" /></Protegida>} />
      <Route path="/sports-science" element={<Protegida modulo="sports_science"><SportsScience /></Protegida>} />
      <Route path="/wellness" element={<Protegida><Wellness /></Protegida>} />
      <Route path="/rpe" element={<Protegida><Rpe /></Protegida>} />
      <Route path="/usuarios" element={<Protegida modulo="usuarios"><Usuarios /></Protegida>} />
      <Route path="/ajustes" element={<Protegida modulo="usuarios"><Ajustes /></Protegida>} />
      <Route path="/plataforma" element={<Protegida soloDueno><Plataforma /></Protegida>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
