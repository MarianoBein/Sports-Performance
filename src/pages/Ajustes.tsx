import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSesion } from '../lib/sesion';
import { supabase, mensajeError } from '../lib/supabase';

const TIPOS_OK = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

function Escudo({ titulo, url, onElegir, onQuitar, subiendo }: {
  titulo: string; url: string | null; subiendo: boolean; onElegir: (f: File) => void; onQuitar: () => void;
}) {
  const id = `escudo-${titulo.replace(/\s+/g, '-')}`;
  return (
    <div className="card" style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ width: 96, height: 96, flex: 'none', borderRadius: 12, background: 'var(--bg)', border: '1px dashed var(--field)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {url ? <img src={url} alt={titulo} style={{ maxWidth: 84, maxHeight: 84, objectFit: 'contain' }} /> : <span className="xs muted">Sin escudo</span>}
      </div>
      <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <strong style={{ fontSize: 15 }}>{titulo}</strong>
        <span className="xs muted">PNG con fondo transparente, cuadrado (ideal 512 × 512 px), máximo 1 MB.</span>
        <div className="row" style={{ gap: 8 }}>
          <label htmlFor={id} className="btn btn-sm" style={{ cursor: 'pointer' }}>{subiendo ? 'Subiendo…' : url ? 'Cambiar' : 'Subir escudo'}</label>
          <input id={id} type="file" accept={TIPOS_OK.join(',')} className="sr-only" disabled={subiendo}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onElegir(f); e.target.value = ''; }} />
          {url && <button type="button" className="btn btn-sm btn-ghost link-danger" onClick={onQuitar}>Quitar</button>}
        </div>
      </div>
    </div>
  );
}

