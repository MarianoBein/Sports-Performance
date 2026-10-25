import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { supabase, mensajeError } from '../../lib/supabase';
import { useSesion } from '../../lib/sesion';
import { DIAS_CORTOS, MESES, cargarActividades, hora, iso, lunesDe, sumarDias, hoyIso, desdeIso } from '../../lib/calendario';
import {
  BREAKS_SUGERIDOS, claveDestinos, esquema, etiquetaMD, itemDesdeDb, nuevoId, tiempoTexto,
  type Destino, type Ejercicio, type Item, type Sesion,
} from '../../lib/workout';
import EditorItem from './EditorItem';
import Dialogo from '../../components/Dialogo';

type Plan = Record<string, Item[]>;
type Jugador = { id: string; nombre: string };
type Grupo = { id: string; nombre: string };
type Partido = { fecha: string; hora: string | null; rival: string | null; fuera: boolean };
type Edicion = { fecha: string; item: Item | null; tipo: 'ejercicio' | 'break' };

const EQUIPO: Destino = { tipo: 'equipo' };
const accent = 'var(--accent)';

export default function Semana({ biblioteca, onBibliotecaCambio }: { biblioteca: Ejercicio[]; onBibliotecaCambio: (e: Ejercicio) => void }) {
  const { perfil } = useSesion();
  const [lunes, setLunes] = useState(() => lunesDe(new Date()));
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => iso(sumarDias(lunes, i))), [lunes]);
  const [destinos, setDestinos] = useState<Destino[]>([EQUIPO]);
  const [verJugador, setVerJugador] = useState<string>('');
  const [jugadores, setJugadores] = useState<Jugador[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [miembros, setMiembros] = useState<{ grupo_id: string; perfil_id: string }[]>([]);
  const [sesiones, setSesiones] = useState<Sesion[] | null>(null);
  const [partidos, setPartidos] = useState<Partido[]>([]);
  const [conActividad, setConActividad] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<Plan>({});
  const [pasado, setPasado] = useState<Plan[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [clip, setClip] = useState<Item[]>([]);
  const [diaActivo, setDiaActivo] = useState<string>(hoyIso());
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [arrastre, setArrastre] = useState<string[]>([]);
  const [soltarEn, setSoltarEn] = useState<string | null>(null);
  const [estado, setEstado] = useState<'ok' | 'guardando' | 'error'>('ok');
  const [error, setError] = useState('');
  const pendientes = useRef<Map<string, { destinos: Destino[]; items: Item[] }>>(new Map());
  const temporizador = useRef<number | null>(null);

  const clave = claveDestinos(destinos);

  // ---------- Carga ----------
  useEffect(() => {
    (async () => {
      const [p, g, m] = await Promise.all([
        supabase.from('perfiles').select('id,nombre,rol:roles!inner(es_jugador)').eq('rol.es_jugador', true).is('eliminado_en', null).order('nombre'),
        supabase.from('grupos').select('id,nombre').order('nombre'),
        supabase.from('grupo_miembros').select('grupo_id,perfil_id'),
      ]);
      setJugadores((p.data as unknown as Jugador[]) ?? []);
      setGrupos((g.data as Grupo[]) ?? []);
      setMiembros((m.data as { grupo_id: string; perfil_id: string }[]) ?? []);
    })();
  }, []);

  const cargarSemana = useCallback(async () => {
    setSesiones(null);
    const desde = dias[0]; const hasta = dias[6];
    const [s, acts] = await Promise.all([
      supabase.from('sesiones')
        .select('id,fecha,destinos,sesion_items(id,orden,tipo,bloque,ejercicio_id,nombre,series,reps,cada_lado,con_carga,detalle,descanso_seg,nota,eliminado_en)')
        .gte('fecha', desde).lte('fecha', hasta),
      cargarActividades(iso(sumarDias(lunes, -7)), iso(sumarDias(lunes, 13))).catch(() => []),
    ]);
    if (s.error) { setError(mensajeError(s.error)); setSesiones([]); return; }
    const lista: Sesion[] = (s.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string, fecha: r.fecha as string, destinos: r.destinos as Destino[],
      items: ((r.sesion_items as Record<string, unknown>[]) ?? [])
        .filter((i) => !i.eliminado_en).sort((a, b) => Number(a.orden) - Number(b.orden)).map(itemDesdeDb),
    }));
    setSesiones(lista);
    setPartidos(acts.filter((a) => a.es_partido).map((a) => ({ fecha: a.fecha, hora: a.hora_inicio, rival: a.rival, fuera: a.fuera })));
    setConActividad(new Set(acts.filter((a) => a.tipo === 'deportiva').map((a) => a.fecha)));
  }, [dias, lunes]);
  useEffect(() => { cargarSemana(); }, [cargarSemana]);

  // El plan editable = las sesiones de esta semana con exactamente estos destinatarios.
  useEffect(() => {
    if (!sesiones) return;
    const p: Plan = {};
    for (const d of dias) p[d] = [];
    for (const s of sesiones) if (claveDestinos(s.destinos) === clave && p[s.fecha]) p[s.fecha] = s.items;
    setPlan(p); setPasado([]); setSel([]);
  }, [sesiones, clave, dias]);

  // ---------- Guardado (automático, por día) ----------
  const guardarPendientes = useCallback(async () => {
    if (temporizador.current) { window.clearTimeout(temporizador.current); temporizador.current = null; }
    const lote = [...pendientes.current.entries()];
    pendientes.current.clear();
    if (!lote.length) return;
    setEstado('guardando');
    for (const [k, v] of lote) {
      const fecha = k.split('|')[0];
      const { error } = await supabase.rpc('guardar_dia', {
        p_fecha: fecha, p_destinos: v.destinos,
        p_items: v.items.map((it) => ({ ...it, reps: it.reps || null, nota: it.nota || null })),
      });
      if (error) { setEstado('error'); setError(`No se pudo guardar el ${fecha}: ${mensajeError(error)}`); return; }
    }
    setEstado('ok');
  }, []);

  useEffect(() => {
    const salir = () => { void guardarPendientes(); };
    window.addEventListener('beforeunload', salir);
    return () => { window.removeEventListener('beforeunload', salir); void guardarPendientes(); };
  }, [guardarPendientes]);

  function aplicar(nuevo: Plan, extra?: () => void) {
    const viejo = plan;
    for (const d of Object.keys(nuevo)) {
      if (nuevo[d] !== viejo[d]) pendientes.current.set(`${d}|${clave}`, { destinos, items: nuevo[d] });
    }
    setPasado((h) => [...h, viejo].slice(-40));
    setPlan(nuevo);
    extra?.();
    setEstado('guardando');
    if (temporizador.current) window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => { void guardarPendientes(); }, 700);
  }

  // Lo cargado + lo que se está editando ahora (para «Otros planes» y «Ver plan de»).
  const sesionesVista = useMemo(() => {
    if (!sesiones) return null;
    const otras = sesiones.filter((s) => claveDestinos(s.destinos) !== clave);
    const propias = Object.entries(plan).filter(([, its]) => its.length).map(([f, its]) => ({ id: `local-${f}`, fecha: f, destinos, items: its }));
    return [...otras, ...propias];
  }, [sesiones, plan, clave, destinos]);

  async function cambiarDestinos(d: Destino[]) {
    await guardarPendientes();
    if (sesionesVista) setSesiones(sesionesVista);
    setDestinos(d); setVerJugador('');
  }
  async function cambiarSemana(nuevoLunes: Date) {
    await guardarPendientes();
    setLunes(nuevoLunes);
  }

  // ---------- Acciones del constructor ----------
  const buscar = (ids: string[]) => dias.flatMap((d) => plan[d] ?? []).filter((it) => ids.includes(it.id));
  const sinIds = (p: Plan, ids: string[]) => Object.fromEntries(Object.entries(p).map(([d, its]) => [d, its.some((i) => ids.includes(i.id)) ? its.filter((i) => !ids.includes(i.id)) : its]));
  const esPartido = (d: string) => partidos.some((p) => p.fecha === d);

  const copiar = () => { const its = buscar(sel); if (its.length) setClip(its); };
  const pegar = (dia = diaActivo) => {
    if (!clip.length || !plan[dia] || esPartido(dia)) return;
    const frescos = clip.map((it) => ({ ...it, id: nuevoId(), detalle: it.detalle.map((s) => ({ ...s })) }));
    aplicar({ ...plan, [dia]: [...plan[dia], ...frescos] }, () => { setSel(frescos.map((f) => f.id)); setDiaActivo(dia); });
  };
  const deshacer = () => {
    if (!pasado.length) return;
    const previo = pasado[pasado.length - 1];
    for (const d of Object.keys(previo)) if (previo[d] !== plan[d]) pendientes.current.set(`${d}|${clave}`, { destinos, items: previo[d] });
    setPasado(pasado.slice(0, -1)); setPlan(previo); setSel([]);
    setEstado('guardando');
    if (temporizador.current) window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => { void guardarPendientes(); }, 700);
  };
  const borrar = () => { if (sel.length) aplicar(sinIds(plan, sel), () => setSel([])); };
  const mover = (ids: string[], dia: string, antesDe?: string) => {
    if (!ids.length || !plan[dia] || esPartido(dia)) return;
    const its = buscar(ids);
    const p = sinIds(plan, ids);
    const destino = [...(p[dia] ?? [])];
    let pos = antesDe ? destino.findIndex((i) => i.id === antesDe) : -1;
    if (pos < 0) pos = destino.length;
    destino.splice(pos, 0, ...its);
    aplicar({ ...p, [dia]: destino }, () => { setSel(ids); setDiaActivo(dia); });
  };

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement | null)?.tagName ?? '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t) || edicion || verJugador) return;
      const k = e.key.toLowerCase(); const mod = e.metaKey || e.ctrlKey;
      if (mod && k === 'c') { e.preventDefault(); copiar(); }
      else if (mod && k === 'v') { e.preventDefault(); pegar(); }
      else if (mod && k === 'z') { e.preventDefault(); deshacer(); }
      else if ((k === 'delete' || k === 'backspace') && sel.length) { e.preventDefault(); borrar(); }
      else if (k === 'escape') setSel([]);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });

  // ---------- Etiquetas de destinatarios ----------
  const nombreDestino = (d: Destino) =>
    d.tipo === 'equipo' ? 'Todo el equipo'
      : d.tipo === 'grupo' ? (grupos.find((g) => g.id === d.ref)?.nombre ?? 'Grupo')
        : (jugadores.find((j) => j.id === d.ref)?.nombre ?? 'Jugador');
  const tipoDestino = { equipo: 'Equipo', grupo: 'Grupo', persona: 'Jugador' } as const;
  const estiloDestino = { equipo: { background: '#16181D', color: '#fff' }, grupo: { background: '#E0E7FF', color: '#1E3A8A' }, persona: { background: '#EFEDE8', color: '#16181D' } } as const;
  const textoPlan = (ds: Destino[]) => ds.map(nombreDestino).join(' + ');

  const planesSemana = useMemo(() => {
    const m = new Map<string, Destino[]>();
    for (const s of sesionesVista ?? []) if (s.items.length) m.set(claveDestinos(s.destinos), s.destinos);
    m.delete(clave);
    return [...m.values()];
  }, [sesionesVista, clave]);

  // ¿Le llega este plan al jugador?
  const incluye = useCallback((ds: Destino[], j: string) => ds.some((d) =>
    d.tipo === 'equipo' || (d.tipo === 'persona' && d.ref === j) || (d.tipo === 'grupo' && miembros.some((m) => m.grupo_id === d.ref && m.perfil_id === j))), [miembros]);

  function guardarEnDia(ed: Edicion, it: Item) {
    const lista = plan[ed.fecha] ?? [];
    const nueva = ed.item ? lista.map((x) => (x.id === it.id ? it : x)) : [...lista, it];
    aplicar({ ...plan, [ed.fecha]: nueva }, () => setSel([it.id]));
    setEdicion(null);
  }

  if (!perfil) return null;
  const hoy = hoyIso();
  const fin = sumarDias(lunes, 6);
  const tituloSemana = lunes.getMonth() === fin.getMonth()
    ? `${lunes.getDate()} al ${fin.getDate()} de ${MESES[fin.getMonth()]}`
    : `${lunes.getDate()} de ${MESES[lunes.getMonth()]} al ${fin.getDate()} de ${MESES[fin.getMonth()]}`;
  const partidosIso = partidos.map((p) => p.fecha);
  const etiquetaDia = (d: string) => `${DIAS_CORTOS[(desdeIso(d).getDay() + 6) % 7]} ${desdeIso(d).getDate()}`;
  const muestra = (modo: string | undefined, d: string, tiene: boolean) => modo === 'todos' || (modo === 'con_actividad' && (tiene || conActividad.has(d)));

  // Cada session break abre un tramo; los ejercicios de abajo le pertenecen hasta el siguiente.
  const tramosDe = (its: Item[]) => {
    const out: { brk: Item | null; items: Item[] }[] = [];
    for (const it of its) {
      if (it.tipo === 'break') out.push({ brk: it, items: [] });
      else { if (!out.length) out.push({ brk: null, items: [] }); out[out.length - 1].items.push(it); }
    }
    return out;
  };
  const nombresBreak = [...new Set([...BREAKS_SUGERIDOS, ...Object.values(plan).flat().filter((i) => i.tipo === 'break').map((i) => i.nombre)])];

  const clicItem = (e: MouseEvent, it: Item, d: string) => {
    e.stopPropagation();
    const multi = e.metaKey || e.ctrlKey || e.shiftKey;
    setSel(multi ? (sel.includes(it.id) ? sel.filter((x) => x !== it.id) : [...sel, it.id]) : [it.id]);
    setDiaActivo(d);
  };
  const empezarArrastre = (e: DragEvent, it: Item) => {
    const ids = sel.includes(it.id) ? sel : [it.id];
    try { e.dataTransfer.setData('text/plain', ids.join(',')); e.dataTransfer.effectAllowed = 'move'; } catch { /* nada */ }
    setArrastre(ids); setSel(ids);
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <p className="notice notice-warn wb-aviso-movil" style={{ margin: 0 }}>El armado de la semana se hace desde el ordenador. En el móvil vas a ver el entrenamiento de cada jugador.</p>

      <div className="wb-escritorio stack" style={{ gap: 14 }}>
        {/* Para quién es el plan */}
        <div className="card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <strong style={{ fontSize: 14 }}>Asignar a</strong>
            {destinos.map((d) => (
              <span key={claveDestinos([d])} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '4px 4px 4px 10px', borderRadius: 16, fontSize: 13, fontWeight: 600, ...estiloDestino[d.tipo] }}>
                {tipoDestino[d.tipo]} · {nombreDestino(d)}
                <button type="button" aria-label={`Quitar ${nombreDestino(d)}`} disabled={destinos.length === 1}
                  onClick={() => cambiarDestinos(destinos.filter((x) => claveDestinos([x]) !== claveDestinos([d])))}
                  style={{ border: 0, background: 'transparent', color: 'inherit', width: 22, height: 22, borderRadius: 11, opacity: destinos.length === 1 ? 0.3 : 0.8 }}>×</button>
              </span>
            ))}
            <label>
              <span className="sr-only">Añadir jugador, grupo o equipo</span>
              <select id="wb-anadir-destino" className="select" style={{ height: 34, width: 240, fontSize: 13 }} value=""
                onChange={(e) => {
                  const [t, ref] = e.target.value.split(':');
                  if (!t) return;
                  const d: Destino = t === 'equipo' ? EQUIPO : ({ tipo: t as 'grupo' | 'persona', ref });
                  if (!destinos.some((x) => claveDestinos([x]) === claveDestinos([d]))) cambiarDestinos([...destinos, d]);
                }}>
                <option value="">+ Añadir jugador, grupo o equipo</option>
                <option value="equipo">Todo el equipo</option>
                {grupos.length > 0 && <optgroup label="Grupos">{grupos.map((g) => <option key={g.id} value={`grupo:${g.id}`}>{g.nombre}</option>)}</optgroup>}
                {jugadores.length > 0 && <optgroup label="Jugadores">{jugadores.map((j) => <option key={j.id} value={`persona:${j.id}`}>{j.nombre}</option>)}</optgroup>}
              </select>
            </label>
            <span className="spacer" />
            <label className="row" style={{ gap: 6 }}>
              <span className="small">Ver plan de</span>
              <select id="wb-ver-jugador" className="select" style={{ height: 34, width: 200, fontSize: 13 }} value={verJugador}
                onChange={async (e) => { const v = e.target.value; setVerJugador(v); setSel([]); await guardarPendientes(); if (sesionesVista) setSesiones(sesionesVista); }}>
                <option value="">— (armar)</option>
                {jugadores.map((j) => <option key={j.id} value={j.id}>{j.nombre}</option>)}
              </select>
            </label>
          </div>
          {planesSemana.length > 0 && !verJugador && (
            <div className="row" style={{ gap: 6 }}>
              <span className="xs muted">Otros planes esta semana:</span>
              {planesSemana.map((ds) => (
                <button key={claveDestinos(ds)} type="button" className="btn btn-sm" onClick={() => cambiarDestinos(ds)}>{textoPlan(ds)}</button>
              ))}
            </div>
          )}
        </div>

        {/* Semana y acciones */}
        <div className="row" style={{ gap: 10 }}>
          <div>
            <h2 className="display" style={{ margin: 0, fontSize: 24 }}>{verJugador ? `Plan de ${nombreDestino({ tipo: 'persona', ref: verJugador })}` : `Plan de ${textoPlan(destinos)}`}</h2>
            <span className="small muted">Semana del {tituloSemana}</span>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="btn btn-sm" aria-label="Semana anterior" onClick={() => cambiarSemana(sumarDias(lunes, -7))}>‹</button>
            <button type="button" className="btn btn-sm" onClick={() => cambiarSemana(lunesDe(new Date()))}>Hoy</button>
            <button type="button" className="btn btn-sm" aria-label="Semana siguiente" onClick={() => cambiarSemana(sumarDias(lunes, 7))}>›</button>
          </div>
          <span className="spacer" />
          {!verJugador && (
            <div className="row" style={{ gap: 4 }}>
              <button type="button" className="btn btn-sm" disabled={!sel.length} onClick={copiar} title="⌘C / Ctrl+C">Copiar{sel.length > 1 ? ` (${sel.length})` : ''}</button>
              <button type="button" className="btn btn-sm" disabled={!clip.length || esPartido(diaActivo)} onClick={() => pegar()} title="⌘V / Ctrl+V">Pegar en {etiquetaDia(diaActivo in plan ? diaActivo : dias[0])}</button>
              <button type="button" className="btn btn-sm" disabled={!pasado.length} onClick={deshacer} title="⌘Z / Ctrl+Z">Deshacer</button>
              <button type="button" className="btn btn-sm link-danger" disabled={!sel.length} onClick={borrar} title="Supr">Borrar</button>
            </div>
          )}
          <span className="xs" role="status" style={{ minWidth: 90, textAlign: 'right', color: estado === 'error' ? '#8F1D1D' : 'var(--muted)' }}>
            {estado === 'guardando' ? 'Guardando…' : estado === 'error' ? 'Sin guardar' : 'Guardado'}
          </span>
        </div>

        {error && (
          <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
            {error} <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => { setError(''); setEstado('ok'); cargarSemana(); }}>Recargar</button>
          </p>
        )}

        {!sesiones ? <p className="muted">Cargando semana…</p> : (
          <div className="wb-grilla" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}>
            {dias.map((d) => {
              const partido = partidos.find((p) => p.fecha === d);
              const md = etiquetaMD(d, partidosIso);
              const esHoy = d === hoy;
              const its = plan[d] ?? [];
              const soltando = soltarEn === d;
              const propios = verJugador
                ? (sesionesVista ?? []).filter((s) => s.fecha === d && s.items.length && incluye(s.destinos, verJugador))
                : null;
              const tieneAlgo = propios ? propios.length > 0 : its.length > 0;
              return (
                <section key={d} aria-label={`${etiquetaDia(d)}${md ? `, ${md}` : ''}`}
                  onClick={() => { setDiaActivo(d); setSel([]); }}
                  onDragOver={(e) => { if (verJugador || partido) return; e.preventDefault(); if (soltarEn !== d) setSoltarEn(d); }}
                  onDragLeave={() => { if (soltarEn === d) setSoltarEn(null); }}
                  onDrop={(e) => { e.preventDefault(); mover(arrastre, d); setArrastre([]); setSoltarEn(null); }}
                  style={{
                    minHeight: 520, borderRadius: 14, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
                    background: esHoy ? 'var(--card)' : '#EDEBE6',
                    boxShadow: soltando ? `inset 0 0 0 2px ${accent}` : esHoy ? `inset 0 0 0 2px ${accent}` : diaActivo === d && !verJugador ? 'inset 0 0 0 1.5px #9A9DA4' : undefined,
                  }}>
                  <header className="row" style={{ justifyContent: 'space-between', gap: 4 }}>
                    <strong style={{ fontSize: 15 }}>{etiquetaDia(d)}</strong>
                    {md && <span className="pill" style={md === 'MD' ? { background: accent, color: '#fff' } : { background: 'var(--card)', color: '#3F444D' }}>{md}</span>}
                  </header>

                  {partido && (
                    <div className="xs" style={{ background: '#FDE3E6', color: '#8F0E1F', borderRadius: 8, padding: '6px 8px', fontWeight: 600 }}>
                      Partido{partido.hora ? ` · ${hora(partido.hora)}` : ''}{partido.rival ? ` · ${partido.fuera ? 'en' : 'vs'} ${partido.rival}` : ''}
                    </div>
                  )}

                  {muestra(perfil.club.wellness_modo, d, tieneAlgo) && (
                    <div className="xs muted" style={{ border: '1px dashed #C9C6BF', borderRadius: 8, padding: '5px 8px' }}>Wellness</div>
                  )}

                  {propios ? propios.map((s) => (
                    <div key={s.id} style={{ background: 'var(--card)', borderRadius: 10, overflow: 'hidden' }}>
                      <div className="xs" style={{ padding: '6px 10px', fontWeight: 600, color: '#3F444D', display: 'flex', justifyContent: 'space-between', gap: 6, background: '#F6F5F2' }}>
                        <span style={{ overflowWrap: 'anywhere' }}>{textoPlan(s.destinos)}</span>
                        <button type="button" className="xs" style={{ border: 0, background: 'transparent', color: accent, fontWeight: 600, padding: 0 }}
                          onClick={(e) => { e.stopPropagation(); cambiarDestinos(s.destinos); }}>Editar</button>
                      </div>
                      {s.items.map((it) => it.tipo === 'break' ? (
                        <div key={it.id} className="xs" style={{ borderTop: '1px solid #F1EFEA', padding: '6px 10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: '#3F444D', overflowWrap: 'anywhere' }}>{it.nombre}</div>
                      ) : (
                        <div key={it.id} style={{ borderTop: '1px solid #F1EFEA', padding: '7px 10px' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{it.nombre}</div>
                          <div className="xs muted">{esquema(it)}</div>
                        </div>
                      ))}
                    </div>
                  )) : tramosDe(its).map((t, ti) => (
                    <div key={t.brk?.id ?? `inicio-${ti}`} style={{ background: 'var(--card)', borderRadius: 10, overflow: 'hidden' }}>
                      {t.brk && (() => {
                        const it = t.brk; const on = sel.includes(it.id);
                        return (
                          <button type="button" draggable aria-pressed={on} aria-label={`Session break: ${it.nombre}`}
                            onClick={(e) => clicItem(e, it, d)}
                            onDoubleClick={(e) => { e.stopPropagation(); setEdicion({ fecha: d, item: it, tipo: 'break' }); }}
                            onDragStart={(e) => empezarArrastre(e, it)}
                            onDragOver={(e) => { if (!partido) { e.preventDefault(); e.stopPropagation(); if (soltarEn !== d) setSoltarEn(d); } }}
                            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (!arrastre.includes(it.id)) mover(arrastre, d, it.id); setArrastre([]); setSoltarEn(null); }}
                            style={{
                              width: '100%', border: 0, padding: '7px 10px', textAlign: 'left', cursor: 'grab', fontSize: 12, fontWeight: 700,
                              textTransform: 'uppercase', letterSpacing: '.03em', color: on ? '#16181D' : '#3F444D', overflowWrap: 'anywhere',
                              background: on ? '#FDECEE' : '#F6F5F2', boxShadow: on ? `inset 3px 0 0 ${accent}` : undefined,
                            }}>
                            {it.nombre} <span style={{ fontWeight: 500, color: 'var(--muted)' }}>({t.items.length})</span>
                          </button>
                        );
                      })()}
                      {t.items.map((it, ii) => {
                        const on = sel.includes(it.id);
                        return (
                          <button key={it.id} type="button" draggable aria-pressed={on}
                            onClick={(e) => clicItem(e, it, d)}
                            onDoubleClick={(e) => { e.stopPropagation(); setEdicion({ fecha: d, item: it, tipo: 'ejercicio' }); }}
                            onDragStart={(e) => empezarArrastre(e, it)}
                            onDragOver={(e) => { if (!partido) { e.preventDefault(); e.stopPropagation(); if (soltarEn !== d) setSoltarEn(d); } }}
                            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (!arrastre.includes(it.id)) mover(arrastre, d, it.id); setArrastre([]); setSoltarEn(null); }}
                            style={{
                              width: '100%', border: 0, borderTop: t.brk || ii ? '1px solid #F1EFEA' : 0, padding: '8px 10px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                              textAlign: 'left', cursor: 'grab', background: on ? '#FDECEE' : 'var(--card)', boxShadow: on ? `inset 3px 0 0 ${accent}` : undefined,
                            }}>
                            <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{it.nombre}</span>
                            <span className="xs muted">{esquema(it)}</span>
                            {it.descanso_seg != null && <span className="xs muted">Descanso {tiempoTexto(it.descanso_seg)}</span>}
                            {it.nota && <span className="xs" style={{ color: '#6B4E00' }}>Nota: {it.nota}</span>}
                          </button>
                        );
                      })}
                    </div>
                  ))}

                  {!verJugador && !partido && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <button type="button" className="btn btn-sm btn-ghost" style={{ border: '1.5px dashed #C9C6BF' }}
                        onClick={(e) => { e.stopPropagation(); setDiaActivo(d); setEdicion({ fecha: d, item: null, tipo: 'ejercicio' }); }}>+ Añadir ejercicio</button>
                      <button type="button" className="btn btn-sm btn-ghost" style={{ height: 30, fontSize: 12, color: 'var(--muted)' }}
                        onClick={(e) => { e.stopPropagation(); setDiaActivo(d); setEdicion({ fecha: d, item: null, tipo: 'break' }); }}>+ Session break</button>
                    </div>
                  )}

                  <span style={{ flex: 1 }} />
                  {muestra(perfil.club.rpe_modo, d, tieneAlgo) && (
                    <div className="xs muted" style={{ border: '1px dashed #C9C6BF', borderRadius: 8, padding: '5px 8px' }}>
                      RPE{perfil.club.rpe_retraso_min != null ? ` · +${perfil.club.rpe_retraso_min} min` : ''}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {!verJugador && (
          <p className="xs muted" style={{ margin: 0 }}>
            Clic para elegir (⌘ o Mayús para varios) · doble clic para editar · ⌘C copiar · ⌘V pegar en el día marcado · ⌘Z deshacer · Supr borrar · arrastrá para mover a otro día o reordenar. Se guarda solo.
          </p>
        )}
      </div>

      {edicion && edicion.tipo === 'ejercicio' && (
        <EditorItem
          dia={`${etiquetaDia(edicion.fecha)}${etiquetaMD(edicion.fecha, partidosIso) ? ` · ${etiquetaMD(edicion.fecha, partidosIso)}` : ''} · ${textoPlan(destinos)}`}
          item={edicion.item}
          biblioteca={biblioteca}
          onBibliotecaCambio={onBibliotecaCambio}
          onCerrar={() => setEdicion(null)}
          onGuardar={(it) => guardarEnDia(edicion, it)}
        />
      )}
      {edicion && edicion.tipo === 'break' && (
        <EditorBreak item={edicion.item} sugeridos={nombresBreak} onCerrar={() => setEdicion(null)} onGuardar={(it) => guardarEnDia(edicion, it)} />
      )}
    </div>
  );
}

function EditorBreak({ item, sugeridos, onCerrar, onGuardar }: { item: Item | null; sugeridos: string[]; onCerrar: () => void; onGuardar: (it: Item) => void }) {
  const [nombre, setNombre] = useState(item?.nombre ?? '');
  const ok = nombre.trim().length > 0;
  const guardar = () => {
    if (!ok) return;
    onGuardar({
      id: item?.id ?? nuevoId(), tipo: 'break', bloque: 'Bloque principal', ejercicio_id: null, nombre: nombre.trim(), series: 0, reps: '',
      cada_lado: false, con_carga: false, detalle: [], descanso_seg: null, nota: '',
    });
  };
  return (
    <Dialogo titulo={item ? 'Editar session break' : 'Session break'} onCerrar={onCerrar} ancho={480}
      pie={<>
        <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={!ok} onClick={guardar}>{item ? 'Guardar' : 'Añadir'}</button>
      </>}>
      <div className="stack" style={{ gap: 10 }}>
        <label className="field"><span>Nombre</span>
          <input id="brk-nombre" className="input" autoFocus maxLength={120} value={nombre} placeholder="Bloque principal, Main block, Accessories…"
            onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } }} />
        </label>
        <div className="row" style={{ gap: 6 }}>
          {sugeridos.map((n) => <button key={n} type="button" className="chip" aria-pressed={nombre === n} onClick={() => setNombre(n)}>{n}</button>)}
        </div>
        <p className="xs muted" style={{ margin: 0 }}>Todo lo que quede debajo pertenece a este break, hasta el siguiente.</p>
      </div>
    </Dialogo>
  );
}
