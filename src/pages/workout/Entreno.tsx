import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, mensajeError } from '../../lib/supabase';
import { DIAS, MESES, desdeIso, diaSemana, hoyIso, iso, sumarDias } from '../../lib/calendario';
import { esquema, idYoutube, tiempoTexto, unidadTexto, type Config, type Item, type Serie } from '../../lib/workout';
import type { EstadoHoy } from '../../lib/wellness';

type ItemEntreno = {
  id: string; tipo: 'ejercicio' | 'break' | 'nota' | 'pregunta'; nombre: string; config: Config | null; ejercicio_id: string | null; series: number | null; reps: string | null;
  cada_lado: boolean; detalle: Serie[]; descanso_seg: number | null; nota: string | null;
  video_url: string | null; consignas: string | null; hecho: Serie[] | null; completado_en: string | null;
};
type Fila = { kg: string; reps: string };

const naranja = '#C2410C';
const kgTxt = (kg: number | null | undefined) => (kg == null ? '' : String(kg).replace('.', ','));
const leerKg = (t: string) => { const v = t.trim().replace(',', '.'); if (!v) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : null; };
const comoItem = (e: ItemEntreno): Item => ({
  id: e.id, tipo: e.tipo, bloque: '', ejercicio_id: e.ejercicio_id, nombre: e.nombre, series: e.series ?? 0, reps: e.reps ?? '',
  cada_lado: e.cada_lado, con_carga: false, detalle: e.detalle ?? [], descanso_seg: e.descanso_seg, nota: e.nota ?? '', origen_id: null, modificado: false, config: e.config ?? {},
});
const prescritas = (e: ItemEntreno): Serie[] => {
  const n = e.series ?? 0;
  return Array.from({ length: n }, (_, i) => e.detalle?.[i] ?? e.detalle?.[e.detalle.length - 1] ?? { reps: e.reps ?? '', kg: null });
};
const fechaTitulo = (f: string) => { const d = desdeIso(f); return `${DIAS[diaSemana(d)]} ${d.getDate()} de ${MESES[d.getMonth()]}`; };

