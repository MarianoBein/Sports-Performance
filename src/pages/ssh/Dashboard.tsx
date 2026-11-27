import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, mensajeError } from '../../lib/supabase';
import { desdeIso, hoyIso, iso, sumarDias } from '../../lib/calendario';
import { diasEntre, fmt, type Datos, type Dia } from '../../lib/carga';
import { useDatos, Cargando } from './comun';
import { useAlertasRecientes } from './Alertas';
import { DISP, TextoRechequeo, vencido, PillEstado, PillPartido, dispDe, usePartes, vigentes, type Disp, type Parte } from './Fisio';
import Dialogo from '../../components/Dialogo';

// Dashboard del Sports Science Hub: una sola vista que junta Wellness, Sesión, Semana y Jugador.
// · Se filtra por jugadores (casillas: todos, grupos o nombres) y todo se recalcula con esa selección.
// · Cada valor se compara con la media del propio jugador en los últimos N días (7 por defecto).
// · Escala del staff para todo el wellness: 5 = mejor.
// · Un dato que falta nunca cuenta como cero.

type Comp = 'sueno' | 'fatiga' | 'estres' | 'dolor';
const COMPONENTES: { k: Comp; nombre: string; escala: string }[] = [
  { k: 'sueno', nombre: 'Sueño', escala: '5 = durmió bien' },
  { k: 'fatiga', nombre: 'Fatiga', escala: '5 = fresco' },
  { k: 'estres', nombre: 'Estrés', escala: '5 = relajado' },
  { k: 'dolor', nombre: 'Dolor', escala: '5 = sin dolor' },
];
// lib/carga ya entrega todo el wellness con 5 = mejor
const bueno = (d: Dia, k: Comp | 'preparacion'): number | null => d[k];
const prom = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const COLORES = ['#1D5BD8', '#E07A10', '#2A9D8F', '#9B3FB5', '#D23C77', '#8C5A2B', '#16307A', '#6E7F10', '#0C8DB0', '#3F444D'];
const ddmm = (f: string) => { const d = desdeIso(f); return `${d.getDate()}/${d.getMonth() + 1}`; };
const inicioTemporada = (hoy: string) => { const d = desdeIso(hoy); return `${d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1}-08-01`; };

// Diferencia contra su media → color de celda
function tono(dif: number | null): [string, string] {
  if (dif == null) return ['#FAFAF8', '#9A978F'];
  if (dif <= -1) return ['#F4C7CE', '#7A0E1F'];
  if (dif <= -0.5) return ['#FBE2C2', '#7A4100'];
  if (dif >= 0.5) return ['#D6E3FA', '#1D3F8F'];
  return ['#F1EFEA', '#16181D'];
}
const difTexto = (h: number | null, m: number | null) => {
  if (h == null || m == null) return '';
  const d = h - m;
  return Math.abs(d) < 0.05 ? '= su media' : `${d < 0 ? '↓' : '↑'} ${fmt(Math.abs(d), 1)} vs su media`;
};

