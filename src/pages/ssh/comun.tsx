import { useEffect, useState, type ReactNode } from 'react';
import { mensajeError } from '../../lib/supabase';
import { useSesion } from '../../lib/sesion';
import { MESES, desdeIso, hoyIso, iso, sumarDias } from '../../lib/calendario';
import { TONOS, VENTANA_MD, cargarDatos, entrePartidos, fmt, semanaDe, type Datos, type ModoPeriodo, type Periodo, type Ref, type Tono } from '../../lib/carga';

// Carga lo del periodo más 90 días hacia atrás (para las medias de referencia).
export function useDatos(desde: string, hasta: string) {
  const { perfil } = useSesion();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let vivo = true;
    setDatos(null); setError('');
    cargarDatos(iso(sumarDias(desdeIso(desde), -VENTANA_MD)), hasta, { wellness: perfil?.club.wellness_modo, rpe: perfil?.club.rpe_modo })
      .then((d) => { if (vivo) setDatos(d); })
      .catch((e) => { if (vivo) setError(mensajeError(e)); });
    return () => { vivo = false; };
  }, [desde, hasta, perfil?.club.wellness_modo, perfil?.club.rpe_modo]);
  return { datos, error };
}

const corta = (f: string) => { const d = desdeIso(f); return `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; };

export function SelectorPeriodo({ periodo, onCambio, partidos }: { periodo: Periodo; onCambio: (p: Periodo) => void; partidos: string[] }) {
  const set = (modo: ModoPeriodo, ancla: string) => {
    if (modo === 'semana') { const s = semanaDe(ancla); onCambio({ modo, desde: s.desde, hasta: s.hasta }); }
    else if (modo === 'partidos') { const e = entrePartidos(ancla, partidos); onCambio({ modo, ...e }); }
    else onCambio({ modo, desde: periodo.desde, hasta: periodo.hasta });
  };
  const mover = (dir: -1 | 1) => {
    if (periodo.modo === 'semana') set('semana', iso(sumarDias(desdeIso(periodo.desde), 7 * dir)));
    else if (periodo.modo === 'partidos') set('partidos', dir < 0 ? iso(sumarDias(desdeIso(periodo.desde), -1)) : iso(sumarDias(desdeIso(periodo.hasta), 1)));
  };
  const etiqueta = periodo.modo === 'semana'
    ? `Semana ${semanaDe(periodo.desde).numero} · ${corta(periodo.desde)} – ${corta(periodo.hasta)}`
    : `${corta(periodo.desde)} – ${corta(periodo.hasta)}`;
  return (
    <div className="row" style={{ gap: 8 }}>
      <div className="row" role="group" aria-label="Periodo" style={{ gap: 4 }}>
        {([['partidos', 'Entre partidos'], ['semana', 'Semana'], ['rango', 'Rango']] as const).map(([m, t]) => (
          <button key={m} type="button" className="chip" aria-pressed={periodo.modo === m} onClick={() => set(m, hoyIso() >= periodo.desde && hoyIso() <= periodo.hasta ? hoyIso() : periodo.desde)}>{t}</button>
        ))}
      </div>
      {periodo.modo === 'rango' ? (
        <div className="row" style={{ gap: 6 }}>
          <label><span className="sr-only">Desde</span><input type="date" className="input" style={{ height: 36, width: 160 }} value={periodo.desde} max={periodo.hasta} onChange={(e) => e.target.value && onCambio({ ...periodo, desde: e.target.value })} /></label>
          <span className="small muted">a</span>
          <label><span className="sr-only">Hasta</span><input type="date" className="input" style={{ height: 36, width: 160 }} value={periodo.hasta} min={periodo.desde} onChange={(e) => e.target.value && onCambio({ ...periodo, hasta: e.target.value })} /></label>
        </div>
      ) : (
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="btn btn-sm" aria-label="Periodo anterior" onClick={() => mover(-1)}>‹</button>
          <span className="small" style={{ fontWeight: 600, minWidth: 170, textAlign: 'center' }}>{etiqueta}</span>
          <button type="button" className="btn btn-sm" aria-label="Periodo siguiente" onClick={() => mover(1)}>›</button>
        </div>
      )}
    </div>
  );
}

export function periodoInicial(partidos: string[] = []): Periodo {
  const e = entrePartidos(hoyIso(), partidos);
  return partidos.length ? { modo: 'partidos', ...e } : { modo: 'semana', ...semanaDe(hoyIso()) };
}

export function FiltroGrupo({ datos, valor, onCambio }: { datos: Datos; valor: string; onCambio: (v: string) => void }) {
  return (
    <label><span className="sr-only">Jugadores</span>
      <select className="select" style={{ height: 36, width: 220 }} value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">Todos los jugadores</option>
        {datos.grupos.length > 0 && <optgroup label="Grupos">{datos.grupos.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.nombre}</option>)}</optgroup>}
        <optgroup label="Jugadores">{datos.jugadores.map((j) => <option key={j.id} value={`p:${j.id}`}>{j.nombre}</option>)}</optgroup>
      </select>
    </label>
  );
}
export const filtrar = (datos: Datos, f: string) => datos.jugadores.filter((j) => !f || (f.startsWith('g:') ? j.grupos.includes(f.slice(2)) : j.id === f.slice(2)));

// Una celda coloreada por el semáforo, con la referencia en el texto de ayuda.
export function Valor({ v, tono, ref, d = 1, chico, mostrarRef, minimo = 8 }: { v: number | null; tono: Tono | null; ref?: Ref; d?: number; chico?: boolean; mostrarRef?: boolean; minimo?: number }) {
  const t = tono ? TONOS[tono] : null;
  const ayuda = ref ? `Su media de referencia: ${fmt(ref.media, d)} (±${fmt(ref.de, d)}, ${ref.n} registros)${ref.n < minimo ? ' · pocos datos' : ''}${t ? ` · ${t.nombre}` : ''}` : undefined;
  return (
    <span title={ayuda} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <span className="pill" style={{
        minWidth: chico ? 30 : 44, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
        background: t ? t.bg : v == null ? 'transparent' : '#F1EFEA', color: t ? t.fg : v == null ? 'var(--muted)' : '#3F444D',
        outline: ref && ref.n < minimo && t ? '1px dashed currentColor' : undefined, outlineOffset: -1,
      }}>{fmt(v, d)}</span>
      {mostrarRef && ref && <span className="xs muted" style={{ fontVariantNumeric: 'tabular-nums' }}>ref {fmt(ref.media, d)}</span>}
    </span>
  );
}

export function Leyenda({ extra }: { extra?: ReactNode }) {
  return (
    <div className="row xs muted" style={{ gap: 12 }}>
      {(['rojo', 'verde', 'azul'] as Tono[]).map((t) => (
        <span key={t} className="row" style={{ gap: 4 }}>
          <span className="pill" style={{ background: TONOS[t].bg, color: TONOS[t].fg, padding: '1px 6px' }}>{t === 'rojo' ? 'Rojo' : t === 'verde' ? 'Verde' : 'Azul'}</span>
          {TONOS[t].nombre}
        </span>
      ))}
      <span className="row" style={{ gap: 4 }}><span className="pill" style={{ background: '#DDF3E4', color: '#1D5C32', outline: '1px dashed currentColor', outlineOffset: -1, padding: '1px 6px' }}>Borde punteado</span> pocos datos (menos de 8)</span>
      {extra}
    </div>
  );
}

export const Cargando = ({ error }: { error?: string }) => error
  ? <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>
  : <p className="muted" style={{ margin: 0 }}>Cargando datos…</p>;
