import { useEffect, useMemo, useRef, useState } from 'react';
import Dialogo from '../../components/Dialogo';
import { supabase, mensajeError } from '../../lib/supabase';
import { CATEGORIAS, nuevoId, normalizar, type Ejercicio, type Item, type Serie } from '../../lib/workout';

const leerKg = (t: string): number | null => {
  const v = t.trim().replace(',', '.');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) / 100 : null;
};

// Una fila por serie. Lo que escribís en la primera se copia a las que no tocaste.
type Fila = { reps: string; kg: string; tocadaReps: boolean; tocadaKg: boolean };
const kgAtexto = (kg: number | null | undefined) => (kg == null ? '' : String(kg).replace('.', ','));

function filasIniciales(item: Item | null): Fila[] {
  if (!item) return Array.from({ length: 3 }, () => ({ reps: '', kg: '', tocadaReps: false, tocadaKg: false }));
  const det: Serie[] = item.detalle.length ? item.detalle : Array.from({ length: item.series }, () => ({ reps: item.reps, kg: null }));
  const r0 = det[0]?.reps ?? ''; const k0 = kgAtexto(det[0]?.kg);
  return Array.from({ length: item.series }, (_, i) => {
    const d = det[i] ?? det[det.length - 1] ?? { reps: '', kg: null };
    return { reps: d.reps ?? '', kg: kgAtexto(d.kg), tocadaReps: i > 0 && (d.reps ?? '') !== r0, tocadaKg: i > 0 && kgAtexto(d.kg) !== k0 };
  });
}

