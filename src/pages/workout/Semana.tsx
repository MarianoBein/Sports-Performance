import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { supabase, mensajeError } from '../../lib/supabase';
import { useSesion } from '../../lib/sesion';
import { DIAS_CORTOS, MESES, cargarActividades, hora, iso, lunesDe, sumarDias, hoyIso, desdeIso } from '../../lib/calendario';
import {
  BREAKS_SUGERIDOS, claveDestinos, esquema, etiquetaMD, itemDesdeDb, nuevoId, tiempoTexto,
  type Destino, type Ejercicio, type Item,
} from '../../lib/workout';
import {
  aplicarConflictos, destinosDe, efectivo, llave, marcarModificados, materializar, propagar,
  type Conflicto, type Ctx, type Mapa,
} from '../../lib/planes';
import EditorItem from './EditorItem';
import Dialogo from '../../components/Dialogo';

type Jugador = { id: string; nombre: string };
type Grupo = { id: string; nombre: string };
type Partido = { fecha: string; hora: string | null; rival: string | null; fuera: boolean };
type Edicion = { fecha: string; item: Item | null; tipo: 'ejercicio' | 'break' | 'nota' };
type Excepcion = { fecha: string; cuestionario: 'wellness' | 'rpe'; perfil_id: string | null; aplica: boolean };
type Vista = 'semana' | 'mes';

const accent = 'var(--accent)';
const primeroDeMes = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

