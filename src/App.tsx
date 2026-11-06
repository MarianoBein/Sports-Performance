import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSesion } from './lib/sesion';
import { puede, type Modulo } from './lib/permisos';
import Layout from './components/Layout';
import Entrar from './pages/Entrar';
import Alta from './pages/Alta';
import Inicio from './pages/Inicio';
import WorkoutBuilder from './pages/WorkoutBuilder';
import Usuarios from './pages/Usuarios';
import Plataforma from './pages/Plataforma';
import Calendario from './pages/Calendario';
import ExportarSemana from './pages/ExportarSemana';
import Ajustes from './pages/Ajustes';
import Wellness from './pages/Wellness';
import Rpe from './pages/Rpe';
import SportsScience from './pages/SportsScience';
import CambiarClave from './pages/CambiarClave';
import type { ReactNode } from 'react';

// No se pudo leer el perfil (señal, sesión renovándose): reintentar, nunca pedir el código.
function SinConexion() {
  const { recargar } = useSesion();
  const [ocupado, setOcupado] = useState(false);
  return (
    <div className="page stack" style={{ maxWidth: 420, margin: '0 auto', paddingTop: 80, textAlign: 'center', alignItems: 'center' }}>
      <h1 className="display" style={{ fontSize: 30, margin: 0 }}>No pudimos conectar</h1>
      <p className="muted small" style={{ margin: 0 }}>Revisá la señal o el wifi. Tus datos están bien: no hace falta ningún código.</p>
      <button type="button" className="btn btn-primary" disabled={ocupado} onClick={async () => { setOcupado(true); await recargar(); setOcupado(false); }}>
        {ocupado ? 'Reintentando…' : 'Reintentar'}
      </button>
    </div>
  );
}

function Protegida({ children, modulo, soloDueno }: { children: ReactNode; modulo?: Modulo; soloDueno?: boolean }) {
  const { cargando, errorCarga, sesion, perfil, permisos, esDueno } = useSesion();
  if (cargando) return <p className="page muted">Cargando…</p>;
  if (!sesion) return <Navigate to="/entrar" replace />;
  if (!perfil && errorCarga) return <SinConexion />;
  if (soloDueno) return esDueno ? <Layout>{children}</Layout> : <Navigate to="/" replace />;
  if (!perfil) return <Navigate to="/alta?pendiente=1" replace />;
  if (perfil.debe_cambiar_clave) return <CambiarClave />;
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
      <Route path="/workout-builder" element={<Protegida modulo="workout_builder"><WorkoutBuilder /></Protegida>} />
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