function Linea({ vals, color, alto = 48, etiqueta }: { vals: (number | null)[]; color: string; alto?: number; etiqueta: string }) {
  const v = vals.filter((x): x is number => x != null);
  if (v.length < 2) return <div style={{ height: alto }} />;
  const mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1;
  const pts = vals.map((x, i) => (x == null ? null : `${(i * 240 / (vals.length - 1)).toFixed(1)},${(alto - 4 - (x - mn) / r * (alto - 8)).toFixed(1)}`)).filter(Boolean).join(' ');
  return <svg role="img" aria-label={etiqueta} viewBox={`0 0 240 ${alto}`} width="100%" height={alto} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={color} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

export default function PestanaDashboard({ edita }: { edita: boolean }) {
  const hoy = hoyIso();
  const [periodo, setPeriodo] = useState<'7' | '14' | '28' | 'temp' | 'fechas'>('14');
  const [rango, setRango] = useState({ desde: iso(sumarDias(desdeIso(hoy), -13)), hasta: hoy });
  const [ventana, setVentana] = useState<number>(7);
  const [otraVentana, setOtraVentana] = useState(false);
  const desde = periodo === 'fechas' ? rango.desde : periodo === 'temp' ? inicioTemporada(hoy) : iso(sumarDias(desdeIso(hoy), -(Number(periodo) - 1)));
  const hasta = periodo === 'fechas' ? rango.hasta : hoy;
  // Se cargan 90 días antes del período: alcanza para las medias, la carga de 7 semanas y el ACWR.
  const { datos, error } = useDatos(desde, hasta);
  const [sel, setSel] = useState<string[] | null>(null);   // null = todos
  const [resaltado, setResaltado] = useState<string | null>(null);
  const { lista: alertas } = useAlertasRecientes(2);
  const { lista: partes, cargar: cargarPartes } = usePartes(iso(sumarDias(desdeIso(hoy), -365)));
  const [lista, setLista] = useState<null | Disp>(null);

  const todos = datos?.jugadores ?? [];
  const elegidos = sel == null ? todos : todos.filter((j) => sel.includes(j.id));
  const idsElegidos = new Set(elegidos.map((j) => j.id));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" aria-label="Filtros" style={{ padding: '12px 14px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 14, position: 'relative', zIndex: 5 }}>
        <SelectorJugadores datos={datos} sel={sel} onCambio={(s) => { setSel(s); setResaltado(null); }} />
        <div className="field" style={{ gap: 4 }}>
          <span>Período</span>
          <div className="row" role="group" aria-label="Período" style={{ gap: 4 }}>
            {([['7', '7 días'], ['14', '14 días'], ['28', '28 días'], ['temp', 'Temporada'], ['fechas', 'Fechas…']] as const).map(([k, t]) => (
              <button key={k} type="button" className="chip" aria-pressed={periodo === k} onClick={() => setPeriodo(k)}>{t}</button>
            ))}
          </div>
        </div>
        {periodo === 'fechas' && (
          <div className="row" style={{ gap: 6 }}>
            <label className="field"><span>Desde</span><input className="input" type="date" value={rango.desde} max={rango.hasta} onChange={(e) => e.target.value && setRango({ ...rango, desde: e.target.value })} style={{ width: 160 }} /></label>
            <label className="field"><span>Hasta</span><input className="input" type="date" value={rango.hasta} min={rango.desde} max={hoy} onChange={(e) => e.target.value && setRango({ ...rango, hasta: e.target.value })} style={{ width: 160 }} /></label>
          </div>
        )}
        <label className="field"><span>Comparar con su media de</span>
          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <select className="select" style={{ height: 40, width: 'auto' }} value={otraVentana ? 'otra' : String(ventana)}
              onChange={(e) => { if (e.target.value === 'otra') setOtraVentana(true); else { setOtraVentana(false); setVentana(Number(e.target.value)); } }}>
              <option value="7">7 días (por defecto)</option><option value="14">14 días</option><option value="28">28 días</option><option value="otra">Otra…</option>
            </select>
            {otraVentana && <><input className="input" aria-label="Cantidad de días" type="number" min={3} max={60} value={ventana} onChange={(e) => setVentana(Math.min(60, Math.max(3, Number(e.target.value) || 7)))} style={{ width: 72, height: 40 }} /><span className="small muted">días</span></>}
          </span>
        </label>
      </section>

      {!datos ? <Cargando error={error} /> : !todos.length ? <p className="muted">Todavía no hay jugadores.</p> : (
        <Contenido datos={datos} hoy={hoy} desde={desde} hasta={hasta} ventana={ventana} elegidos={elegidos} todos={todos}
          idsElegidos={idsElegidos} alertas={alertas} partes={partes ?? []} resaltado={resaltado} setResaltado={setResaltado}
          abrirLista={setLista} soloUno={(id) => setSel([id])} />
      )}

      {lista && datos && (
        <ListaDisponibilidad tipo={lista} hoy={hoy} edita={edita} partes={partes ?? []} elegidos={elegidos} todosElegidos={sel == null}
          onCerrar={() => setLista(null)} onCambio={cargarPartes} />
      )}
    </div>
  );
}

