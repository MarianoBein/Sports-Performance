import { useCallback, useEffect, useState } from 'react';
import { supabase, mensajeError } from '../lib/supabase';
import { useSesion } from '../lib/sesion';
import { fechaLarga, hoyIso, iso, desdeIso, sumarDias } from '../lib/calendario';
import { COLORES_5, TEXTO_5, bienDe, colorRpe, type Pregunta } from '../lib/wellness';

type Fila = {
  perfil_id: string; nombre: string; sueno: number | null; fatiga: number | null; estres: number | null; dolor: number | null;
  preparacion: number | null; rpe: number | null; minutos: number | null; minutos_propios: boolean; srpe: number | null;
  wellness_aplica: boolean; rpe_aplica: boolean; wellness_excepcion: boolean; rpe_excepcion: boolean;
};
type Cuest = 'wellness' | 'rpe';
const NA = () => <span className="pill" style={{ background: '#F1EFEA', color: 'var(--muted)', fontSize: 11 }}>No aplica</span>;
const fmt = (n: number | null, d = 1) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }));

function Celda({ clave, valor }: { clave: Pregunta['clave']; valor: number | null }) {
  if (valor === null) return <span className="muted">—</span>;
  const b = bienDe(clave, valor);
  return <span className="pill" style={{ minWidth: 32, textAlign: 'center', background: COLORES_5[b - 1], color: TEXTO_5[b - 1] }}>{valor}</span>;
}

