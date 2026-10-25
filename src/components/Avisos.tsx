import { useEffect, useState } from 'react';
import { activarAvisos, desactivarAvisos, estadoAvisos, type EstadoAvisos } from '../lib/avisos';
import { mensajeError } from '../lib/supabase';

// Tarjeta para que el jugador active los avisos de wellness y RPE en su celular.
export default function TarjetaAvisos({ compacta = false }: { compacta?: boolean }) {
  const [estado, setEstado] = useState<EstadoAvisos | null>(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { estadoAvisos().then(setEstado).catch(() => setEstado('no-soportado')); }, []);
  if (!estado || estado === 'no-soportado') return null;
  if (compacta && (estado === 'activos' || estado === 'instalar-primero')) return null;

  async function activar() {
    setOcupado(true); setError('');
    try { setEstado(await activarAvisos()); } catch (e) { setError(mensajeError(e as Error)); } finally { setOcupado(false); }
  }

  return (
    <div className="card stack" style={{ padding: 16, gap: 8, boxShadow: estado === 'activos' ? undefined : 'inset 4px 0 0 #1D5BD8, 0 1px 2px rgba(22,24,29,.06)' }}>
      <strong>Avisos en el celular</strong>
      {estado === 'activos' && (
        <>
          <span className="small">Activados en este dispositivo: te avisamos cuando toca el wellness y el RPE.</span>
          <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} disabled={ocupado}
            onClick={async () => { setOcupado(true); await desactivarAvisos().catch(() => {}); setEstado('apagados'); setOcupado(false); }}>Desactivar</button>
        </>
      )}
      {estado === 'apagados' && (
        <>
          <span className="small">Activalos y te avisamos cuando toca contestar el wellness y el RPE.</span>
          <button type="button" className="btn btn-primary" disabled={ocupado} onClick={activar}>{ocupado ? 'Activando…' : 'Activar avisos'}</button>
        </>
      )}
      {estado === 'instalar-primero' && (
        <span className="small">En iPhone, primero agregá la app a la pantalla de inicio: tocá <strong>Compartir</strong> (el cuadrado con la flecha) → <strong>Agregar a inicio</strong>. Después abrila desde ese ícono y activá los avisos acá.</span>
      )}
      {estado === 'bloqueados' && (
        <span className="small">Los avisos están bloqueados para esta app. Activalos desde la configuración del celular (Notificaciones) y volvé a entrar.</span>
      )}
      {estado === 'sin-configurar' && <span className="small muted">Los avisos todavía no están configurados en el club. Avisale a tu preparador físico.</span>}
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