export default function EditorItem({ dia, item, biblioteca, jugadores = [], jugadorInicial = '', onCerrar, onGuardar, onBibliotecaCambio }: {
  dia: string;
  item: Item | null;
  biblioteca: Ejercicio[];
  jugadores?: { id: string; nombre: string }[];
  jugadorInicial?: string;
  onCerrar: () => void;
  onGuardar: (it: Item) => void;
  onBibliotecaCambio: (e: Ejercicio) => void;
}) {
  const [busca, setBusca] = useState(item?.nombre ?? '');
  const [elegido, setElegido] = useState<{ id: string | null; nombre: string } | null>(item ? { id: item.ejercicio_id, nombre: item.nombre } : null);
  const [abierto, setAbierto] = useState(!item);
  const [tipo, setTipo] = useState('Todos');
  const [filas, setFilas] = useState<Fila[]>(() => filasIniciales(item));
  const series = filas.length;
  const [cadaLado, setCadaLado] = useState(item?.cada_lado ?? false);
  const [unidad, setUnidad] = useState<'reps' | 'seg'>(item?.config?.unidad === 'seg' ? 'seg' : 'reps');
  const [agregados, setAgregados] = useState<string[]>([]);
  const buscador = useRef<HTMLInputElement>(null);
  const [conDescanso, setConDescanso] = useState(item?.descanso_seg != null);
  const [min, setMin] = useState(item?.descanso_seg != null ? String(Math.floor(item.descanso_seg / 60)) : '1');
  const [seg, setSeg] = useState(item?.descanso_seg != null ? String(item.descanso_seg % 60).padStart(2, '0') : '30');
  const [conNota, setConNota] = useState(!!item?.nota);
  const [nota, setNota] = useState(item?.nota ?? '');
  const [error, setError] = useState('');
  const [creando, setCreando] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);

  const sugerencias = useMemo(() => {
    const p = normalizar(busca).split(' ').filter(Boolean);
    if (!p.length) return [];
    return biblioteca.filter((e) => (tipo === 'Todos' || e.categoria === tipo) && p.every((w) => normalizar(e.nombre).includes(w))).slice(0, 8);
  }, [busca, tipo, biblioteca]);
  const existeExacto = biblioteca.some((e) => normalizar(e.nombre) === normalizar(busca));

  function cambiarSeries(n: number) {
    const v = Math.min(20, Math.max(1, n));
    setFilas((f) => {
      const out = f.slice(0, v);
      while (out.length < v) out.push({ reps: f[0]?.reps ?? '', kg: f[0]?.kg ?? '', tocadaReps: false, tocadaKg: false });
      return out;
    });
  }

  function cambiarFila(i: number, campo: 'reps' | 'kg', valor: string) {
    setFilas((f) => f.map((x, j) => {
      if (j === i) return { ...x, [campo]: valor, ...(i > 0 ? (campo === 'reps' ? { tocadaReps: true } : { tocadaKg: true }) : {}) };
      if (i === 0 && !(campo === 'reps' ? x.tocadaReps : x.tocadaKg)) return { ...x, [campo]: valor };
      return x;
    }));
  }

  async function crearEnBiblioteca() {
    const nombre = busca.trim();
    if (!nombre) return;
    setCreando(true); setError('');
    const { data, error } = await supabase.rpc('guardar_ejercicio', { p_id: null, p: { nombre, categoria: tipo === 'Todos' ? '' : tipo } });
    setCreando(false);
    if (error) { setError(mensajeError(error)); return; }
    const nuevo: Ejercicio = { id: data as string, nombre, categoria: tipo === 'Todos' ? null : tipo, implemento: null, lateralidad: null, contraccion: null, video_url: null, consignas: null, eliminado_en: null };
    onBibliotecaCambio(nuevo);
    setElegido({ id: nuevo.id, nombre }); setAbierto(false);
  }

  function guardar() {
    setError('');
    if (!elegido) { setError('Elegí un ejercicio de la lista.'); return; }
    let descanso: number | null = null;
    if (conDescanso) {
      const m = Number(min || 0); const s = Number(seg || 0);
      if (!Number.isInteger(m) || !Number.isInteger(s) || m < 0 || s < 0 || s > 59 || m * 60 + s > 3600) { setError('El descanso va en minutos y segundos (por ejemplo, 1:30).'); return; }
      descanso = m * 60 + s;
    }
    for (const f of filas) {
      if (f.kg.trim() && leerKg(f.kg) == null) { setError('Los kilos tienen que ser un número (por ejemplo, 22,5).'); return; }
    }
    const det = filas.map((f) => ({ reps: f.reps.trim(), kg: leerKg(f.kg) }));
    onGuardar({
      id: item?.id ?? nuevoId(), tipo: 'ejercicio', bloque: item?.bloque ?? 'Bloque principal', ejercicio_id: elegido.id, nombre: elegido.nombre,
      series, reps: det[0]?.reps ?? '', cada_lado: cadaLado, con_carga: det.some((d) => d.kg != null), detalle: det,
      descanso_seg: descanso, nota: conNota ? nota.trim() : '', origen_id: item?.origen_id ?? null, modificado: item?.modificado ?? false,
      config: { ...(item?.config ?? {}), unidad },
    });
    if (!item) {
      // La ventana queda abierta para seguir agregando: se limpia el ejercicio y se mantiene el resto.
      setAgregados((a) => [...a, elegido.nombre]);
      setBusca(''); setElegido(null); setAbierto(true); setVerHistorial(false);
      setFilas((f) => f.map((x) => ({ ...x, kg: '', tocadaKg: false })));
      setConNota(false); setNota('');
      setTimeout(() => buscador.current?.focus(), 0);
    }
  }

  return (
    <Dialogo titulo={item ? 'Editar ejercicio' : 'Añadir ejercicios'} onCerrar={onCerrar} ancho={640}
      pie={<>
        <span className="small muted" style={{ marginRight: 'auto' }}>{dia}</span>
        {elegido && <button type="button" className="btn btn-ghost" aria-pressed={verHistorial} onClick={() => setVerHistorial(!verHistorial)}>Historial</button>}
        <button type="button" className="btn" onClick={onCerrar}>{item ? 'Cancelar' : agregados.length ? 'Listo' : 'Cerrar'}</button>
        <button type="button" className="btn btn-primary" onClick={guardar}>{item ? 'Guardar' : 'Añadir'}</button>
      </>}>
      <div className="stack" style={{ gap: 14 }}>
        {agregados.length > 0 && (
          <p className="notice notice-ok" role="status" style={{ margin: 0 }}>
            Añadido{agregados.length > 1 ? 's' : ''}: {agregados.join(' · ')}. Seguí con el próximo o tocá «Listo».
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 190px', gap: 10, alignItems: 'end' }}>
          <div className="field" style={{ position: 'relative' }}>
            <span id="it-ejercicio-label">Ejercicio</span>
            <input ref={buscador} id="it-ejercicio" aria-labelledby="it-ejercicio-label" className="input" autoFocus={!item} autoComplete="off" value={busca} placeholder="Escribí para buscar…"
              role="combobox" aria-expanded={abierto && busca.trim().length > 0} aria-controls="it-sugerencias"
              onChange={(e) => { setBusca(e.target.value); setAbierto(true); setElegido(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && sugerencias[0]) { e.preventDefault(); setElegido({ id: sugerencias[0].id, nombre: sugerencias[0].nombre }); setBusca(sugerencias[0].nombre); setAbierto(false); } }} />
            {abierto && busca.trim() && (
              <ul id="it-sugerencias" role="listbox" className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, listStyle: 'none', margin: '4px 0 0', padding: 4, boxShadow: '0 8px 24px rgba(0,0,0,.12)', maxHeight: 300, overflowY: 'auto' }}>
                {sugerencias.map((s) => (
                  <li key={s.id} role="option" aria-selected={false}>
                    <button type="button" onClick={() => { setElegido({ id: s.id, nombre: s.nombre }); setBusca(s.nombre); setAbierto(false); }}
                      style={{ width: '100%', textAlign: 'left', border: 0, background: 'transparent', padding: '8px 10px', borderRadius: 8, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ fontWeight: 500 }}>{s.nombre}</span>
                      <span className="xs muted">{s.categoria ?? ''}</span>
                    </button>
                  </li>
                ))}
                {!existeExacto && (
                  <li>
                    <button type="button" disabled={creando} onClick={crearEnBiblioteca}
                      style={{ width: '100%', textAlign: 'left', border: 0, background: 'transparent', padding: '8px 10px', borderRadius: 8, color: 'var(--accent)', fontWeight: 600 }}>
                      {sugerencias.length ? '' : 'Sin resultados. '}{creando ? 'Creando…' : `Crear «${busca.trim()}» en la biblioteca`}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
          <label className="field"><span>Tipo</span>
            <select id="it-tipo" className="select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option>Todos</option>
              {CATEGORIAS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>

        <div className="row" style={{ gap: 16, alignItems: 'flex-end' }}>
          <div className="field"><span>Series</span>
            <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button type="button" className="btn btn-sm" aria-label="Una serie menos" onClick={() => cambiarSeries(series - 1)}>−</button>
              <span style={{ minWidth: 30, textAlign: 'center', fontSize: 18, fontWeight: 700 }} aria-live="polite">{series}</span>
              <button type="button" className="btn btn-sm" aria-label="Una serie más" onClick={() => cambiarSeries(series + 1)}>+</button>
            </div>
          </div>
          <div className="field"><span>Se mide en</span>
            <div className="row" role="group" aria-label="Se mide en" style={{ gap: 4 }}>
              <button type="button" className="chip" aria-pressed={unidad === 'reps'} onClick={() => setUnidad('reps')}>Reps</button>
              <button type="button" className="chip" aria-pressed={unidad === 'seg'} onClick={() => setUnidad('seg')}>Segundos</button>
            </div>
          </div>
          <label className="row" style={{ gap: 8, minHeight: 44, cursor: 'pointer' }}>
            <input id="it-lado" type="checkbox" checked={cadaLado} onChange={(e) => setCadaLado(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#16181D' }} />
            <span>Cada lado</span>
          </label>
        </div>

        <div>
          <table className="tbl" style={{ maxWidth: 380 }}>
            <thead><tr><th>Serie</th><th>{unidad === 'seg' ? 'Segundos' : 'Reps'}{cadaLado ? ' c/lado' : ''}</th><th>Kg</th></tr></thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{i + 1}</td>
                  <td><input className="input" id={`it-reps-${i}`} style={{ height: 38, width: 100, color: i > 0 && !f.tocadaReps ? 'var(--muted)' : undefined }}
                    aria-label={`Reps de la serie ${i + 1}`} maxLength={20} value={f.reps} placeholder={i === 0 ? (unidad === 'seg' ? '30' : '8') : ''}
                    onChange={(e) => cambiarFila(i, 'reps', e.target.value)} /></td>
                  <td><input className="input" id={`it-kg-${i}`} style={{ height: 38, width: 100, color: i > 0 && !f.tocadaKg ? 'var(--muted)' : undefined }}
                    inputMode="decimal" aria-label={`Kilos de la serie ${i + 1}`} placeholder="—" value={f.kg}
                    onChange={(e) => cambiarFila(i, 'kg', e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="xs muted" style={{ margin: '4px 0 0' }}>Lo que pongas en la serie 1 se copia a las demás; si cambiás otra serie, esa queda como la dejaste. Los kilos se pueden dejar vacíos.</p>
        </div>

        {conDescanso ? (
          <div className="row" style={{ gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>Descanso entre series</span>
            <input className="input" style={{ width: 64, height: 38 }} inputMode="numeric" aria-label="Minutos" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} />
            <span>:</span>
            <input className="input" style={{ width: 64, height: 38 }} inputMode="numeric" aria-label="Segundos" value={seg} onChange={(e) => setSeg(e.target.value.replace(/\D/g, '').slice(0, 2))} />
            <span className="xs muted">min:seg</span>
            <button type="button" className="btn btn-sm btn-ghost" aria-label="Quitar descanso" onClick={() => setConDescanso(false)}>×</button>
          </div>
        ) : null}

        {conNota ? (
          <label className="field"><span>Nota para el jugador <span className="xs muted">· la ve en el recuadro «Nota del PF»</span></span>
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <textarea id="it-nota" className="input" rows={2} maxLength={1000} value={nota} onChange={(e) => setNota(e.target.value)}
                style={{ height: 'auto', padding: '10px 12px', resize: 'vertical' }} placeholder="Ej.: bajá en 3 segundos y explotá al subir." />
              <button type="button" className="btn btn-sm btn-ghost" aria-label="Quitar nota" onClick={() => { setConNota(false); setNota(''); }}>×</button>
            </div>
          </label>
        ) : null}

        {(!conDescanso || !conNota) && (
          <div className="row" style={{ gap: 8 }}>
            {!conDescanso && <button type="button" className="btn btn-sm" onClick={() => setConDescanso(true)}>+ Descanso</button>}
            {!conNota && <button type="button" className="btn btn-sm" onClick={() => setConNota(true)}>+ Nota para el jugador</button>}
          </div>
        )}

        {verHistorial && elegido && <Historial ejercicioId={elegido.id} nombre={elegido.nombre} jugadores={jugadores} inicial={jugadorInicial} />}

        {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      </div>
    </Dialogo>
  );
}

type Registro = { fecha: string; prescrito: Serie[]; hecho: Serie[]; completado: boolean };
const fmt = (s?: Serie) => (s ? `${s.kg == null ? '—' : String(s.kg).replace('.', ',')} × ${s.reps || '—'}` : '—');

// Lo que el PF prescribió (C) y lo que hizo el jugador (A), sesión por sesión. Solo para el staff.
function Historial({ ejercicioId, nombre, jugadores, inicial }: { ejercicioId: string | null; nombre: string; jugadores: { id: string; nombre: string }[]; inicial: string }) {
  const [jugador, setJugador] = useState(inicial || jugadores[0]?.id || '');
  const [lista, setLista] = useState<Registro[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!jugador) return;
    setLista(null); setError('');
    supabase.rpc('historial_ejercicio', { p_perfil: jugador, p_ejercicio: ejercicioId, p_nombre: nombre })
      .then(({ data, error }) => { if (error) { setError(mensajeError(error)); setLista([]); } else setLista((data as Registro[]) ?? []); });
  }, [jugador, ejercicioId, nombre]);
  return (
    <section className="card stack" style={{ padding: 14, gap: 10, background: 'var(--bg)' }} aria-label="Historial">
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <strong>Historial · {nombre}</strong>
        <label><span className="sr-only">Jugador</span>
          <select id="it-hist-jugador" className="select" style={{ height: 36, width: 220 }} value={jugador} onChange={(e) => setJugador(e.target.value)}>
            {jugadores.length === 0 && <option value="">Sin jugadores</option>}
            {jugadores.map((j) => <option key={j.id} value={j.id}>{j.nombre}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="notice notice-error" style={{ margin: 0 }}>{error}</p>}
      {!lista ? <p className="small muted" style={{ margin: 0 }}>Cargando…</p> : lista.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>Todavía no registró este ejercicio.</p>
      ) : (
        <div className="table-wrap">
          <table className="tbl" style={{ fontSize: 13 }}>
            <thead><tr><th>Fecha</th><th>Serie</th><th>C · coach</th><th>A · atleta</th></tr></thead>
            <tbody>
              {lista.flatMap((r) => {
                const n = Math.max(r.prescrito.length, r.hecho.length, 1);
                return Array.from({ length: n }, (_, i) => {
                  const c = fmt(r.prescrito[i]); const a = fmt(r.hecho[i]);
                  return (
                    <tr key={`${r.fecha}-${i}`} style={{ borderTop: i === 0 ? '1px solid var(--line)' : undefined }}>
                      <td>{i === 0 ? `${r.fecha.slice(8, 10)}/${r.fecha.slice(5, 7)}${r.completado ? '' : ' (sin completar)'}` : ''}</td>
                      <td>{i + 1}</td>
                      <td>{c}</td>
                      <td style={{ color: a !== c ? '#C2410C' : undefined, fontWeight: a !== c ? 600 : undefined }}>{a}</td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
          <p className="xs muted" style={{ margin: '6px 0 0' }}>Kg × reps. En naranja, lo que el jugador cambió respecto de lo prescrito.</p>
        </div>
      )}
    </section>
  );
}
