import { useMemo, useState } from 'react';
import Dialogo from '../../components/Dialogo';
import { supabase, mensajeError } from '../../lib/supabase';
import { BLOQUES_BASE, CATEGORIAS, nuevoId, normalizar, type Ejercicio, type Item, type Serie } from '../../lib/workout';

const leerKg = (t: string): number | null => {
  const v = t.trim().replace(',', '.');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) / 100 : null;
};

function ajustarDetalle(detalle: Serie[], series: number, reps: string): Serie[] {
  const out = detalle.slice(0, series);
  while (out.length < series) out.push({ reps: out[out.length - 1]?.reps ?? reps, kg: out[out.length - 1]?.kg ?? null });
  return out;
}

export default function EditorItem({ dia, item, bloquesDia, biblioteca, onCerrar, onGuardar, onBibliotecaCambio }: {
  dia: string;
  item: Item | null;
  bloquesDia: string[];
  biblioteca: Ejercicio[];
  onCerrar: () => void;
  onGuardar: (it: Item) => void;
  onBibliotecaCambio: (e: Ejercicio) => void;
}) {
  const [busca, setBusca] = useState(item?.nombre ?? '');
  const [elegido, setElegido] = useState<{ id: string | null; nombre: string } | null>(item ? { id: item.ejercicio_id, nombre: item.nombre } : null);
  const [abierto, setAbierto] = useState(!item);
  const [tipo, setTipo] = useState('Todos');
  const bloques = useMemo(() => [...new Set([...BLOQUES_BASE, ...bloquesDia, ...(item ? [item.bloque] : [])])], [bloquesDia, item]);
  const [bloque, setBloque] = useState(item?.bloque ?? bloquesDia[bloquesDia.length - 1] ?? 'Bloque principal');
  const [bloqueNuevo, setBloqueNuevo] = useState<string | null>(null);
  const [series, setSeries] = useState(item?.series ?? 3);
  const [reps, setReps] = useState(item?.reps ?? '');
  const [cadaLado, setCadaLado] = useState(item?.cada_lado ?? false);
  const [conCarga, setConCarga] = useState(item?.con_carga ?? false);
  const [detalle, setDetalle] = useState<Serie[]>(item?.detalle.length ? item.detalle : []);
  const [kgTexto, setKgTexto] = useState<string[]>((item?.detalle ?? []).map((s) => (s.kg == null ? '' : String(s.kg).replace('.', ','))));
  const [conDescanso, setConDescanso] = useState(item?.descanso_seg != null);
  const [min, setMin] = useState(item?.descanso_seg != null ? String(Math.floor(item.descanso_seg / 60)) : '1');
  const [seg, setSeg] = useState(item?.descanso_seg != null ? String(item.descanso_seg % 60).padStart(2, '0') : '30');
  const [conNota, setConNota] = useState(!!item?.nota);
  const [nota, setNota] = useState(item?.nota ?? '');
  const [error, setError] = useState('');
  const [creando, setCreando] = useState(false);

  const sugerencias = useMemo(() => {
    const p = normalizar(busca).split(' ').filter(Boolean);
    if (!p.length) return [];
    return biblioteca.filter((e) => (tipo === 'Todos' || e.categoria === tipo) && p.every((w) => normalizar(e.nombre).includes(w))).slice(0, 8);
  }, [busca, tipo, biblioteca]);
  const existeExacto = biblioteca.some((e) => normalizar(e.nombre) === normalizar(busca));

  const filas = conCarga ? ajustarDetalle(detalle, series, reps) : [];

  function cambiarSeries(n: number) {
    const v = Math.min(20, Math.max(1, n));
    setSeries(v);
    if (conCarga) { setDetalle(ajustarDetalle(detalle, v, reps)); setKgTexto((k) => ajustarDetalle(detalle, v, reps).map((_, i) => k[i] ?? k[k.length - 1] ?? '')); }
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
    const b = (bloqueNuevo ?? bloque).trim();
    if (!b) { setError('Poné un nombre al bloque.'); return; }
    let descanso: number | null = null;
    if (conDescanso) {
      const m = Number(min || 0); const s = Number(seg || 0);
      if (!Number.isInteger(m) || !Number.isInteger(s) || m < 0 || s < 0 || s > 59 || m * 60 + s > 3600) { setError('El descanso va en minutos y segundos (por ejemplo, 1:30).'); return; }
      descanso = m * 60 + s;
    }
    const det = conCarga ? filas.map((f, i) => ({ reps: f.reps.trim(), kg: leerKg(kgTexto[i] ?? '') })) : [];
    onGuardar({
      id: item?.id ?? nuevoId(), bloque: b, ejercicio_id: elegido.id, nombre: elegido.nombre, series, reps: reps.trim(),
      cada_lado: cadaLado, con_carga: conCarga, detalle: det, descanso_seg: descanso, nota: conNota ? nota.trim() : '',
    });
  }

  return (
    <Dialogo titulo={item ? 'Editar ejercicio' : 'Añadir ejercicio'} onCerrar={onCerrar} ancho={640}
      pie={<>
        <span className="small muted" style={{ marginRight: 'auto' }}>{dia}</span>
        <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={guardar}>{item ? 'Guardar' : 'Añadir'}</button>
      </>}>
      <div className="stack" style={{ gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 190px', gap: 10, alignItems: 'end' }}>
          <div className="field" style={{ position: 'relative' }}>
            <span id="it-ejercicio-label">Ejercicio</span>
            <input id="it-ejercicio" aria-labelledby="it-ejercicio-label" className="input" autoFocus={!item} autoComplete="off" value={busca} placeholder="Escribí para buscar…"
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

        <label className="field"><span>Bloque</span>
          {bloqueNuevo === null ? (
            <select id="it-bloque" className="select" value={bloque} onChange={(e) => { if (e.target.value === '__nuevo') setBloqueNuevo(''); else setBloque(e.target.value); }}>
              {bloques.map((b) => <option key={b} value={b}>{b}</option>)}
              <option value="__nuevo">+ Nuevo bloque…</option>
            </select>
          ) : (
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <input id="it-bloque-nuevo" className="input" autoFocus maxLength={60} value={bloqueNuevo} placeholder="Ej.: Pliometría" onChange={(e) => setBloqueNuevo(e.target.value)} />
              <button type="button" className="btn btn-ghost" onClick={() => setBloqueNuevo(null)}>Cancelar</button>
            </div>
          )}
        </label>

        <div className="row" style={{ gap: 16, alignItems: 'flex-end' }}>
          <div className="field"><span>Series</span>
            <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button type="button" className="btn btn-sm" aria-label="Una serie menos" onClick={() => cambiarSeries(series - 1)}>−</button>
              <span style={{ minWidth: 30, textAlign: 'center', fontSize: 18, fontWeight: 700 }} aria-live="polite">{series}</span>
              <button type="button" className="btn btn-sm" aria-label="Una serie más" onClick={() => cambiarSeries(series + 1)}>+</button>
            </div>
          </div>
          <label className="field" style={{ width: 120 }}><span>Reps</span>
            <input id="it-reps" className="input" maxLength={20} value={reps} placeholder="8 · 30 s" onChange={(e) => { setReps(e.target.value); if (conCarga && detalle.every((d) => d.reps === reps)) setDetalle(ajustarDetalle(detalle, series, e.target.value).map((d) => ({ ...d, reps: e.target.value }))); }} />
          </label>
          <label className="row" style={{ gap: 8, minHeight: 44, cursor: 'pointer' }}>
            <input id="it-lado" type="checkbox" checked={cadaLado} onChange={(e) => setCadaLado(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#16181D' }} />
            <span>Cada lado</span>
          </label>
          <label className="row" style={{ gap: 8, minHeight: 44, cursor: 'pointer' }}>
            <input id="it-carga" type="checkbox" checked={conCarga} onChange={(e) => {
              setConCarga(e.target.checked);
              if (e.target.checked) { const d = ajustarDetalle(detalle.length ? detalle : [], series, reps); setDetalle(d); setKgTexto((k) => d.map((_, i) => k[i] ?? '')); }
            }} style={{ width: 18, height: 18, accentColor: '#16181D' }} />
            <span>Carga y reps por serie</span>
          </label>
        </div>

        {conCarga && (
          <table className="tbl" style={{ maxWidth: 360 }}>
            <thead><tr><th>Serie</th><th>{cadaLado ? 'Reps c/lado' : 'Reps'}</th><th>Kg</th></tr></thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{i + 1}</td>
                  <td><input className="input" style={{ height: 38, width: 90 }} aria-label={`Reps de la serie ${i + 1}`} maxLength={20} value={f.reps}
                    onChange={(e) => setDetalle(filas.map((x, j) => (j === i ? { ...x, reps: e.target.value } : x)))} /></td>
                  <td><input className="input" style={{ height: 38, width: 90 }} inputMode="decimal" aria-label={`Kilos de la serie ${i + 1}`} placeholder="—" value={kgTexto[i] ?? ''}
                    onChange={(e) => setKgTexto(filas.map((_, j) => (j === i ? e.target.value : kgTexto[j] ?? '')))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

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

        {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      </div>
    </Dialogo>
  );
}