export default function Semana({ biblioteca, onBibliotecaCambio }: { biblioteca: Ejercicio[]; onBibliotecaCambio: (e: Ejercicio) => void }) {
  const { perfil } = useSesion();
  const [vista, setVista] = useState<Vista>('semana');
  const [ancla, setAncla] = useState(() => lunesDe(new Date())); // lunes (semana) o día 1 (mes)
  const dias = useMemo(() => {
    const desde = vista === 'semana' ? ancla : lunesDe(ancla);
    const finMes = new Date(ancla.getFullYear(), ancla.getMonth() + 1, 0);
    const n = vista === 'semana' ? 7 : Math.round((sumarDias(lunesDe(finMes), 7).getTime() - desde.getTime()) / 86400000);
    return Array.from({ length: n }, (_, i) => iso(sumarDias(desde, i)));
  }, [vista, ancla]);

  const [clave, setClave] = useState('equipo');
  const [jugadores, setJugadores] = useState<Jugador[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [miembros, setMiembros] = useState<{ grupo_id: string; perfil_id: string }[]>([]);
  const [mapa, setMapa] = useState<Mapa | null>(null);
  const [partidos, setPartidos] = useState<Partido[]>([]);
  const [excepciones, setExcepciones] = useState<Excepcion[]>([]);
  const [conActividad, setConActividad] = useState<Set<string>>(new Set());
  const [pasado, setPasado] = useState<Mapa[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [clip, setClip] = useState<Item[]>([]);
  const [diaActivo, setDiaActivo] = useState<string>(hoyIso());
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [arrastre, setArrastre] = useState<string[]>([]);
  const [soltarEn, setSoltarEn] = useState<string | null>(null);
  const [conflictos, setConflictos] = useState<Conflicto[] | null>(null);
  const [estado, setEstado] = useState<'ok' | 'guardando' | 'error'>('ok');
  const [error, setError] = useState('');
  const pendientes = useRef<Map<string, Item[] | null>>(new Map());
  const temporizador = useRef<number | null>(null);

  // ---------- Grupos y jugadores ----------
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

  const ctx: Ctx = useMemo(() => ({
    gruposDe: (j: string) => grupos.filter((g) => miembros.some((m) => m.grupo_id === g.id && m.perfil_id === j)).map((g) => g.id),
  }), [grupos, miembros]);

  // ---------- Carga del período ----------
  const cargar = useCallback(async () => {
    setMapa(null);
    const desde = dias[0]; const hasta = dias[dias.length - 1];
    const [s, acts] = await Promise.all([
      supabase.from('sesiones')
        .select('id,fecha,destinos,sesion_items(id,orden,tipo,bloque,ejercicio_id,nombre,series,reps,cada_lado,con_carga,detalle,descanso_seg,nota,origen_id,modificado,eliminado_en)')
        .gte('fecha', desde).lte('fecha', hasta),
      cargarActividades(iso(sumarDias(desdeIso(desde), -7)), iso(sumarDias(desdeIso(hasta), 7))).catch(() => []),
    ]);
    if (s.error) { setError(mensajeError(s.error)); setMapa({}); return; }
    const m: Mapa = {};
    for (const r of (s.data ?? []) as Record<string, unknown>[]) {
      const ds = r.destinos as Destino[];
      if (!Array.isArray(ds) || ds.length !== 1) continue; // planes combinados de la versión anterior: no se usan
      m[llave(claveDestinos(ds), r.fecha as string)] = ((r.sesion_items as Record<string, unknown>[]) ?? [])
        .filter((i) => !i.eliminado_en).sort((a, b) => Number(a.orden) - Number(b.orden)).map(itemDesdeDb);
    }
    setMapa(m); setPasado([]); setSel([]);
    setPartidos(acts.filter((a) => a.es_partido).map((a) => ({ fecha: a.fecha, hora: a.hora_inicio, rival: a.rival, fuera: a.fuera })));
    setConActividad(new Set(acts.filter((a) => a.tipo === 'deportiva').map((a) => a.fecha)));
    const ex = await supabase.from('cuestionario_excepciones').select('fecha,cuestionario,perfil_id,aplica').gte('fecha', desde).lte('fecha', hasta);
    setExcepciones((ex.data as Excepcion[]) ?? []);
  }, [dias]);
  useEffect(() => { cargar(); }, [cargar]);

  // ---------- Guardado automático ----------
  const guardarPendientes = useCallback(async () => {
    if (temporizador.current) { window.clearTimeout(temporizador.current); temporizador.current = null; }
    const lote = [...pendientes.current.entries()];
    pendientes.current.clear();
    if (!lote.length) return;
    setEstado('guardando');
    const cambios = lote.map(([k, items]) => {
      const [c, fecha] = k.split('|');
      return items ? { fecha, destinos: destinosDe(c), items: items.map((it) => ({ ...it, reps: it.reps || null, nota: it.nota || null })) }
        : { fecha, destinos: destinosDe(c), borrar: true };
    });
    const { error } = await supabase.rpc('guardar_dias', { p_cambios: cambios });
    if (error) { setEstado('error'); setError(`No se pudieron guardar los cambios: ${mensajeError(error)}`); return; }
    setEstado('ok');
  }, []);

  useEffect(() => {
    const salir = () => { void guardarPendientes(); };
    window.addEventListener('beforeunload', salir);
    return () => { window.removeEventListener('beforeunload', salir); void guardarPendientes(); };
  }, [guardarPendientes]);

  function programarGuardado(antes: Mapa, despues: Mapa) {
    for (const k of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
      if (antes[k] !== despues[k]) pendientes.current.set(k, despues[k] ?? null);
    }
    setEstado('guardando');
    if (temporizador.current) window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => { void guardarPendientes(); }, 700);
  }

  function aplicarMapa(nuevo: Mapa) {
    if (!mapa) return;
    setPasado((h) => [...h, mapa].slice(-40));
    programarGuardado(mapa, nuevo);
    setMapa(nuevo);
  }

  // Toda edición del plan elegido pasa por acá: convierte el día en propio si era heredado,
  // marca lo modificado y baja los cambios a los niveles inferiores.
  function editar(op: (get: (f: string) => Item[], set: (f: string, its: Item[]) => void) => void) {
    if (!mapa) return;
    const m: Mapa = { ...mapa };
    const viejos: Record<string, Item[]> = {};
    const get = (f: string) => { const its = materializar(clave, f, m, ctx); if (!(f in viejos)) viejos[f] = its; return its; };
    const set = (f: string, its: Item[]) => { get(f); m[llave(clave, f)] = its; };
    op(get, set);
    const choques: Conflicto[] = [];
    for (const f of Object.keys(viejos)) {
      const nuevo = marcarModificados(clave, viejos[f], m[llave(clave, f)]);
      m[llave(clave, f)] = nuevo;
      propagar(clave, f, viejos[f], nuevo, m, ctx, choques);
    }
    aplicarMapa(m);
    if (choques.length) setConflictos(choques);
  }

  // En un día heredado, lo que se ve son los ejercicios de arriba; sus copias recuerdan de cuál salieron.
  const coincide = (it: Item, ids: string[]) => ids.includes(it.id) || (!!it.origen_id && ids.includes(it.origen_id));

  async function cambiarPlan(c: string) {
    await guardarPendientes();
    setClave(c); setSel([]); setPasado([]);
  }
  async function moverPeriodo(nuevo: Date, v: Vista = vista) {
    await guardarPendientes();
    setVista(v); setAncla(nuevo);
  }

  // ---------- Vista efectiva del plan elegido ----------
  const efectivoDe = (f: string) => (mapa ? efectivo(clave, f, mapa, ctx) : { items: [] as Item[], desde: clave, propio: true });
  const visibles = (f: string) => efectivoDe(f).items;

  // ---------- Acciones ----------
  const copiar = () => { const its = dias.flatMap(visibles).filter((it) => sel.includes(it.id)); if (its.length) setClip(its); };
  const pegar = (dia = diaActivo) => {
    if (!clip.length || !dias.includes(dia)) return;
    const frescos = clip.map((it) => ({ ...it, id: nuevoId(), origen_id: null, modificado: false, detalle: it.detalle.map((s) => ({ ...s })) }));
    editar((get, set) => set(dia, [...get(dia), ...frescos]));
    setSel(frescos.map((f) => f.id)); setDiaActivo(dia);
  };
  const deshacer = () => {
    if (!pasado.length || !mapa) return;
    const previo = pasado[pasado.length - 1];
    programarGuardado(mapa, previo);
    setPasado(pasado.slice(0, -1)); setMapa(previo); setSel([]);
  };
  const borrar = () => {
    if (!sel.length) return;
    const ds = dias.filter((d) => visibles(d).some((it) => sel.includes(it.id)));
    editar((get, set) => { for (const d of ds) set(d, get(d).filter((it) => !coincide(it, sel))); });
    setSel([]);
  };
  const mover = (ids: string[], dia: string, antesDe?: string) => {
    if (!ids.length || !dias.includes(dia)) return;
    const origenes = dias.filter((d) => visibles(d).some((it) => ids.includes(it.id)));
    let movidos: string[] = [];
    editar((get, set) => {
      const its: Item[] = [];
      for (const d of origenes) { const lista = get(d); its.push(...lista.filter((it) => coincide(it, ids))); set(d, lista.filter((it) => !coincide(it, ids))); }
      const destino = [...get(dia)];
      let pos = antesDe ? destino.findIndex((i) => coincide(i, [antesDe])) : -1;
      if (pos < 0) pos = destino.length;
      destino.splice(pos, 0, ...its);
      set(dia, destino);
      movidos = its.map((i) => i.id);
    });
    setSel(movidos); setDiaActivo(dia);
  };
  const volverAHeredar = (f: string) => {
    if (!mapa || clave === 'equipo') return;
    const m = { ...mapa }; delete m[llave(clave, f)];
    aplicarMapa(m);
  };
  function guardarEnDia(ed: Edicion, it: Item) {
    editar((get, set) => {
      const lista = get(ed.fecha);
      if (ed.item) {
        const prev = ed.item;
        set(ed.fecha, lista.map((x) => (coincide(x, [prev.id]) ? { ...it, id: x.id, origen_id: x.origen_id, modificado: x.modificado } : x)));
      } else set(ed.fecha, [...lista, it]);
    });
    setEdicion(null);
  }

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement | null)?.tagName ?? '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t) || edicion || conflictos) return;
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

  // ---------- Nombres ----------
  const nombrePlan = (c: string) => {
    if (c === 'equipo') return 'Todo el equipo';
    const [t, ref] = c.split(':');
    return t === 'grupo' ? (grupos.find((g) => g.id === ref)?.nombre ?? 'Grupo') : (jugadores.find((j) => j.id === ref)?.nombre ?? 'Jugador');
  };
  const nombresBreak = useMemo(() => [...new Set([...BREAKS_SUGERIDOS, ...Object.values(mapa ?? {}).flat().filter((i) => i.tipo === 'break').map((i) => i.nombre)])], [mapa]);

  if (!perfil) return null;
  const hoy = hoyIso();
  const partidosIso = partidos.map((p) => p.fecha);
  const etiquetaDia = (d: string) => `${DIAS_CORTOS[(desdeIso(d).getDay() + 6) % 7]} ${desdeIso(d).getDate()}`;
  const compacto = vista === 'mes';
  const ini = desdeIso(dias[0]);
  const fin = desdeIso(dias[dias.length - 1]);
  const titulo = compacto
    ? `${MESES[ancla.getMonth()][0].toUpperCase()}${MESES[ancla.getMonth()].slice(1)} ${ancla.getFullYear()}`
    : ini.getMonth() === fin.getMonth() ? `Semana del ${ini.getDate()} al ${fin.getDate()} de ${MESES[fin.getMonth()]}`
      : `Semana del ${ini.getDate()} de ${MESES[ini.getMonth()]} al ${fin.getDate()} de ${MESES[fin.getMonth()]}`;
  const anterior = () => moverPeriodo(compacto ? new Date(ancla.getFullYear(), ancla.getMonth() - 1, 1) : sumarDias(ancla, -7));
  const siguiente = () => moverPeriodo(compacto ? new Date(ancla.getFullYear(), ancla.getMonth() + 1, 1) : sumarDias(ancla, 7));
  const irHoy = () => moverPeriodo(compacto ? primeroDeMes(new Date()) : lunesDe(new Date()));

  const tramosDe = (its: Item[]) => {
    const out: { brk: Item | null; items: Item[] }[] = [];
    for (const it of its) {
      if (it.tipo === 'break') out.push({ brk: it, items: [] });
      else { if (!out.length) out.push({ brk: null, items: [] }); out[out.length - 1].items.push(it); }
    }
    return out;
  };

  // ---------- Wellness y RPE del día para este plan (equipo, grupo o jugador) ----------
  const modoDe = (c: 'wellness' | 'rpe') => (c === 'wellness' ? perfil.club.wellness_modo : perfil.club.rpe_modo) ?? 'todos';
  const exc = (c: string, d: string, p: string | null) => excepciones.find((x) => x.cuestionario === c && x.fecha === d && x.perfil_id === p)?.aplica;
  const aplicaJugador = (c: 'wellness' | 'rpe', d: string, j: string, tiene: boolean) => {
    const propio = exc(c, d, j); if (propio !== undefined) return propio;
    const eq = exc(c, d, null); if (eq !== undefined) return eq;
    const m = modoDe(c); return m === 'todos' || (m === 'con_actividad' && (tiene || conActividad.has(d)));
  };
  const miembrosDe = (g: string) => miembros.filter((m) => m.grupo_id === g).map((m) => m.perfil_id);
  const estadoCuest = (c: 'wellness' | 'rpe', d: string, tiene: boolean): boolean | 'mixto' => {
    if (clave === 'equipo') {
      const eq = exc(c, d, null); if (eq !== undefined) return eq;
      const m = modoDe(c); return m === 'todos' || (m === 'con_actividad' && (tiene || conActividad.has(d)));
    }
    const [t, ref] = clave.split(':');
    const js = t === 'persona' ? [ref] : miembrosDe(ref);
    if (!js.length) return false;
    const vals = js.map((j) => aplicaJugador(c, d, j, tiene));
    return vals.every((v) => v) ? true : vals.every((v) => !v) ? false : 'mixto';
  };
  async function cambiarCuest(c: 'wellness' | 'rpe', d: string, valor: boolean) {
    const [t, ref] = clave.split(':');
    const objetivos: (string | null)[] = clave === 'equipo' ? [null] : t === 'persona' ? [ref] : miembrosDe(ref);
    for (const p of objetivos) {
      const { error } = await supabase.rpc('marcar_aplica', { p_fecha: d, p_cuestionario: c, p_aplica: valor, p_perfil: p });
      if (error) { setError(mensajeError(error)); break; }
    }
    const ex = await supabase.from('cuestionario_excepciones').select('fecha,cuestionario,perfil_id,aplica').gte('fecha', dias[0]).lte('fecha', dias[dias.length - 1]);
    setExcepciones((ex.data as Excepcion[]) ?? []);
  }
  const Cuestionario = ({ c, d, tiene }: { c: 'wellness' | 'rpe'; d: string; tiene: boolean }) => {
    const est = estadoCuest(c, d, tiene);
    const nombre = c === 'wellness' ? 'Wellness' : `RPE${perfil.club.rpe_retraso_min != null ? ` · +${perfil.club.rpe_retraso_min} min` : ''}`;
    const texto = est === true ? nombre : est === 'mixto' ? `${nombre} · algunos` : `${c === 'wellness' ? 'Wellness' : 'RPE'} · no aplica`;
    return (
      <button type="button" className="xs" title={`${est === true ? 'Tocá para que no aplique' : 'Tocá para que aplique'} este día en «${nombrePlan(clave)}».${c === 'rpe' ? ' La espera del RPE se cambia en Ajustes.' : ''}`}
        onClick={(e) => { e.stopPropagation(); void cambiarCuest(c, d, est !== true); }}
        style={{
          border: `1px dashed ${est === true ? (c === 'wellness' ? '#1E9E4A' : '#1D5BD8') : '#C9C6BF'}`, borderRadius: 8, padding: '5px 8px', textAlign: 'left', cursor: 'pointer',
          background: est === true ? (c === 'wellness' ? '#EAF7EF' : '#EEF3FF') : 'transparent',
          color: est === true ? (c === 'wellness' ? '#1D5C32' : '#1E3A8A') : 'var(--muted)', textDecoration: est === false ? 'line-through' : undefined,
        }}>
        {texto}
      </button>
    );
  };

  const clicItem = (e: MouseEvent, it: Item, d: string) => {
    e.stopPropagation();
    const multi = e.metaKey || e.ctrlKey || e.shiftKey;
    setSel(multi ? (sel.includes(it.id) ? sel.filter((x) => x !== it.id) : [...sel, it.id]) : [it.id]);
    setDiaActivo(d);
  };
  const props = (it: Item, d: string) => ({
    draggable: true,
    'aria-pressed': sel.includes(it.id),
    onClick: (e: MouseEvent) => clicItem(e, it, d),
    onDoubleClick: (e: MouseEvent) => { e.stopPropagation(); setEdicion({ fecha: d, item: it, tipo: it.tipo }); },
    onDragStart: (e: DragEvent) => {
      const ids = sel.includes(it.id) ? sel : [it.id];
      try { e.dataTransfer.setData('text/plain', ids.join(',')); e.dataTransfer.effectAllowed = 'move'; } catch { /* nada */ }
      setArrastre(ids); setSel(ids);
    },
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); if (soltarEn !== d) setSoltarEn(d); },
    onDrop: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); if (!arrastre.includes(it.id)) mover(arrastre, d, it.id); setArrastre([]); setSoltarEn(null); },
  });

  return (
    <div className="stack" style={{ gap: 14 }}>
      <p className="notice notice-warn wb-aviso-movil" style={{ margin: 0 }}>El armado de los planes se hace desde el ordenador. En el móvil, mirá el entreno de cada jugador en la pestaña «Jugadores».</p>

      <div className="wb-escritorio stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 10 }}>
          <label className="row" style={{ gap: 8 }}>
            <strong style={{ fontSize: 14 }}>Plan de</strong>
            <select id="wb-plan" className="select" style={{ height: 40, width: 260 }} value={clave} onChange={(e) => { const v = e.target.value; void cambiarPlan(v); }}>
              <option value="equipo">Todo el equipo</option>
              {grupos.length > 0 && <option disabled>──── Grupos ────</option>}
              {grupos.map((g) => <option key={g.id} value={`grupo:${g.id}`}>{g.nombre}</option>)}
              {jugadores.length > 0 && <option disabled>──── Jugadores ────</option>}
              {jugadores.map((j) => <option key={j.id} value={`persona:${j.id}`}>{j.nombre}</option>)}
            </select>
          </label>
          <span className="small muted">
            {clave === 'equipo' ? 'La base: grupos y jugadores parten de este plan.'
              : clave.startsWith('grupo:') ? 'Parte del plan del equipo. Lo que cambies acá manda para los jugadores de este grupo.'
                : 'Parte del plan de su grupo (o del equipo). Lo que cambies acá manda solo para este jugador.'}
          </span>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <div>
            <h2 className="display" style={{ margin: 0, fontSize: 24 }}>{nombrePlan(clave)}</h2>
            <span className="small muted">{titulo}</span>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="btn btn-sm" aria-label={compacto ? 'Mes anterior' : 'Semana anterior'} onClick={anterior}>‹</button>
            <button type="button" className="btn btn-sm" onClick={irHoy}>Hoy</button>
            <button type="button" className="btn btn-sm" aria-label={compacto ? 'Mes siguiente' : 'Semana siguiente'} onClick={siguiente}>›</button>
          </div>
          <div className="row" role="group" aria-label="Vista" style={{ gap: 4 }}>
            <button type="button" className="chip" aria-pressed={!compacto} onClick={() => compacto && moverPeriodo(lunesDe(dias.includes(diaActivo) ? desdeIso(diaActivo) : ancla), 'semana')}>Semana</button>
            <button type="button" className="chip" aria-pressed={compacto} onClick={() => !compacto && moverPeriodo(primeroDeMes(sumarDias(ancla, 3)), 'mes')}>Mes</button>
          </div>
          <span className="spacer" />
          <span className="xs" role="status" style={{ minWidth: 90, textAlign: 'right', color: estado === 'error' ? '#8F1D1D' : 'var(--muted)' }}>
            {estado === 'guardando' ? 'Guardando…' : estado === 'error' ? 'Sin guardar' : 'Guardado'}
          </span>
        </div>

        {error && (
          <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
            {error} <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => { setError(''); setEstado('ok'); cargar(); }}>Recargar</button>
          </p>
        )}

        {!mapa ? <p className="muted">Cargando…</p> : (
          <div className="stack" style={{ gap: 8 }}>
            {compacto && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8, position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 2, padding: '4px 0' }}>
                {DIAS_CORTOS.map((d) => <span key={d} className="xs muted" style={{ fontWeight: 600, paddingLeft: 10 }}>{d}</span>)}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}>
              {dias.map((d) => {
                const md = etiquetaMD(d, partidosIso);
                const esHoy = d === hoy;
                const ef = efectivoDe(d);
                const its = ef.items;
                const fueraDeMes = compacto && desdeIso(d).getMonth() !== ancla.getMonth();
                const heredado = !ef.propio && its.length > 0;
                return (
                  <section key={d} aria-label={`${etiquetaDia(d)}${md ? `, ${md}` : ''}`}
                    onClick={() => { setDiaActivo(d); setSel([]); }}
                    onDragOver={(e) => { e.preventDefault(); if (soltarEn !== d) setSoltarEn(d); }}
                    onDragLeave={() => { if (soltarEn === d) setSoltarEn(null); }}
                    onDrop={(e) => { e.preventDefault(); mover(arrastre, d); setArrastre([]); setSoltarEn(null); }}
                    style={{
                      minHeight: compacto ? 150 : 520, borderRadius: 14, padding: compacto ? 8 : 10, display: 'flex', flexDirection: 'column', gap: compacto ? 6 : 8, minWidth: 0,
                      background: esHoy ? 'var(--card)' : '#EDEBE6', opacity: fueraDeMes ? 0.55 : 1,
                      boxShadow: soltarEn === d || esHoy ? `inset 0 0 0 2px ${accent}` : diaActivo === d ? 'inset 0 0 0 1.5px #9A9DA4' : undefined,
                    }}>
                    <header className="row" style={{ justifyContent: 'space-between', gap: 4 }}>
                      <strong style={{ fontSize: compacto ? 13 : 15 }}>{compacto ? desdeIso(d).getDate() : etiquetaDia(d)}</strong>
                      {md && <span className="pill" style={md === 'MD' ? { background: accent, color: '#fff' } : { background: 'var(--card)', color: '#3F444D' }}>{md}</span>}
                    </header>

                    {clave !== 'equipo' && (ef.propio || heredado) && (
                      <div className="xs" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, color: 'var(--muted)', flexWrap: 'wrap' }}>
                        {ef.propio
                          ? <><span className="pill" style={{ background: '#16181D', color: '#fff' }}>Propio</span>
                            <button type="button" className="xs" style={{ border: 0, background: 'transparent', color: accent, fontWeight: 600, padding: 0 }}
                              onClick={(e) => { e.stopPropagation(); volverAHeredar(d); }}>Volver a heredar</button></>
                          : <span>Hereda de {nombrePlan(ef.desde)}</span>}
                      </div>
                    )}

                    {!compacto && <Cuestionario c="wellness" d={d} tiene={its.length > 0} />}

                    {tramosDe(its).map((t, ti) => (
                      <div key={t.brk?.id ?? `inicio-${ti}`} style={{ background: 'var(--card)', borderRadius: 10, overflow: 'hidden', border: heredado ? '1px dashed #C9C6BF' : '1px solid transparent' }}>
                        {t.brk && (
                          <button type="button" {...props(t.brk, d)} aria-label={`Session break: ${t.brk.nombre}`}
                            style={{
                              width: '100%', border: 0, padding: compacto ? '5px 8px' : '7px 10px', textAlign: 'left', cursor: 'grab', fontSize: compacto ? 11 : 12, fontWeight: 700,
                              textTransform: 'uppercase', letterSpacing: '.03em', color: '#fff', overflowWrap: 'anywhere',
                              background: '#2B2E36', boxShadow: sel.includes(t.brk.id) ? `inset 0 0 0 2px ${accent}, inset 6px 0 0 ${accent}` : undefined,
                            }}>
                            {t.brk.nombre} <span style={{ fontWeight: 500, opacity: 0.7 }}>({t.items.filter((x) => x.tipo === 'ejercicio').length})</span>
                          </button>
                        )}
                        {t.items.map((it, ii) => {
                          const on = sel.includes(it.id);
                          if (it.tipo === 'nota') return (
                            <button key={it.id} type="button" {...props(it, d)} aria-label={`Nota: ${it.nota || it.nombre}`}
                              style={{
                                width: '100%', border: 0, borderTop: t.brk || ii ? '1px solid #F1EFEA' : 0, padding: compacto ? '5px 8px' : '8px 10px', textAlign: 'left', cursor: 'grab',
                                background: '#FFF2C2', color: '#4A3600', fontSize: compacto ? 11 : 12, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
                                boxShadow: on ? `inset 0 0 0 2px ${accent}, inset 6px 0 0 ${accent}` : 'inset 3px 0 0 #E5A800',
                              }}>
                              {it.nota || it.nombre}
                            </button>
                          );
                          return (
                            <button key={it.id} type="button" {...props(it, d)}
                              style={{
                                width: '100%', border: 0, borderTop: t.brk || ii ? '1px solid #F1EFEA' : 0, padding: compacto ? '5px 8px' : '8px 10px',
                                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, textAlign: 'left', cursor: 'grab',
                                background: on ? '#FDECEE' : 'var(--card)', boxShadow: on ? `inset 3px 0 0 ${accent}` : undefined,
                              }}>
                              <span style={{ fontSize: compacto ? 12 : 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{it.nombre}</span>
                              <span className="xs muted">{esquema(it)}</span>
                              {!compacto && it.descanso_seg != null && <span className="xs muted">Descanso {tiempoTexto(it.descanso_seg)}</span>}
                              {!compacto && it.nota && <span className="xs" style={{ color: '#6B4E00' }}>Nota: {it.nota}</span>}
                              {clave !== 'equipo' && ef.propio && it.modificado && <span className="xs" style={{ color: '#43307E', fontWeight: 600 }}>Cambiado en este plan</span>}
                              {clave !== 'equipo' && ef.propio && !it.origen_id && <span className="xs" style={{ color: '#43307E', fontWeight: 600 }}>Solo en este plan</span>}
                            </button>
                          );
                        })}
                      </div>
                    ))}

                    {(
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <button type="button" className="btn btn-sm btn-ghost" style={{ border: '1.5px dashed #C9C6BF', height: compacto ? 28 : undefined, fontSize: compacto ? 12 : undefined }}
                          onClick={(e) => { e.stopPropagation(); setDiaActivo(d); setEdicion({ fecha: d, item: null, tipo: 'ejercicio' }); }}>+ Ejercicio</button>
                        <button type="button" className="btn btn-sm btn-ghost" style={{ height: 26, fontSize: 12, color: 'var(--muted)' }}
                          onClick={(e) => { e.stopPropagation(); setDiaActivo(d); setEdicion({ fecha: d, item: null, tipo: 'break' }); }}>+ Session break</button>
                        <button type="button" className="btn btn-sm btn-ghost" style={{ height: 26, fontSize: 12, color: '#6B4E00' }}
                          onClick={(e) => { e.stopPropagation(); setDiaActivo(d); setEdicion({ fecha: d, item: null, tipo: 'nota' }); }}>+ Nota</button>
                      </div>
                    )}

                    <span style={{ flex: 1 }} />
                    {!compacto && <Cuestionario c="rpe" d={d} tiene={its.length > 0} />}
                  </section>
                );
              })}
            </div>
          </div>
        )}

        <p className="xs muted" style={{ margin: 0 }}>
          Clic para elegir (⌘ o Mayús para varios) · doble clic para editar · ⌘C copiar · ⌘V pegar en el día marcado · ⌘Z deshacer · Supr borrar · arrastrá para mover o reordenar. Se guarda solo.
        </p>
      </div>

      {edicion && edicion.tipo === 'ejercicio' && (
        <EditorItem
          dia={`${etiquetaDia(edicion.fecha)}${etiquetaMD(edicion.fecha, partidosIso) ? ` · ${etiquetaMD(edicion.fecha, partidosIso)}` : ''} · ${nombrePlan(clave)}`}
          item={edicion.item}
          biblioteca={biblioteca}
          jugadores={jugadores}
          jugadorInicial={clave.startsWith('persona:') ? clave.slice(8) : ''}
          onBibliotecaCambio={onBibliotecaCambio}
          onCerrar={() => setEdicion(null)}
          onGuardar={(it) => guardarEnDia(edicion, it)}
        />
      )}
      {edicion && edicion.tipo === 'nota' && (
        <EditorNota item={edicion.item} onCerrar={() => setEdicion(null)} onGuardar={(it) => guardarEnDia(edicion, it)} />
      )}
      {edicion && edicion.tipo === 'break' && (
        <EditorBreak item={edicion.item} sugeridos={nombresBreak} onCerrar={() => setEdicion(null)} onGuardar={(it) => guardarEnDia(edicion, it)} />
      )}
      {conflictos && mapa && (
        <DialogoConflictos lista={conflictos} nombrePlan={nombrePlan} etiquetaDia={etiquetaDia}
          onCerrar={() => setConflictos(null)}
          onAplicar={(elegidos) => {
            const m = { ...mapa };
            const otros: Conflicto[] = [];
            aplicarConflictos(conflictos.filter((c) => elegidos.includes(c.clave)), m, ctx, otros);
            aplicarMapa(m);
            setConflictos(otros.length ? otros : null);
          }} />
      )}
    </div>
  );
}