// ---------- Filtro de jugadores con casillas ----------
function SelectorJugadores({ datos, sel, onCambio }: { datos: Datos | null; sel: string[] | null; onCambio: (s: string[] | null) => void }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);
  const todos = datos?.jugadores ?? [];
  const ids = todos.map((j) => j.id);
  const actual = sel ?? ids;
  const fijar = (s: string[]) => onCambio(s.length === ids.length ? null : s);
  const resumen = !datos ? 'Cargando…' : actual.length === ids.length ? `Todos (${ids.length})` : actual.length === 0 ? 'Ninguno' : actual.length === 1 ? (todos.find((j) => j.id === actual[0])?.nombre ?? '1 jugador') : `${actual.length} jugadores`;
  return (
    <div ref={caja} className="field" style={{ gap: 4, position: 'relative' }}>
      <span>Jugadores</span>
      <button type="button" id="dash-jugadores" aria-expanded={abierto} disabled={!datos} onClick={() => setAbierto(!abierto)}
        className="select" style={{ height: 40, minWidth: 230, textAlign: 'left', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, cursor: 'pointer' }}>
        {resumen}<span aria-hidden="true">▾</span>
      </button>
      {abierto && datos && (
        <div role="dialog" aria-label="Elegir jugadores" style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, width: 300, maxHeight: 420, overflowY: 'auto', background: '#fff', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 12px 32px rgba(22,24,29,.18)', padding: 10, display: 'flex', flexDirection: 'column', gap: 2, zIndex: 20 }}>
          <span className="xs muted" style={{ fontWeight: 700, padding: '4px 6px', letterSpacing: 0.5 }}>GRUPOS</span>
          <Casilla texto="Todos" extra={String(ids.length)} fuerte marcado={actual.length === ids.length} onCambio={() => fijar(actual.length === ids.length ? [] : ids)} />
          {datos.grupos.map((g) => {
            const miembros = todos.filter((j) => j.grupos.includes(g.id)).map((j) => j.id);
            if (!miembros.length) return null;
            const dentro = miembros.every((m) => actual.includes(m));
            return <Casilla key={g.id} texto={g.nombre} extra={String(miembros.length)} fuerte marcado={dentro}
              onCambio={() => fijar(dentro ? actual.filter((a) => !miembros.includes(a)) : [...actual, ...miembros.filter((m) => !actual.includes(m))])} />;
          })}
          <span className="xs muted" style={{ fontWeight: 700, padding: '8px 6px 4px', letterSpacing: 0.5, borderTop: '1px solid var(--line-soft)', marginTop: 4 }}>JUGADORES</span>
          {todos.map((j) => {
            const on = actual.includes(j.id);
            return <Casilla key={j.id} texto={j.nombre} marcado={on} onCambio={() => fijar(on ? actual.filter((a) => a !== j.id) : [...actual, j.id])} />;
          })}
        </div>
      )}
    </div>
  );
}
function Casilla({ texto, extra, marcado, fuerte, onCambio }: { texto: string; extra?: string; marcado: boolean; fuerte?: boolean; onCambio: () => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36, padding: '0 6px', borderRadius: 8, fontWeight: fuerte ? 600 : 400, cursor: 'pointer' }}>
      <input type="checkbox" checked={marcado} onChange={onCambio} style={{ width: 18, height: 18 }} />{texto}
      {extra && <span className="xs muted" style={{ marginLeft: 'auto', fontWeight: 400 }}>{extra}</span>}
    </label>
  );
}

