import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSesion } from '../lib/sesion';
import { supabase, mensajeError } from '../lib/supabase';
import { TIPOS, cargarActividades, fechaLarga, hora, hoyIso, titulo, type Actividad } from '../lib/calendario';
import { puede } from '../lib/permisos';

function esIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function instalada() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export default function Inicio() {
  const { perfil, permisos } = useSesion();
  const [hoy, setHoy] = useState<Actividad[]>([]);
  const [pendientes, setPendientes] = useState<Actividad[]>([]);
  const [error, setError] = useState('');
  const conCalendario = !!permisos && puede(permisos, 'calendario');

  const cargar = useCallback(async () => {
    if (!perfil || !conCalendario) return;
    try {
      const d = hoyIso();
      setHoy(await cargarActividades(d, d));
      const { data } = await supabase.from('actividad_confirmaciones')
        .select('actividad_id').eq('perfil_id', perfil.id).eq('estado', 'pendiente');
      const ids = (data ?? []).map((x: { actividad_id: string }) => x.actividad_id);
      if (ids.length) {
        const { data: acts } = await supabase.from('actividades')
          .select('*, destinos:actividad_destinos(tipo,ref), confirmaciones:actividad_confirmaciones(perfil_id,estado,respondido_en)')
          .in('id', ids).is('eliminado_en', null).gte('fecha', d).order('fecha');
        setPendientes((acts as Actividad[]) ?? []);
      } else setPendientes([]);
    } catch (e) { setError(mensajeError(e)); }
  }, [perfil, conCalendario]);
  useEffect(() => { cargar(); }, [cargar]);

  async function responder(id: string, estado: 'acepta' | 'no_puede') {
    const { error } = await supabase.rpc('responder_actividad', { p_id: id, p_estado: estado });
    if (error) setError(mensajeError(error)); else cargar();
  }

  if (!perfil) return null;
  const nombre = perfil.nombre.split(' ')[0];
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div>
        <p className="muted small" style={{ margin: '0 0 4px' }}>{perfil.club.nombre} · {perfil.rol.nombre}{perfil.es_admin ? ' · Administrador' : ''}</p>
        <h1 className="display" style={{ fontSize: 40 }}>Hola, {nombre}</h1>
      </div>

      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}

      {pendientes.map((a) => (
        <div key={a.id} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: 'inset 3px 0 0 #E07A1F, 0 1px 2px rgba(22,24,29,.06)' }}>
          <span className="small" style={{ fontWeight: 600, color: 'var(--warn-fg)' }}>Prensa espera tu confirmación</span>
          <span style={{ fontSize: 17, fontWeight: 600 }}>{titulo(a)}</span>
          <span className="small muted">{fechaLarga(a.fecha)} · {a.todo_el_dia ? 'Todo el día' : hora(a.hora_inicio)}{a.lugar ? ` · ${a.lugar}` : ''}</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type="button" className="btn" onClick={() => responder(a.id, 'no_puede')}>No puedo</button>
            <button type="button" className="btn btn-dark" onClick={() => responder(a.id, 'acepta')}>Aceptar</button>
          </div>
        </div>
      ))}

      {conCalendario && (
        <section className="stack" style={{ gap: 8 }} aria-label="Hoy">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Hoy · {fechaLarga(hoyIso())}</h2>
            <Link to="/calendario" className="small" style={{ fontWeight: 600 }}>Ver calendario</Link>
          </div>
          {hoy.length === 0 && <div className="card muted small" style={{ padding: 14 }}>No hay actividades hoy.</div>}
          {hoy.map((a) => (
            <Link key={a.id} to="/calendario" className="card" style={{ padding: 14, textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: TIPOS[a.tipo].color }}>{a.todo_el_dia ? 'Todo el día' : hora(a.hora_inicio)} · {TIPOS[a.tipo].nombre}{a.lugar ? ` · ${a.lugar}` : ''}</span>
              <span style={{ fontSize: 17, fontWeight: 600 }}>{titulo(a)}</span>
            </Link>
          ))}
        </section>
      )}

      {!instalada() && (
        <div className="card" style={{ padding: 16 }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Instala la app en tu teléfono</h2>
          {esIOS() ? (
            <p className="small" style={{ margin: 0, lineHeight: 1.5 }}>En Safari, toca el botón <strong>Compartir</strong> (el cuadrado con la flecha) y luego <strong>«Añadir a pantalla de inicio»</strong>.</p>
          ) : (
            <p className="small" style={{ margin: 0, lineHeight: 1.5 }}>En Chrome, toca el menú <strong>⋮</strong> y luego <strong>«Instalar app»</strong> o <strong>«Añadir a pantalla de inicio»</strong>.</p>
          )}
        </div>
      )}
    </div>
  );
}