export default function Entreno({ perfilId, soloLectura = false }: { perfilId?: string; soloLectura?: boolean }) {
  const [fecha, setFecha] = useState(hoyIso());
  const [items, setItems] = useState<ItemEntreno[] | null>(null);
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState<number | null>(null); // índice dentro de los ejercicios
  const [estado, setEstado] = useState<EstadoHoy | null>(null);

  const cargar = useCallback(async () => {
    setItems(null); setError('');
    const { data, error } = await supabase.rpc('entreno_del_dia', { p_fecha: fecha, p_perfil: perfilId ?? null });
    if (error) { setError(mensajeError(error)); setItems([]); return; }
    setItems(((data as { items: ItemEntreno[] })?.items) ?? []);
  }, [fecha, perfilId]);
  useEffect(() => { cargar(); setAbierto(null); }, [cargar]);

  useEffect(() => {
    if (soloLectura) return;
    supabase.rpc('estado_hoy').then(({ data }) => { const e = (data as EstadoHoy) ?? null; setEstado(e && e.es_jugador ? e : null); });
  }, [soloLectura]);

  const ejercicios = (items ?? []).filter((i) => i.tipo === 'ejercicio');
  const bloqueDe = (id: string) => {
    let b = '';
    for (const it of items ?? []) { if (it.tipo === 'break') b = it.nombre; if (it.id === id) return b; }
    return b;
  };
  const hechos = ejercicios.filter((e) => e.completado_en).length;
  const pideWellness = !soloLectura && fecha === hoyIso() && !!estado?.wellness_toca && !estado.wellness_hecho;

  const cabecera = (
    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
      <button type="button" className="btn btn-sm" aria-label="Día anterior" onClick={() => setFecha(iso(sumarDias(desdeIso(fecha), -1)))}>‹</button>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700 }}>{fecha === hoyIso() ? 'Hoy' : fechaTitulo(fecha)}</div>
        {fecha !== hoyIso() ? <button type="button" className="xs" style={{ border: 0, background: 'transparent', color: 'var(--accent)', fontWeight: 600 }} onClick={() => setFecha(hoyIso())}>Volver a hoy</button>
          : <div className="xs muted">{fechaTitulo(fecha)}</div>}
      </div>
      <button type="button" className="btn btn-sm" aria-label="Día siguiente" onClick={() => setFecha(iso(sumarDias(desdeIso(fecha), 1)))}>›</button>
    </div>
  );

  if (abierto != null && ejercicios[abierto]) {
    return (
      <Detalle key={ejercicios[abierto].id} e={ejercicios[abierto]} n={abierto} total={ejercicios.length} bloque={bloqueDe(ejercicios[abierto].id)} soloLectura={soloLectura}
        onVolver={() => { setAbierto(null); cargar(); }}
        onIr={(i) => setAbierto(i)}
        onGuardado={(hecho, completado) => {
          setItems((its) => its && its.map((x) => (x.id === ejercicios[abierto].id ? { ...x, hecho, completado_en: completado ? (x.completado_en ?? new Date().toISOString()) : null } : x)));
          if (completado) setAbierto(abierto + 1 < ejercicios.length ? abierto + 1 : null);
        }} />
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 560, margin: '0 auto', width: '100%', gap: 14 }}>
      {cabecera}
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      {!items ? <p className="muted">Cargando…</p> : pideWellness && ejercicios.length > 0 ? (
        <div className="card stack" style={{ padding: 18, gap: 10 }}>
          <strong style={{ fontSize: 17 }}>Antes de entrenar, contá cómo llegás hoy</strong>
          <p className="small muted" style={{ margin: 0 }}>Cuatro respuestas. Cuando termines, vas a ver tu entrenamiento.</p>
          <Link to="/wellness?volver=/workout-builder" className="btn btn-primary btn-block">Contestar wellness</Link>
        </div>
      ) : ejercicios.length === 0 ? (
        <div className="card" style={{ padding: 18 }}><p style={{ margin: 0 }}>{soloLectura ? 'No tiene entrenamiento de fuerza este día.' : 'No tenés entrenamiento de fuerza este día.'}</p></div>
      ) : (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 className="display" style={{ margin: 0, fontSize: 26 }}>Entreno del día</h2>
            <span className="small muted">{hechos} de {ejercicios.length} completados</span>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {(items ?? []).map((it, i) => it.tipo === 'pregunta' ? (
              <Pregunta key={it.id} it={it} borde={i > 0} soloLectura={soloLectura}
                onGuardado={(hecho) => setItems((its) => its && its.map((x) => (x.id === it.id ? { ...x, hecho, completado_en: new Date().toISOString() } : x)))} />
            ) : it.tipo === 'nota' ? (
              <div key={it.id} className="small" style={{ padding: '10px 14px', background: '#FFF2C2', color: '#4A3600', borderTop: i ? '1px solid var(--line-soft)' : 0, whiteSpace: 'pre-wrap', boxShadow: 'inset 4px 0 0 #E5A800' }}>
                <span className="xs" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', display: 'block' }}>Nota del PF</span>{it.nota || it.nombre}
              </div>
            ) : it.tipo === 'break' ? (
              <div key={it.id} className="xs" style={{ padding: '8px 14px', background: '#2B2E36', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#fff', borderTop: i ? '1px solid var(--line-soft)' : 0 }}>{it.nombre}</div>
            ) : (
              <button key={it.id} type="button" onClick={() => setAbierto(ejercicios.findIndex((e) => e.id === it.id))}
                style={{ width: '100%', border: 0, borderTop: i ? '1px solid var(--line-soft)' : 0, background: 'var(--card)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', minHeight: 60 }}>
                <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 13, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: it.completado_en ? '#1E9E4A' : 'transparent', border: it.completado_en ? 0 : '2px solid #C9C6BF', color: '#fff', fontSize: 15 }}>{it.completado_en ? '✓' : ''}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, overflowWrap: 'anywhere' }}>{it.nombre}</span>
                  <span className="xs muted">{esquema(comoItem(it))}</span>
                </span>
                <span aria-hidden="true" className="muted">›</span>
                <span className="sr-only">{it.completado_en ? 'Completado' : 'Pendiente'}</span>
              </button>
            ))}
          </div>
          {!soloLectura && <p className="xs muted" style={{ margin: 0 }}>Tocá un ejercicio para ver el video, la nota del PF y registrar lo que hiciste.</p>}
        </>
      )}
    </div>
  );
}