function MinutosInput({ valor, onGuardar, etiqueta }: { valor: number | null; onGuardar: (m: number | null) => void; etiqueta: string }) {
  const [t, setT] = useState(valor === null ? '' : String(valor));
  useEffect(() => { setT(valor === null ? '' : String(valor)); }, [valor]);
  return (
    <label style={{ display: 'inline-flex' }}>
      <span className="sr-only">{etiqueta}</span>
      <input className="input" inputMode="numeric" value={t} placeholder="—" style={{ width: 72, height: 36, padding: '0 8px', fontSize: 14 }}
        onChange={(e) => setT(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => { const n = t === '' ? null : Number(t); if (n !== valor) onGuardar(n); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

export default function SportsScience() {
  const { perfil, permisos } = useSesion();
  if (!perfil || !permisos) return null;
  return perfil.rol.es_jugador && !perfil.es_admin ? <MisDatos /> : <VistaStaff edita={permisos.sports_science.nivel === 'editar'} />;
}

function VistaStaff({ edita }: { edita: boolean }) {
  const [fecha, setFecha] = useState(hoyIso());
  const [filas, setFilas] = useState<Fila[]>([]);
  const [minEquipo, setMinEquipo] = useState<number | null>(null);
  const [equipo, setEquipo] = useState<Record<Cuest, boolean | null>>({ wellness: null, rpe: null });
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    const [r, m, ex] = await Promise.all([
      supabase.rpc('respuestas_dia', { p_fecha: fecha }),
      supabase.from('minutos_equipo').select('minutos').eq('fecha', fecha).maybeSingle(),
      supabase.from('cuestionario_excepciones').select('cuestionario,aplica').eq('fecha', fecha).is('perfil_id', null),
    ]);
    const eq: Record<Cuest, boolean | null> = { wellness: null, rpe: null };
    (ex.data ?? []).forEach((x: { cuestionario: Cuest; aplica: boolean }) => { eq[x.cuestionario] = x.aplica; });
    setEquipo(eq);
    if (r.error) setError(mensajeError(r.error)); else setError('');
    setFilas((r.data as Fila[]) ?? []);
    setMinEquipo(m.data?.minutos ?? null);
  }, [fecha]);
  useEffect(() => { cargar(); }, [cargar]);

  async function guardarMin(m: number | null, perfil?: string) {
    const { error } = await supabase.rpc('guardar_minutos', { p_fecha: fecha, p_minutos: m, p_perfil: perfil ?? null });
    if (error) setError(mensajeError(error)); else cargar();
  }

  async function marcar(c: Cuest, aplica: boolean | null, perfil?: string) {
    const { error } = await supabase.rpc('marcar_aplica', { p_fecha: fecha, p_cuestionario: c, p_aplica: aplica, p_perfil: perfil ?? null });
    if (error) setError(mensajeError(error)); else cargar();
  }
  const aplicaW = filas.filter((f) => f.wellness_aplica);
  const aplicaR = filas.filter((f) => f.rpe_aplica);
  const conW = filas.filter((f) => f.preparacion !== null);
  const conR = filas.filter((f) => f.rpe !== null);
  const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted small" style={{ margin: '0 0 4px' }}>Wellness y RPE del día · las demás vistas llegan en el próximo módulo</p>
          <h1 className="display" style={{ fontSize: 38 }}>Sports Science Hub</h1>
        </div>
        <div className="row">
          <button type="button" className="btn" style={{ width: 44, padding: 0 }} aria-label="Día anterior" onClick={() => setFecha(iso(sumarDias(desdeIso(fecha), -1)))}>‹</button>
          <label><span className="sr-only">Fecha</span><input className="input" type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} style={{ width: 170 }} /></label>
          <button type="button" className="btn" style={{ width: 44, padding: 0 }} aria-label="Día siguiente" onClick={() => setFecha(iso(sumarDias(desdeIso(fecha), 1)))}>›</button>
          <button type="button" className="btn" onClick={() => setFecha(hoyIso())}>Hoy</button>
        </div>
      </div>
      <p className="small" style={{ margin: 0, fontWeight: 600 }}>{fechaLarga(fecha)}</p>

      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {[
          ['Preparación', fmt(media(conW.map((f) => Number(f.preparacion))), 2), `${conW.length} de ${aplicaW.length} respondieron`],
          ['RPE medio', fmt(media(conR.map((f) => Number(f.rpe))), 1), `${conR.length} de ${aplicaR.length} respondieron`],
          ['Esfuerzo medio', fmt(media(filas.filter((f) => f.srpe !== null).map((f) => Number(f.srpe))), 0), 'RPE × minutos'],
        ].map(([t, v, s]) => (
          <div key={t} className="card" style={{ padding: 14, textAlign: 'center' }}>
            <div className="small muted" style={{ fontWeight: 600 }}>{t}</div>
            <div className="display" style={{ fontSize: 32 }}>{v}</div>
            <div className="xs muted">{s}</div>
          </div>
        ))}
      </div>

      <div className="card row" style={{ padding: '12px 16px', gap: '10px 20px' }}>
        <strong style={{ fontSize: 14 }}>Este día, para el equipo</strong>
        {(['wellness', 'rpe'] as Cuest[]).map((c) => (
          <label key={c} className="row" style={{ gap: 8 }}>
            <span className="small" style={{ fontWeight: 600 }}>{c === 'wellness' ? 'Wellness' : 'RPE'}</span>
            <select className="select" style={{ height: 36, width: 'auto', fontSize: 14 }} disabled={!edita}
              value={equipo[c] === null ? 'auto' : equipo[c] ? 'si' : 'no'}
              onChange={(e) => marcar(c, e.target.value === 'auto' ? null : e.target.value === 'si')}>
              <option value="auto">Según la frecuencia del club</option>
              <option value="si">Aplica</option>
              <option value="no">No aplica (p. ej. partido)</option>
            </select>
          </label>
        ))}
      </div>

      <div className="card row" style={{ padding: '12px 16px' }}>
        <strong style={{ fontSize: 14 }}>Minutos de entrenamiento del equipo</strong>
        {edita ? <MinutosInput valor={minEquipo} etiqueta="Minutos del equipo" onGuardar={(m) => guardarMin(m)} /> : <span>{minEquipo ?? '—'}</span>}
        <span className="xs muted">Se usan para el esfuerzo (sRPE = RPE × minutos). Si un jugador hizo distinto, cámbialo en su fila.</span>
      </div>

      <div className="card table-wrap">
        <table className="tbl" style={{ minWidth: 1080 }}>
          <thead>
            <tr>
              <th scope="col">Jugador</th>
              <th scope="col">Sueño</th>
              <th scope="col">Fatiga</th>
              <th scope="col">Estrés</th>
              <th scope="col">Dolor muscular</th>
              <th scope="col">Preparación</th>
              <th scope="col">RPE</th>
              <th scope="col">Minutos</th>
              <th scope="col">Esfuerzo</th>
              {edita && <th scope="col">Excepción del jugador</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.perfil_id}>
                <th scope="row" style={{ fontWeight: 600 }}>{f.nombre}</th>
                {!f.wellness_aplica && f.sueno === null
                  ? <td colSpan={4}><NA /></td>
                  : <>
                    <td><Celda clave="sueno" valor={f.sueno} /></td>
                    <td><Celda clave="fatiga" valor={f.fatiga} /></td>
                    <td><Celda clave="estres" valor={f.estres} /></td>
                    <td><Celda clave="dolor" valor={f.dolor} /></td>
                  </>}
                <td style={{ fontWeight: 600 }}>{fmt(f.preparacion === null ? null : Number(f.preparacion), 2)}</td>
                <td>{f.rpe === null ? (f.rpe_aplica ? <span className="muted">—</span> : <NA />) : <span className="pill" style={{ minWidth: 32, textAlign: 'center', background: colorRpe(f.rpe).color, color: colorRpe(f.rpe).texto }}>{f.rpe}</span>}</td>
                <td>{edita
                  ? <MinutosInput valor={f.minutos_propios ? f.minutos : null} etiqueta={`Minutos de ${f.nombre}`} onGuardar={(m) => guardarMin(m, f.perfil_id)} />
                  : (f.minutos ?? '—')}
                  {edita && !f.minutos_propios && f.minutos !== null && <span className="xs muted"> ({f.minutos})</span>}
                </td>
                <td style={{ fontWeight: 600 }}>{f.srpe ?? <span className="muted">—</span>}</td>
                {edita && (
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      {(['wellness', 'rpe'] as Cuest[]).map((c) => {
                        const exc = c === 'wellness' ? f.wellness_excepcion : f.rpe_excepcion;
                        const ap = c === 'wellness' ? f.wellness_aplica : f.rpe_aplica;
                        return (
                          <label key={c}>
                            <span className="sr-only">{`${c === 'wellness' ? 'Wellness' : 'RPE'} de ${f.nombre}`}</span>
                            <select className="select" style={{ height: 32, width: 'auto', fontSize: 12, padding: '0 6px', borderColor: exc ? 'var(--ink)' : undefined }}
                              value={!exc ? 'auto' : ap ? 'si' : 'no'}
                              onChange={(e) => marcar(c, e.target.value === 'auto' ? null : e.target.value === 'si', f.perfil_id)}>
                              <option value="auto">{c === 'wellness' ? 'W' : 'RPE'}: como el equipo</option>
                              <option value="si">{c === 'wellness' ? 'W' : 'RPE'}: aplica</option>
                              <option value="no">{c === 'wellness' ? 'W' : 'RPE'}: no aplica</option>
                            </select>
                          </label>
                        );
                      })}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {filas.length === 0 && !error && <tr><td colSpan={10} className="muted">Todavía no hay jugadores en el club.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="xs muted" style={{ margin: 0 }}>
        Sueño: 5 = dormí muy bien. Fatiga, estrés y dolor muscular: 5 = muy mal. El color siempre indica si está bien (verde) o mal (rojo).
        Preparación = promedio de las cuatro con el mismo sentido (5 = mejor). «—» = sin respuesta; nunca cuenta como cero. «No aplica» no cuenta como faltante.
      </p>
    </div>
  );
}

function MisDatos() {
  const { perfil } = useSesion();
  const [dias, setDias] = useState<{ fecha: string; preparacion: number | null; rpe: number | null }[]>([]);
  useEffect(() => {
    if (!perfil) return;
    const desde = iso(sumarDias(new Date(), -13));
    Promise.all([
      supabase.from('wellness').select('fecha,preparacion').eq('perfil_id', perfil.id).gte('fecha', desde),
      supabase.from('rpe').select('fecha,valor').eq('perfil_id', perfil.id).gte('fecha', desde),
    ]).then(([w, r]) => {
      const out = Array.from({ length: 14 }, (_, i) => {
        const f = iso(sumarDias(new Date(), -i));
        return {
          fecha: f,
          preparacion: (w.data ?? []).find((x: { fecha: string }) => x.fecha === f)?.preparacion ?? null,
          rpe: (r.data ?? []).find((x: { fecha: string }) => x.fecha === f)?.valor ?? null,
        };
      });
      setDias(out);
    });
  }, [perfil]);
  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <h1 className="display" style={{ fontSize: 36 }}>Mis respuestas</h1>
      <p className="small muted" style={{ margin: 0 }}>Últimos 14 días. Preparación: 5 = llegas muy bien.</p>
      <div className="card" style={{ padding: 0 }}>
        {dias.map((d) => (
          <div key={d.fecha} className="row" style={{ justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--line-soft)' }}>
            <span style={{ fontWeight: 500 }}>{fechaLarga(d.fecha)}</span>
            <span className="row small" style={{ gap: 14 }}>
              <span>Preparación <strong>{fmt(d.preparacion === null ? null : Number(d.preparacion), 1)}</strong></span>
              <span>RPE <strong>{d.rpe ?? '—'}</strong></span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