export default function Ajustes() {
  const { perfil, recargar } = useSesion();
  const [sede, setSede] = useState(perfil?.club.sede_local ?? '');
  const [temporada, setTemporada] = useState(perfil?.club.temporada ?? '');
  const [logoClub, setLogoClub] = useState<string | null>(perfil?.club.logo_club_url ?? null);
  const [logoLiga, setLogoLiga] = useState<string | null>(perfil?.club.logo_liga_url ?? null);
  const [subiendo, setSubiendo] = useState<'club' | 'liga' | null>(null);
  const [wModo, setWModo] = useState(perfil?.club.wellness_modo ?? 'todos');
  const [rModo, setRModo] = useState(perfil?.club.rpe_modo ?? 'todos');
  const [retraso, setRetraso] = useState(perfil?.club.rpe_retraso_min ?? 30);
  const [horaAviso, setHoraAviso] = useState((perfil?.club.hora_aviso_wellness ?? '09:00').slice(0, 5));
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [gps, setGps] = useState(!!perfil?.club.fuentes?.gps);
  const [fuerza, setFuerza] = useState(!!perfil?.club.fuentes?.fuerza);

  if (!perfil) return null;
  if (!perfil.es_admin) return <Navigate to="/" replace />;

  async function guardar(cambios?: { club?: string | null; liga?: string | null }) {
    const club = cambios && 'club' in cambios ? cambios.club ?? null : logoClub;
    const liga = cambios && 'liga' in cambios ? cambios.liga ?? null : logoLiga;
    const { error } = await supabase.rpc('actualizar_club', { p_sede: sede, p_temporada: temporada, p_logo_club: club, p_logo_liga: liga });
    if (error) { setAviso({ ok: false, texto: mensajeError(error) }); return false; }
    await recargar();
    setAviso({ ok: true, texto: 'Guardado.' });
    return true;
  }

  async function subir(cual: 'club' | 'liga', f: File) {
    setAviso(null);
    if (!TIPOS_OK.includes(f.type)) { setAviso({ ok: false, texto: 'El archivo tiene que ser PNG, JPG, WebP o SVG.' }); return; }
    if (f.size > 1024 * 1024) { setAviso({ ok: false, texto: 'El archivo pesa más de 1 MB. Prueba con una versión más liviana.' }); return; }
    setSubiendo(cual);
    const ext = f.name.split('.').pop()?.toLowerCase() || 'png';
    const ruta = `${perfil!.club_id}/${cual}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('logos').upload(ruta, f, { contentType: f.type, upsert: true });
    if (error) { setSubiendo(null); setAviso({ ok: false, texto: mensajeError(error) }); return; }
    const url = supabase.storage.from('logos').getPublicUrl(ruta).data.publicUrl;
    if (cual === 'club') setLogoClub(url); else setLogoLiga(url);
    await guardar(cual === 'club' ? { club: url } : { liga: url });
    setSubiendo(null);
  }

  async function quitar(cual: 'club' | 'liga') {
    if (cual === 'club') setLogoClub(null); else setLogoLiga(null);
    await guardar(cual === 'club' ? { club: null } : { liga: null });
  }

  return (
    <div className="stack" style={{ maxWidth: 820, margin: '0 auto', width: '100%' }}>
      <div>
        <p className="muted small" style={{ margin: '0 0 4px' }}>{perfil.club.nombre} · solo administradores del club</p>
        <h1 className="display" style={{ fontSize: 38 }}>Ajustes del club</h1>
      </div>

      <section className="stack" style={{ gap: 10 }} aria-label="Escudos">
        <h2 style={{ margin: 0, fontSize: 16 }}>Escudos</h2>
        <p className="small muted" style={{ margin: 0 }}>Aparecen en el PDF de la semana: el del club a la izquierda y el de la liga a la derecha.</p>
        <Escudo titulo="Escudo del club" url={logoClub} subiendo={subiendo === 'club'} onElegir={(f) => subir('club', f)} onQuitar={() => quitar('club')} />
        <Escudo titulo="Escudo de la liga" url={logoLiga} subiendo={subiendo === 'liga'} onElegir={(f) => subir('liga', f)} onQuitar={() => quitar('liga')} />
      </section>

      <section className="card stack" style={{ padding: 16, gap: 12 }} aria-label="Datos del club">
        <h2 style={{ margin: 0, fontSize: 16 }}>Datos para el PDF</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label className="field"><span>Lugar habitual (local)</span>
            <input className="input" value={sede} onChange={(e) => setSede(e.target.value)} placeholder="Pabellón, gimnasio…" />
          </label>
          <label className="field"><span>Temporada</span>
            <input className="input" value={temporada} onChange={(e) => setTemporada(e.target.value)} placeholder="26/27" />
          </label>
        </div>
        <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => guardar()}>Guardar</button>
      </section>

      <section className="card stack" style={{ padding: 16, gap: 12 }} aria-label="Cuestionarios">
        <h2 style={{ margin: 0, fontSize: 16 }}>Cuestionarios de los jugadores</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {([['Wellness', wModo, setWModo], ['RPE', rModo, setRModo]] as const).map(([t, v, set]) => (
            <label key={t} className="field"><span>{t}</span>
              <select className="select" value={v} onChange={(e) => set(e.target.value)}>
                <option value="todos">Todos los días</option>
                <option value="con_actividad">Solo días con actividad</option>
                <option value="no">No activo</option>
              </select>
            </label>
          ))}
          <label className="field"><span>El RPE aparece</span>
            <select className="select" value={retraso} onChange={(e) => setRetraso(Number(e.target.value))}>
              {Array.from({ length: 25 }, (_, i) => i * 5).map((m) => (
                <option key={m} value={m}>{m === 0 ? 'Al terminar la última actividad' : `${m} min después de la última actividad`}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="field" style={{ maxWidth: 260 }}><span>Aviso de wellness al celular</span>
          <input id="aj-hora-aviso" type="time" className="input" value={horaAviso} onChange={(e) => setHoraAviso(e.target.value)} />
        </label>
        <p className="xs muted" style={{ margin: 0 }}>A esa hora le llega «Contestá tu wellness» a quien todavía no respondió. El aviso del RPE sale solo cuando se habilita (los minutos de arriba después de la última actividad).</p>
        <p className="xs muted" style={{ margin: 0 }}>«Días con actividad»: cuando el jugador tiene una actividad deportiva ese día. Un día concreto (por ejemplo, el de partido) se puede marcar como «no aplica» desde el Workout Builder (tocando Wellness o RPE en ese día) o desde el Sports Science Hub.</p>
        <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={async () => {
          const { error } = await supabase.rpc('actualizar_recurrencia', { p_wellness: wModo, p_rpe: rModo, p_retraso: retraso });
          if (!error) { const r2 = await supabase.rpc('actualizar_hora_aviso', { p_hora: horaAviso }); if (r2.error) { setAviso({ ok: false, texto: mensajeError(r2.error) }); return; } }
          if (error) setAviso({ ok: false, texto: mensajeError(error) }); else { await recargar(); setAviso({ ok: true, texto: 'Guardado.' }); }
        }}>Guardar</button>
      </section>

      <section className="card stack" style={{ padding: 16, gap: 12 }} aria-label="Fuentes de datos">
        <h2 style={{ margin: 0, fontSize: 16 }}>Fuentes de datos</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Marcá solo lo que tiene tu equipo. Lo que no esté marcado no aparece en el Sports Science Hub, así los informes quedan completos con lo que sí medís (wellness, RPE y carga).
        </p>
        {([
          ['GPS', 'Volumen e intensidad de cada sesión (por ejemplo, Wimu).', gps, setGps],
          ['Plataforma de fuerza', 'Tests de salto, fuerza y asimetrías (por ejemplo, VALD).', fuerza, setFuerza],
        ] as const).map(([t, sub, v, set]) => (
          <label key={t} className="row" style={{ gap: 12, cursor: 'pointer', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} style={{ width: 20, height: 20, marginTop: 2, flex: 'none', accentColor: '#16181D' }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <strong style={{ fontSize: 14 }}>{t}</strong>
              <span className="xs muted">{sub}</span>
            </span>
          </label>
        ))}
        <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={async () => {
          const { error } = await supabase.rpc('actualizar_fuentes', { p_gps: gps, p_fuerza: fuerza });
          if (error) setAviso({ ok: false, texto: mensajeError(error) }); else { await recargar(); setAviso({ ok: true, texto: 'Guardado.' }); }
        }}>Guardar</button>
      </section>

      {aviso && <p className={`notice ${aviso.ok ? 'notice-ok' : 'notice-error'}`} role="status" style={{ margin: 0 }}>{aviso.texto}</p>}
    </div>
  );
}
