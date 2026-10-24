import { Navigate, Route, Routes } from 'react-router-dom';
import { useSesion } from './lib/sesion';
import { puede, type Modulo } from './lib/permisos';
import Layout from './components/Layout';
import Entrar from './pages/Entrar';
import Alta from './pages/Alta';
import Inicio from './pages/Inicio';
import Proximamente from './pages/Proximamente';
import Usuarios from './pages/Usuarios';
import type { ReactNode } from 'react';

function Protegida({ children, modulo }: { children: ReactNode; modulo?: Modulo }) {
  const { cargando, sesion, perfil, permisos } = useSesion();
  if (cargando) return <p className="page muted">Cargando…</p>;
  if (!sesion) return <Navigate to="/entrar" replace />;
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
      <Route path="/calendario" element={<Protegida modulo="calendario"><Proximamente titulo="Calendario" /></Protegida>} />
      <Route path="/workout-builder" element={<Protegida modulo="workout_builder"><Proximamente titulo="Workout Builder" /></Protegida>} />
      <Route path="/sports-science" element={<Protegida modulo="sports_science"><Proximamente titulo="Sports Science Hub" /></Protegida>} />
      <Route path="/usuarios" element={<Protegida modulo="usuarios"><Usuarios /></Protegida>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