function DialogoConflictos({ lista, nombrePlan, etiquetaDia, onCerrar, onAplicar }: {
  lista: Conflicto[]; nombrePlan: (c: string) => string; etiquetaDia: (d: string) => string;
  onCerrar: () => void; onAplicar: (claves: string[]) => void;
}) {
  const planes = [...new Set(lista.map((c) => c.clave))];
  const [marcados, setMarcados] = useState<string[]>([]);
  const cambios = [...new Map(lista.map((c) => [`${c.tipo}|${c.padre.id}`, c])).values()];
  return (
    <Dialogo titulo="¿A quiénes se lo aplico?" onCerrar={onCerrar} ancho={520}
      pie={<>
        <button type="button" className="btn" onClick={onCerrar}>No aplicar</button>
        <button type="button" className="btn btn-primary" disabled={!marcados.length} onClick={() => onAplicar(marcados)}>Aplicar a los marcados</button>
      </>}>
      <div className="stack" style={{ gap: 12 }}>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {cambios.map((c) => (
            <li key={`${c.tipo}${c.padre.id}`} className="small">
              {c.tipo === 'borrar' ? 'Borraste' : 'Cambiaste'} «{c.padre.nombre}» ({etiquetaDia(c.fecha)})
            </li>
          ))}
        </ul>
        <p className="small" style={{ margin: 0 }}>Esto también está, personalizado, en estos planes. Marcá a cuáles querés aplicarles el cambio; los demás quedan como están.</p>
        <div className="stack" style={{ gap: 6 }}>
          {planes.map((p) => (
            <label key={p} className="row" style={{ gap: 8, cursor: 'pointer', minHeight: 36 }}>
              <input type="checkbox" checked={marcados.includes(p)} style={{ width: 18, height: 18, accentColor: '#16181D' }}
                onChange={(e) => setMarcados(e.target.checked ? [...marcados, p] : marcados.filter((x) => x !== p))} />
              <span>{p.startsWith('grupo:') ? 'Grupo' : 'Jugador'} · {nombrePlan(p)}</span>
            </label>
          ))}
        </div>
      </div>
    </Dialogo>
  );
}