// ---------- Contenido ----------
function Contenido({ datos, hoy, desde, hasta, ventana, elegidos, todos, idsElegidos, alertas, partes, resaltado, setResaltado, abrirLista, soloUno }: {
  datos: Datos; hoy: string; desde: string; hasta: string; ventana: number; elegidos: Datos['jugadores']; todos: Datos['jugadores'];
  idsElegidos: Set<string>; alertas: { perfil_id: string; fecha: string; detalle: string }[]; partes: Parte[];
  resaltado: string | null; setResaltado: (s: string | null) => void; abrirLista: (t: Disp) => void; soloUno: (id: string) => void;
}) {
  // El «hoy» del dashboard es el último día del período
  const dia = hasta < hoy ? hasta : hoy;
  const antes = (n: number, f = dia) => Array.from({ length: n }, (_, i) => iso(sumarDias(desdeIso(f), -(i + 1))));
  const media = (p: string, k: Comp | 'preparacion') => { const xs = antes(ventana).map((f) => bueno(datos.dia(p, f), k)).filter((x): x is number => x != null); return xs.length >= 3 ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
  const suma = (p: string, fechas: string[]) => { const xs = fechas.map((f) => datos.dia(p, f).esfuerzo).filter((x): x is number => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) : null; };

  const fila = useMemo(() => elegidos.map((j) => {
    const d = datos.dia(j.id, dia);
    const comps = COMPONENTES.map((c) => ({ hoy: bueno(d, c.k), media: media(j.id, c.k) }));
    const carga7 = suma(j.id, [dia, ...antes(6)]);
    const carga28 = suma(j.id, [dia, ...antes(27)]);
    const acwr = carga7 != null && carga28 ? carga7 / (carga28 / 4) : null;
    return { j, prep: { hoy: bueno(d, 'preparacion'), media: media(j.id, 'preparacion') }, comps, rpeHoy: d.rpe, esfuerzoHoy: d.esfuerzo, carga7, carga28, acwr, aplica: d.wAplica };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [datos, elegidos, dia, ventana]);

  const conDato = fila.filter((f) => f.prep.hoy != null);
  const aplica = fila.filter((f) => f.aplica).length;
  const prepHoy = prom(conDato.map((f) => f.prep.hoy));
  const prepMedia = prom(conDato.map((f) => f.prep.media));
  const tendencia = (k: Comp | 'preparacion') => [...antes(6).reverse(), dia].map((f) => prom(elegidos.map((j) => bueno(datos.dia(j.id, f), k))));
  const cargaMedia = prom(fila.map((f) => f.carga7));
  const acwrMedio = prom(fila.map((f) => f.acwr));
  const semanas = Array.from({ length: 7 }, (_, s) => prom(elegidos.map((j) => suma(j.id, Array.from({ length: 7 }, (_, i) => iso(sumarDias(desdeIso(dia), -(s * 7 + i)))))))).reverse();

  // Disponibilidad del día
  const vig = vigentes(partes, dia);
  const estadoDe = (id: string) => { const p = vig.find((x) => x.perfil_id === id); return p ? dispDe(p) : 'disponible'; };
  const cuantos = (t: Disp) => vig.filter((p) => dispDe(p) === t && (p.perfil_id ? idsElegidos.has(p.perfil_id) : elegidos.length === todos.length)).length;
  const disponibles = elegidos.filter((j) => estadoDe(j.id) === 'disponible');
  const cajas: [Disp, number][] = [['disponible', disponibles.length], ['adaptado_partido', cuantos('adaptado_partido')], ['adaptado_sin', cuantos('adaptado_sin')], ['fuera', cuantos('fuera')]];

  // A quién mirar hoy: solo lo de este día. Arriba, todas las alertas de tus reglas; abajo, los que se alejan de su propia media.
  const alertasHoy = alertas.filter((a) => a.fecha === dia && idsElegidos.has(a.perfil_id));
  const conAlerta = elegidos.map((j) => ({ j, als: alertasHoy.filter((a) => a.perfil_id === j.id).map((a) => a.detalle.split(': ').slice(1).join(': ') || a.detalle) }))
    .filter((x) => x.als.length);
  type Chip = { texto: string; muy: boolean };
  const desvios = fila.map((f) => {
    const chips: Chip[] = []; let peor = 0;
    f.comps.forEach((c, i) => { if (c.hoy != null && c.media != null && c.hoy - c.media <= -0.5) { chips.push({ texto: `${COMPONENTES[i].nombre} ${fmt(c.hoy, 0)} (media ${fmt(c.media, 1)})`, muy: c.hoy - c.media <= -1 }); peor = Math.min(peor, c.hoy - c.media); } });
    if (f.rpeHoy != null && f.rpeHoy >= 9) { chips.push({ texto: `RPE ${f.rpeHoy}`, muy: true }); peor = Math.min(peor, -1); }
    return { j: f.j, chips, peor };
  }).filter((m) => m.chips.length).sort((a, b) => a.peor - b.peor);
  const [todosDesvios, setTodosDesvios] = useState(false);
  const desviosVisibles = todosDesvios ? desvios : desvios.slice(0, 8);
  const vencidos = vig.filter((p) => vencido(p, dia) && (p.perfil_id ? idsElegidos.has(p.perfil_id) : elegidos.length === todos.length)).length;

  // Rombo: equipo entero de fondo; de 1 a 10 elegidos, una línea cada uno; más, un rombo con su promedio
  const equipo = COMPONENTES.map((c) => prom(todos.map((j) => bueno(datos.dia(j.id, dia), c.k))));
  const elegidosConDato = fila.filter((f) => f.comps.some((c) => c.hoy != null));
  const series = elegidosConDato.length <= 10
    ? elegidosConDato.map((f, i) => ({ id: f.j.id, nombre: f.j.nombre, color: COLORES[i], vals: f.comps.map((c) => c.hoy) }))
    : [{ id: 'prom', nombre: `Promedio de tu selección (${elegidosConDato.length})`, color: '#B3122E', vals: COMPONENTES.map((_, i) => prom(elegidosConDato.map((f) => f.comps[i].hoy))) }];

  // Carga del período
  const diasP = diasEntre(desde, dia);
  const barras = diasP.map((f) => ({ f, v: prom(elegidos.map((j) => datos.dia(j.id, f).esfuerzo)), partido: datos.partidos.includes(f) }));
  const maxB = Math.max(1, ...barras.map((b) => b.v ?? 0));

  const Tarjeta = ({ c, i }: { c: typeof COMPONENTES[number]; i: number }) => {
    const h = prom(conDato.map((f) => f.comps[i].hoy)), m = prom(conDato.map((f) => f.comps[i].media));
    const malo = h != null && m != null && h - m <= -0.05;
    return (
      <div style={{ background: '#2A2D33', borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 13, fontWeight: 600, color: '#E4E5E8' }}>{c.nombre}<span style={{ fontWeight: 400, fontSize: 11, color: '#9DA1A8' }}>{c.escala}</span></span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}><span className="display" style={{ fontSize: 28, color: '#fff' }}>{fmt(h, 1)}</span><span style={{ fontSize: 12.5, fontWeight: 600, color: malo ? '#FF8A9B' : '#9DC0FF' }}>{difTexto(h, m)}</span></span>
      </div>
    );
  };

  return (
    <>
      {dia !== hoy && <p className="small muted" style={{ margin: 0 }}>Mostrando el estado del {ddmm(dia)} (último día del período elegido).</p>}
      <div className="row" style={{ gap: 12, alignItems: 'stretch' }}>
        <section aria-label="Preparación" style={{ flex: '999 1 560px', minWidth: 0, background: '#16181D', color: '#fff', borderRadius: 18, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: '#F2546E' }}>PREPARACIÓN</span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span className="display" style={{ fontSize: 60, lineHeight: 1 }}>{fmt(prepHoy, 1)}</span><span style={{ color: '#C9CBD0' }}>/ 5</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: prepHoy != null && prepMedia != null && prepHoy - prepMedia <= -0.05 ? '#FF8A9B' : '#9DC0FF' }}>{difTexto(prepHoy, prepMedia)}</span>
              </span>
              <span style={{ fontSize: 12, color: '#C9CBD0' }}>{conDato.length} de {aplica || elegidos.length} respondieron · promedio de sueño, fatiga, estrés y dolor</span>
            </div>
            <div style={{ width: 240, maxWidth: '100%' }}><Linea vals={tendencia('preparacion')} color="#F2546E" alto={52} etiqueta="Preparación de los últimos 7 días" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {COMPONENTES.map((c, i) => <Tarjeta key={c.k} c={c} i={i} />)}
          </div>
        </section>
        <section aria-label="Carga semana" style={{ flex: '1 1 260px', minWidth: 0, background: '#B3122E', color: '#fff', borderRadius: 18, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: '#FFD9DF' }}>CARGA SEMANA</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span className="display" style={{ fontSize: 60, lineHeight: 1 }}>{fmt(cargaMedia, 0)}</span><span style={{ fontSize: 13, color: '#FFD9DF' }}>RPE × min</span></span>
          <span style={{ fontSize: 13, color: '#FFE7EA' }}>Media por jugador, últimos 7 días</span>
          <Linea vals={semanas} color="#FFFFFF" alto={48} etiqueta="Carga media de las últimas 7 semanas" />
          <span style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.28)' }}><span>ACWR</span><strong>{fmt(acwrMedio, 2)}</strong></span>
          <span style={{ fontSize: 11, color: '#FFD9DF' }}>Dato de contexto, sin semáforo</span>
        </section>
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'stretch' }}>
        <section className="card" aria-label="Perfil de wellness" style={{ flex: '1 1 500px', minWidth: 0, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}><strong style={{ fontSize: 17 }}>Perfil de wellness · {dia === hoy ? 'hoy' : ddmm(dia)}</strong><span className="xs muted">1 a 5 · más afuera = mejor</span></div>
          <div className="row" style={{ gap: 14, alignItems: 'center' }}>
            <Rombo equipo={equipo} series={series} resaltado={resaltado} />
            <div style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="row small" style={{ gap: 8, minHeight: 30, flexWrap: 'nowrap' }}><span style={{ width: 18, height: 12, borderRadius: 3, background: 'rgba(95,99,107,.25)', border: '2px solid #9A9DA4', flex: 'none' }} />Promedio del equipo</span>
              {series.map((s) => (
                <button key={s.id} type="button" className="rombo-leyenda" aria-pressed={resaltado === s.id} onClick={() => setResaltado(resaltado === s.id ? null : s.id)}
                  style={{ minHeight: 30, display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 8, padding: '0 6px', textAlign: 'left', cursor: 'pointer', fontSize: 13,
                    background: resaltado === s.id ? '#F1EFEA' : 'transparent', color: resaltado == null || resaltado === s.id ? 'var(--ink)' : '#9A9DA4', fontWeight: resaltado === s.id ? 700 : 500 }}>
                  <span style={{ width: 18, height: 3, borderRadius: 2, background: s.color, flex: 'none' }} />{s.nombre}
                </button>
              ))}
              <span className="xs muted" style={{ paddingTop: 4 }}>
                {!elegidosConDato.length ? 'Nadie de tu selección contestó el wellness este día.' : series.length === 1 && series[0].id === 'prom' ? 'Con más de 10 jugadores se dibuja un solo rombo con su promedio. Elegí hasta 10 para ver una línea por jugador.' : 'Tocá un nombre para resaltarlo.'}
              </span>
            </div>
          </div>
        </section>

        <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="card" aria-label="A quién mirar hoy" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <strong style={{ fontSize: 17 }}>A quién mirar {dia === hoy ? 'hoy' : `el ${ddmm(dia)}`}</strong>
            <span className="xs muted" style={{ fontWeight: 700, letterSpacing: 0.5 }}>⚠ ALERTAS DE {dia === hoy ? 'HOY' : ddmm(dia)}</span>
            {!conAlerta.length && <span className="small muted">No saltó ninguna de tus alertas.</span>}
            {conAlerta.map((m) => (
              <div key={m.j.id} className="row mirar-alerta" style={{ gap: 6, padding: '8px 10px', borderRadius: 10, background: '#16181D', color: '#fff' }}>
                <button type="button" onClick={() => soloUno(m.j.id)} title="Ver solo a este jugador" style={{ border: 0, background: 'none', color: '#fff', padding: 0, font: 'inherit', fontWeight: 700, cursor: 'pointer', minWidth: 110, textAlign: 'left' }}>{m.j.nombre}</button>
                {m.als.map((a, i) => <span key={i} className="pill" style={{ background: '#B3122E', color: '#fff', fontSize: 12 }}>⚠ {a}</span>)}
              </div>
            ))}
            <span className="xs muted" style={{ fontWeight: 700, letterSpacing: 0.5, paddingTop: 6, borderTop: '1px solid var(--line-soft)' }}>LEJOS DE SU MEDIA ({ventana} DÍAS)</span>
            {!desvios.length && <span className="small muted">Nadie de tu selección se aleja de su media.</span>}
            {desviosVisibles.map((m) => (
              <div key={m.j.id} className="row mirar" style={{ gap: 6, padding: '8px 10px', borderRadius: 10, background: 'var(--bg)' }}>
                <button type="button" onClick={() => soloUno(m.j.id)} title="Ver solo a este jugador" style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontWeight: 600, cursor: 'pointer', minWidth: 110, textAlign: 'left' }}>{m.j.nombre}</button>
                {m.chips.map((c, i) => <span key={i} className="pill" style={{ background: c.muy ? '#F4C7CE' : '#FBE2C2', color: c.muy ? '#7A0E1F' : '#7A4100', fontSize: 12 }}>{c.texto}</span>)}
              </div>
            ))}
            {desvios.length > 8 && <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setTodosDesvios(!todosDesvios)}>{todosDesvios ? 'Ver menos' : `Ver todos (${desvios.length})`}</button>}
            <span className="xs muted">Las alertas de otros días quedan en ⚙ Alertas.</span>
          </section>
          <section className="card" aria-label="Disponibilidad" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}><strong style={{ fontSize: 17 }}>Disponibilidad</strong>
              {vencidos > 0 && <span className="xs" style={{ color: '#8E1022', fontWeight: 700 }}>⚠ {vencidos} con el rechequeo vencido</span>}</div>
            <div className="disp-cajas" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
              {cajas.map(([k, n]) => (
                <button key={k} type="button" className={`disp-${k}`} onClick={() => abrirLista(k)} style={{ border: 0, borderRadius: 12, padding: '10px 4px', background: DISP[k].bg, color: DISP[k].fg, cursor: 'pointer', textAlign: 'center' }}>
                  <span className="display" style={{ display: 'block', fontSize: 30 }}>{n}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, textDecoration: 'underline', lineHeight: 1.2, display: 'block' }}>{DISP[k].nombre}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="card" aria-label="Carga del período" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}><strong style={{ fontSize: 17 }}>Carga del período</strong><span className="xs muted">Esfuerzo medio por jugador de tu selección (RPE × minutos)</span></div>
        <div style={{ overflowX: 'auto' }}>
          <div role="img" aria-label="Barras de esfuerzo medio por día; los partidos en rojo" style={{ display: 'flex', alignItems: 'flex-end', gap: barras.length > 40 ? 2 : 5, height: 180, minWidth: barras.length * (barras.length > 40 ? 10 : 26), paddingTop: 10, borderBottom: '1px solid var(--line)' }}>
            {barras.map((b) => (
              <div key={b.f} title={`${ddmm(b.f)}${b.partido ? ' · partido' : ''}: ${b.v == null ? 'sin datos' : fmt(b.v, 0)}`} style={{ flex: '1 1 0', minWidth: barras.length > 40 ? 6 : 18, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 3 }}>
                {barras.length <= 31 && <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{b.v == null ? '—' : fmt(b.v, 0)}</span>}
                <div style={{ width: '100%', maxWidth: 36, borderRadius: '5px 5px 0 0', height: b.v ? Math.max(3, Math.round(b.v / maxB * 140)) : 2, background: b.v ? (b.partido ? 'var(--accent)' : '#16181D') : '#D9D6CF' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: barras.length > 40 ? 2 : 5, minWidth: barras.length * (barras.length > 40 ? 10 : 26), paddingTop: 5 }}>
            {barras.map((b, i) => <span key={b.f} style={{ flex: '1 1 0', minWidth: barras.length > 40 ? 6 : 18, textAlign: 'center', fontSize: 10.5, color: '#3F444D' }}>{barras.length <= 31 || i % 7 === 0 ? ddmm(b.f) : ''}</span>)}
          </div>
        </div>
        <div className="row xs muted" style={{ gap: 14 }}><span className="row" style={{ gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: '#16181D' }} />Entrenamiento</span><span className="row" style={{ gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: 'var(--accent)' }} />Partido</span></div>
      </section>

      <section className="card" aria-label="Jugadores" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <strong style={{ fontSize: 17 }}>Jugadores de tu selección · {dia === hoy ? 'hoy' : ddmm(dia)}</strong>
          <span className="row xs" style={{ gap: 10, color: '#3F444D' }}>
            {([['#F4C7CE', 'Muy por debajo de su media'], ['#FBE2C2', 'Algo por debajo'], ['#F1EFEA', 'En su media'], ['#D6E3FA', 'Mejor que su media']] as const).map(([c, t]) => <span key={t} className="row" style={{ gap: 5 }}><span style={{ width: 13, height: 13, borderRadius: 4, background: c }} />{t}</span>)}
          </span>
        </div>
        <div className="table-wrap">
          <table className="tbl dash-tabla" style={{ minWidth: 820, borderCollapse: 'separate', borderSpacing: '0 4px' }}>
            <thead><tr>
              <th>Jugador</th><th style={{ textAlign: 'center', color: 'var(--ink)' }}>Preparación</th>
              {COMPONENTES.map((c) => <th key={c.k} style={{ textAlign: 'center' }}>{c.nombre}</th>)}
              <th style={{ textAlign: 'center' }} title="RPE × minutos del día; se llena a medida que cargan el RPE">Esfuerzo</th><th style={{ textAlign: 'center', color: 'var(--ink)' }}>Carga 7 días</th><th style={{ textAlign: 'center' }}>Estado</th>
            </tr></thead>
            <tbody>
              {fila.map((f) => {
                const e = estadoDe(f.j.id);
                const celda = (texto: string, t: [string, string], fuerte = false) => <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: fuerte ? 800 : 600, background: t[0], color: t[1], borderRadius: 8 }}>{texto}</td>;
                const cargaAlta = f.carga7 != null && f.carga28 ? f.carga7 > 1.3 * (f.carga28 / 4) : false;
                return (
                  <tr key={f.j.id}>
                    <th scope="row" style={{ whiteSpace: 'nowrap' }}><button type="button" onClick={() => soloUno(f.j.id)} title="Ver solo a este jugador" style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontWeight: 600, cursor: 'pointer' }}>{f.j.nombre}</button></th>
                    {celda(fmt(f.prep.hoy, 1), tono(f.prep.hoy != null && f.prep.media != null ? f.prep.hoy - f.prep.media : f.prep.hoy == null ? null : 0), true)}
                    {f.comps.map((c, i) => <td key={i} style={{ textAlign: 'center', fontWeight: 600, background: tono(c.hoy != null && c.media != null ? c.hoy - c.media : c.hoy == null ? null : 0)[0], color: tono(c.hoy != null && c.media != null ? c.hoy - c.media : c.hoy == null ? null : 0)[1], borderRadius: 8 }}>{fmt(c.hoy, 0)}</td>)}
                    {celda(fmt(f.esfuerzoHoy, 0), tono(f.esfuerzoHoy == null ? null : f.rpeHoy != null && f.rpeHoy >= 9 ? -1 : 0))}
                    {celda(fmt(f.carga7, 0), tono(f.carga7 == null ? null : cargaAlta ? -0.6 : 0), true)}
                    <td style={{ textAlign: 'center' }}><span className="pill" style={{ fontSize: 12, whiteSpace: 'nowrap', background: DISP[e].bg, color: DISP[e].fg }}>{DISP[e].corto}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <span className="xs muted">«—» = no contestó: no cuenta como cero. Esfuerzo = RPE × minutos del día, se va llenando a medida que cargan el RPE (en rojo si el RPE es 9 o más). Todas las escalas de wellness van de 1 a 5 con 5 = mejor. La carga de 7 días se marca cuando supera en 30 % su promedio semanal de las últimas 4 semanas. Tocá un nombre para ver solo a ese jugador.</span>
      </section>
    </>
  );
}

// ---------- Rombo (radar de 4 ejes) ----------
function Rombo({ equipo, series, resaltado }: { equipo: (number | null)[]; series: { id: string; color: string; vals: (number | null)[] }[]; resaltado: string | null }) {
  const cx = 180, cy = 160, R = 118;
  const pt = (i: number, v: number) => { const a = -Math.PI / 2 + i * Math.PI / 2; const r = (v - 1) / 4 * R; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  // Un valor que falta va al centro de ese eje solo para poder cerrar la figura; no es un cero: se marca abajo
  const poly = (vals: (number | null)[]) => vals.map((v, i) => pt(i, v ?? 1).map((n) => n.toFixed(1)).join(',')).join(' ');
  const nombres = COMPONENTES.map((c) => c.nombre);
  return (
    <svg role="img" aria-label="Rombo de wellness: el promedio del equipo en gris y los jugadores elegidos encima" viewBox="0 0 360 320" style={{ flex: '1 1 280px', maxWidth: 400, width: '100%' }}>
      {[2, 3, 4, 5].map((v) => <polygon key={v} points={poly([v, v, v, v])} fill="none" stroke="#E2DFD8" />)}
      {nombres.map((t, i) => {
        const p = pt(i, 5), l = pt(i, 5.55);
        return (
          <g key={t}>
            <line x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="#E2DFD8" />
            <text x={l[0]} y={l[1] + (i === 0 ? -2 : i === 2 ? 12 : 4)} textAnchor={i === 1 ? 'start' : i === 3 ? 'end' : 'middle'} fontSize={13} fontWeight={600} fill="#3F444D">{t}</text>
          </g>
        );
      })}
      {equipo.every((v) => v != null) && <polygon points={poly(equipo)} fill="rgba(95,99,107,.16)" stroke="#9A9DA4" strokeWidth={2} />}
      {series.filter((s) => s.vals.some((v) => v != null)).map((s) => (
        <polygon key={s.id} points={poly(s.vals)} fill="none" stroke={s.color} strokeLinejoin="round"
          strokeWidth={resaltado === s.id ? 3.6 : 2.2} strokeOpacity={resaltado == null || resaltado === s.id ? 1 : 0.15} />
      ))}
    </svg>
  );
}

// ---------- Ventana con la lista de disponibilidad ----------
function ListaDisponibilidad({ tipo, hoy, edita, partes, elegidos, todosElegidos, onCerrar, onCambio }: {
  tipo: Disp; hoy: string; edita: boolean; partes: Parte[]; elegidos: Datos['jugadores']; todosElegidos: boolean;
  onCerrar: () => void; onCambio: () => void;
}) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [error, setError] = useState('');
  const vig = vigentes(partes, hoy);
  const ids = new Set(elegidos.map((j) => j.id));
  const nombre = (p: Parte) => p.nombre_libre ?? elegidos.find((j) => j.id === p.perfil_id)?.nombre ?? '…';
  const deTipo = vig.filter((p) => dispDe(p) === tipo && (p.perfil_id ? ids.has(p.perfil_id) : todosElegidos)).sort((a, b) => nombre(a).localeCompare(nombre(b)));
  const conParte = new Set(vig.filter((p) => dispDe(p) !== 'disponible').map((p) => p.perfil_id));
  const disponibles = elegidos.filter((j) => !conParte.has(j.id));
  const titulo = `${DISP[tipo].nombre} (${tipo === 'disponible' ? disponibles.length : deTipo.length})`;

  async function alta(p: Parte) {
    const { error } = await supabase.rpc('dar_alta_parte', { p_id: p.id, p_fecha: hoy < p.fecha ? p.fecha : hoy });
    if (error) setError(mensajeError(error)); else { setError(''); onCambio(); }
  }

  return (
    <Dialogo titulo={titulo} ancho={520} onCerrar={onCerrar}>
      {tipo === 'disponible' ? (
        <>
          <span className="small muted">Todos los de tu selección que no tienen un parte que los deje adaptados o fuera.</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 4 }}>
            {disponibles.map((j) => <span key={j.id} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--bg)' }}>{j.nombre}</span>)}
          </div>
        </>
      ) : !deTipo.length ? <span className="small muted">Nadie en «{DISP[tipo].nombre}» en tu selección.</span> : (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small muted">Tocá un nombre para ver el porqué.</span>
          {deTipo.map((p) => {
            const on = abierto === p.id;
            return (
              <div key={p.id} style={{ border: '1px solid var(--line-soft)', borderRadius: 10, overflow: 'hidden' }}>
                <button type="button" aria-expanded={on} onClick={() => setAbierto(on ? null : p.id)}
                  style={{ width: '100%', border: 0, background: on ? 'var(--bg)' : '#fff', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: 8, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
                  <strong>{nombre(p)}</strong><span className="row" style={{ gap: 6 }}><TextoRechequeo p={p} dia={hoy} /><span className="xs muted">{on ? '▴' : '▾'}</span></span>
                </button>
                {on && (
                  <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg)' }}>
                    <span className="small">{p.motivo}</span>
                    <div className="row" style={{ gap: 6 }}><PillEstado que="Entrena" estado={p.entrena} /><PillEstado que="Pesas" estado={p.pesas} /><PillPartido p={p} /></div>
                    {p.restricciones && <span className="small">Restricciones: {p.restricciones}</span>}
                    <span className="xs muted">Parte del {ddmm(p.fecha)}{p.nombre_libre ? ' · todavía no está en la app' : ''}</span>
                    {edita && <button type="button" className="btn btn-sm btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => alta(p)}>Dar el alta</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </Dialogo>
  );
}