function Detalle({ e, n, total, bloque, soloLectura, onVolver, onIr, onGuardado }: {
  e: ItemEntreno; n: number; total: number; bloque: string; soloLectura: boolean;
  onVolver: () => void; onIr: (i: number) => void; onGuardado: (hecho: Serie[], completado: boolean) => void;
}) {
  const presc = prescritas(e);
  const [filas, setFilas] = useState<Fila[]>(() => presc.map((p, i) => {
    const h = e.hecho?.[i];
    return { kg: kgTxt(h ? h.kg : p.kg), reps: h ? h.reps : p.reps };
  }));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const vid = idYoutube(e.video_url);

  async function guardar(completado: boolean) {
    for (const f of filas) if (f.kg.trim() && leerKg(f.kg) == null) { setError('Los kilos tienen que ser un número (por ejemplo, 22,5).'); return; }
    const hecho = filas.map((f) => ({ reps: f.reps.trim(), kg: leerKg(f.kg) }));
    setGuardando(true); setError('');
    const { error } = await supabase.rpc('guardar_registro', { p_item: e.id, p_hecho: hecho, p_completado: completado });
    setGuardando(false);
    if (error) { setError(mensajeError(error)); return; }
    onGuardado(hecho, completado);
  }

  const cambiado = (i: number, campo: 'kg' | 'reps') => campo === 'kg'
    ? (leerKg(filas[i].kg) ?? null) !== (presc[i]?.kg ?? null)
    : filas[i].reps.trim() !== (presc[i]?.reps ?? '').trim();

  return (
    <div className="stack" style={{ maxWidth: 560, margin: '0 auto', width: '100%', gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onVolver}>‹ Día</button>
        <span className="small muted">{bloque ? `${bloque} · ` : ''}Ejercicio {n + 1} de {total}</span>
        <span className="row" style={{ gap: 4 }}>
          <button type="button" className="btn btn-sm" aria-label="Ejercicio anterior" disabled={n === 0} onClick={() => onIr(n - 1)}>‹</button>
          <button type="button" className="btn btn-sm" aria-label="Ejercicio siguiente" disabled={n + 1 >= total} onClick={() => onIr(n + 1)}>›</button>
        </span>
      </div>

      {vid ? (
        <div style={{ borderRadius: 14, overflow: 'hidden', background: '#000', aspectRatio: '9 / 16', maxHeight: 460, width: '100%', maxWidth: 260, margin: '0 auto' }}>
          <iframe title={`Video de ${e.nombre}`} src={`https://www.youtube-nocookie.com/embed/${vid}?rel=0&playsinline=1`} loading="lazy"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen style={{ border: 0, width: '100%', height: '100%' }} />
        </div>
      ) : e.video_url ? <a className="btn" href={e.video_url} target="_blank" rel="noopener noreferrer">Ver video ↗</a> : null}

      <div>
        <h2 className="display" style={{ margin: 0, fontSize: 28, overflowWrap: 'anywhere' }}>{e.nombre}</h2>
        <span className="small muted">{esquema(comoItem(e))} · {unidadTexto({ config: e.config ?? {}, cada_lado: e.cada_lado })}</span>
      </div>

      {e.consignas && <p className="small" style={{ margin: 0 }}><strong>Cómo se hace: </strong>{e.consignas}</p>}
      {e.nota && (
        <div style={{ background: '#FFF2C2', color: '#4A3600', borderRadius: 12, padding: '10px 14px' }}>
          <div className="xs" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Nota del PF</div>
          <div style={{ fontSize: 15 }}>{e.nota}</div>
        </div>
      )}

      <div className="card" style={{ padding: '4px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 1fr', gap: 8, padding: '8px 14px' }} className="xs muted">
          <strong>Serie</strong><strong>Kg</strong><strong>{e.config?.unidad === 'seg' ? 'Segundos' : 'Reps'}{e.cada_lado ? ' c/lado' : ''}</strong>
        </div>
        {filas.map((f, i) => (
          <div key={i}>
            <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 1fr', gap: 8, padding: '6px 14px', alignItems: 'center', borderTop: '1px solid var(--line-soft)' }}>
              <span style={{ fontWeight: 700, fontSize: 17 }}>{i + 1}</span>
              {soloLectura ? (
                <>
                  <span style={{ fontWeight: 600, color: cambiado(i, 'kg') ? naranja : undefined }}>{f.kg || '—'}</span>
                  <span style={{ fontWeight: 600, color: cambiado(i, 'reps') ? naranja : undefined }}>{f.reps || '—'}</span>
                </>
              ) : (
                <>
                  <input className="input" inputMode="decimal" aria-label={`Kilos de la serie ${i + 1}`} placeholder="—" value={f.kg}
                    style={{ height: 46, fontSize: 18, fontWeight: 600, color: cambiado(i, 'kg') ? naranja : undefined }}
                    onChange={(ev) => setFilas(filas.map((x, j) => (j === i ? { ...x, kg: ev.target.value } : x)))} />
                  <input className="input" aria-label={`Reps de la serie ${i + 1}`} value={f.reps} maxLength={20}
                    style={{ height: 46, fontSize: 18, fontWeight: 600, color: cambiado(i, 'reps') ? naranja : undefined }}
                    onChange={(ev) => setFilas(filas.map((x, j) => (j === i ? { ...x, reps: ev.target.value } : x)))} />
                </>
              )}
            </div>
            {e.descanso_seg != null && i < filas.length - 1 && (
              <div className="xs" style={{ padding: '5px 14px', background: '#EEF3FF', color: '#1E3A8A', fontWeight: 600 }}>Descanso {tiempoTexto(e.descanso_seg)}</div>
            )}
          </div>
        ))}
      </div>
      {filas.some((_, i) => cambiado(i, 'kg') || cambiado(i, 'reps')) && (
        <p className="xs" style={{ margin: 0, color: naranja }}>En naranja, lo que cambia respecto de lo que puso el PF.</p>
      )}

      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      {!soloLectura && (e.completado_en ? (
        <div className="stack" style={{ gap: 8 }}>
          <p className="notice notice-ok" style={{ margin: 0 }}>Ejercicio completado.</p>
          <button type="button" className="btn btn-block" disabled={guardando} onClick={() => guardar(true)}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary btn-block" style={{ height: 52, fontSize: 16 }} disabled={guardando} onClick={() => guardar(true)}>
          {guardando ? 'Guardando…' : 'Completar ejercicio'}
        </button>
      ))}
      {soloLectura && <p className="xs muted" style={{ margin: 0 }}>{e.completado_en ? 'Completado por el jugador.' : 'Todavía no lo completó.'}</p>}
    </div>
  );
}

// Una pregunta del PF dentro del entreno: barra deslizante, lista de opciones o texto.
function Pregunta({ it, borde, soloLectura, onGuardado }: { it: ItemEntreno; borde: boolean; soloLectura: boolean; onGuardado: (hecho: Serie[]) => void }) {
  const c = it.config ?? {};
  const previo = (it.hecho?.[0] ?? {}) as { valor?: number | string; texto?: string };
  const min = c.min ?? 0; const max = c.max ?? 10;
  const [valor, setValor] = useState<string>(previo.valor != null ? String(previo.valor) : previo.texto ?? '');
  const [tocado, setTocado] = useState(previo.valor != null || !!previo.texto);
  const [estado, setEstado] = useState<'' | 'guardando' | 'ok' | 'error'>(it.completado_en ? 'ok' : '');
  async function guardar() {
    if (!valor.trim()) return;
    setEstado('guardando');
    const hecho = c.formato === 'texto' ? [{ texto: valor.trim().slice(0, 500) }] : c.formato === 'opciones' ? [{ valor: valor }] : [{ valor: Number(valor) }];
    const { error } = await supabase.rpc('guardar_registro', { p_item: it.id, p_hecho: hecho, p_completado: true });
    if (error) { setEstado('error'); return; }
    setEstado('ok'); onGuardado(hecho as unknown as Serie[]);
  }
  return (
    <div style={{ padding: '12px 14px', background: '#EFE9FF', color: '#2E2160', borderTop: borde ? '1px solid var(--line-soft)' : 0, boxShadow: 'inset 4px 0 0 #7C5CE0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="xs" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Pregunta del PF</span>
      <strong style={{ fontSize: 16 }}>{it.nombre}</strong>
      {soloLectura ? (
        <span className="small">{tocado ? `Respuesta: ${valor}` : 'Todavía no respondió.'}</span>
      ) : (
        <>
          {(!c.formato || c.formato === 'escala') && (
            <div className="stack" style={{ gap: 4 }}>
              <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                <span className="xs">{min}</span>
                <input type="range" min={min} max={max} step={1} value={tocado ? Number(valor) : Math.round((min + max) / 2)} aria-label={it.nombre}
                  onChange={(e) => { setValor(e.target.value); setTocado(true); setEstado(''); }} style={{ flex: 1, accentColor: '#7C5CE0', height: 32 }} />
                <span className="xs">{max}</span>
                <strong style={{ minWidth: 28, textAlign: 'center', fontSize: 20 }}>{tocado ? valor : '–'}</strong>
              </div>
            </div>
          )}
          {c.formato === 'opciones' && (
            <select className="select" value={valor} aria-label={it.nombre} onChange={(e) => { setValor(e.target.value); setTocado(true); setEstado(''); }}>
              <option value="">Elegí una opción</option>
              {(c.opciones ?? []).map((o) => <option key={o}>{o}</option>)}
            </select>
          )}
          {c.formato === 'texto' && (
            <textarea className="input" rows={2} maxLength={500} value={valor} aria-label={it.nombre} placeholder="Escribí tu respuesta"
              onChange={(e) => { setValor(e.target.value); setTocado(true); setEstado(''); }} style={{ height: 'auto', padding: '10px 12px' }} />
          )}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-sm" style={{ background: '#7C5CE0', color: '#fff', border: 0 }} disabled={!tocado || !valor.trim() || estado === 'guardando'} onClick={guardar}>
              {estado === 'guardando' ? 'Guardando…' : estado === 'ok' ? 'Guardado ✓' : 'Responder'}
            </button>
            {estado === 'error' && <span className="xs" style={{ color: '#8F1D1D' }}>No se pudo guardar. Probá de nuevo.</span>}
          </div>
        </>
      )}
    </div>
  );
}