function EditorBreak({ item, sugeridos, onCerrar, onGuardar }: { item: Item | null; sugeridos: string[]; onCerrar: () => void; onGuardar: (it: Item) => void }) {
  const [nombre, setNombre] = useState(item?.nombre ?? '');
  const ok = nombre.trim().length > 0;
  const guardar = () => {
    if (!ok) return;
    onGuardar({
      id: item?.id ?? nuevoId(), tipo: 'break', bloque: 'Bloque principal', ejercicio_id: null, nombre: nombre.trim(), series: 0, reps: '',
      cada_lado: false, con_carga: false, detalle: [], descanso_seg: null, nota: '', origen_id: item?.origen_id ?? null, modificado: item?.modificado ?? false,
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

function EditorNota({ item, onCerrar, onGuardar }: { item: Item | null; onCerrar: () => void; onGuardar: (it: Item) => void }) {
  const [texto, setTexto] = useState(item?.nota || item?.nombre || '');
  const ok = texto.trim().length > 0;
  const guardar = () => {
    if (!ok) return;
    const t = texto.trim();
    onGuardar({
      id: item?.id ?? nuevoId(), tipo: 'nota', bloque: 'Bloque principal', ejercicio_id: null, nombre: t.slice(0, 120), series: 0, reps: '',
      cada_lado: false, con_carga: false, detalle: [], descanso_seg: null, nota: t, origen_id: item?.origen_id ?? null, modificado: item?.modificado ?? false,
    });
  };
  return (
    <Dialogo titulo={item ? 'Editar nota' : 'Nota'} onCerrar={onCerrar} ancho={480}
      pie={<>
        <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={!ok} onClick={guardar}>{item ? 'Guardar' : 'Añadir'}</button>
      </>}>
      <label className="field"><span>Texto</span>
        <textarea id="nota-texto" className="input" autoFocus rows={4} maxLength={1000} value={texto} placeholder="Ej.: acordate de traer las bandas; hoy movilidad extra para los que jugaron más de 25 min."
          onChange={(e) => setTexto(e.target.value)} style={{ height: 'auto', padding: '10px 12px', resize: 'vertical' }} />
      </label>
      <p className="xs muted" style={{ margin: '8px 0 0' }}>La ven los jugadores de este plan en su entreno del día.</p>
    </Dialogo>
  );
}
