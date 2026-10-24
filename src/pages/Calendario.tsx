import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, mensajeError } from '../lib/supabase';
import { useSesion } from '../lib/sesion';
import {
  DIAS_CORTOS, ETIQUETAS, MESES, TIPOS, cargarActividades, desdeIso, diaSemana, enlaceMapa, fechaLarga, hora, hoyIso,
  iso, lunesDe, sumarDias, titulo, type Actividad, type Destino, type Tipo,
} from '../lib/calendario';

type PersonaMin = { id: string; nombre: string; rol: { nombre: string; clave: string; es_jugador: boolean } | null };
type Grupo = { id: string; nombre: string };
type Lugar = { id: string; nombre: string; direccion: string | null };
type Vista = 'mes' | 'semana' | 'dia';

function Dialogo({ titulo: t, onCerrar, children, pie, ancho = 640 }: { titulo: string; onCerrar: () => void; children: ReactNode; pie?: ReactNode; ancho?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCerrar]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-label={t} style={{ maxWidth: ancho }}>
        <div className="dialog-head">
          <h2 className="display">{t}</h2>
          <button type="button" className="close" aria-label="Cerrar" onClick={onCerrar}>×</button>
        </div>
        <div className="dialog-body">{children}</div>
        {pie && <div className="dialog-foot">{pie}</div>}
      </section>
    </div>
  );
}

const Pin = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>
);

export default function Calendario() {
  const { perfil, permisos } = useSesion();
  const nav = useNavigate();
  const nivel = permisos?.calendario.nivel ?? 'sin';
  const puedeCrear = nivel === 'editar' || nivel === 'propio';
  const puedeExportar = !!(perfil?.es_admin || permisos?.calendario.exporta);

  const [vista, setVista] = useState<Vista>(() => (window.innerWidth < 760 ? 'dia' : 'mes'));
  const [ref, setRef] = useState(() => new Date());
  const [acts, setActs] = useState<Actividad[]>([]);
  const [personas, setPersonas] = useState<PersonaMin[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [lugares, setLugares] = useState<Lugar[]>([]);
  const [mostrar, setMostrar] = useState<Record<Tipo, boolean>>({ deportiva: true, logistica: true, prensa: true });
  const [detalle, setDetalle] = useState<Actividad | null>(null);
  const [form, setForm] = useState<{ actividad?: Actividad; fecha?: string } | null>(null);
  const [suscribir, setSuscribir] = useState(false);
  const [error, setError] = useState('');

  const rango = useMemo(() => {
    if (vista === 'mes') {
      const inicio = lunesDe(new Date(ref.getFullYear(), ref.getMonth(), 1));
      return { desde: inicio, dias: 42 };
    }
    if (vista === 'semana') return { desde: lunesDe(ref), dias: 7 };
    return { desde: new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()), dias: 1 };
  }, [vista, ref]);

  const cargar = useCallback(async () => {
    try {
      setActs(await cargarActividades(iso(rango.desde), iso(sumarDias(rango.desde, rango.dias - 1))));
      setError('');
    } catch (e) { setError(mensajeError(e)); }
  }, [rango]);
  useEffect(() => { cargar(); }, [cargar]);

  const cargarLugares = useCallback(async () => {
    const { data } = await supabase.from('lugares').select('id,nombre,direccion').order('nombre');
    setLugares((data as Lugar[]) ?? []);
  }, []);
  useEffect(() => {
    (async () => {
      const [p, g] = await Promise.all([
        supabase.from('perfiles').select('id,nombre,rol:roles(nombre,clave,es_jugador)').is('eliminado_en', null).order('nombre'),
        supabase.from('grupos').select('id,nombre').order('nombre'),
      ]);
      setPersonas((p.data as unknown as PersonaMin[]) ?? []);
      setGrupos((g.data as Grupo[]) ?? []);
      cargarLugares();
    })();
  }, [cargarLugares]);

  const nombreDe = useCallback((id: string | null) => personas.find((p) => p.id === id)?.nombre ?? '—', [personas]);
  const visibles = acts.filter((a) => mostrar[a.tipo]);
  const deDia = (d: string) => visibles.filter((a) => a.fecha === d);
  const hoy = hoyIso();

  function mover(n: number) {
    const d = new Date(ref);
    if (vista === 'mes') d.setMonth(d.getMonth() + n, 1);
    else d.setDate(d.getDate() + (vista === 'semana' ? 7 * n : n));
    setRef(d);
  }
  const cabecera = vista === 'mes'
    ? `${MESES[ref.getMonth()][0].toUpperCase()}${MESES[ref.getMonth()].slice(1)} ${ref.getFullYear()}`
    : vista === 'semana'
      ? (() => { const a = lunesDe(ref), b = sumarDias(a, 6); return `${a.getDate()} ${a.getMonth() !== b.getMonth() ? MESES[a.getMonth()] + ' ' : ''}al ${b.getDate()} de ${MESES[b.getMonth()]}`; })()
      : fechaLarga(iso(ref));

  const pendienteMio = (a: Actividad) => a.confirmaciones.some((c) => c.perfil_id === perfil?.id && c.estado === 'pendiente');
  const hayPendientes = (a: Actividad) => a.tipo === 'prensa' && a.confirmaciones.some((c) => c.estado !== 'acepta');

  const Chip = ({ a }: { a: Actividad }) => {
    const t = TIPOS[a.tipo];
    const relleno = a.todo_el_dia || a.es_partido;
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); setDetalle(a); }}
        style={{ width: '100%', minHeight: 24, border: 0, borderRadius: 6, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 5, font: `${a.es_partido ? 700 : 500} 12px Inter, sans-serif`, textAlign: 'left', background: relleno ? t.bg : 'transparent', color: relleno ? t.fg : 'var(--ink)' }}>
        {!a.todo_el_dia && <span style={{ flex: 'none', width: 7, height: 7, borderRadius: 4, background: t.color }} />}
        <span style={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{a.todo_el_dia ? 'Todo el día' : hora(a.hora_inicio)}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titulo(a)}</span>
        {hayPendientes(a) && <span aria-label="Pendiente de confirmación" style={{ flex: 'none', width: 8, height: 8, borderRadius: 4, background: '#E07A1F' }} />}
      </button>
    );
  };

  const Tarjeta = ({ a }: { a: Actividad }) => {
    const t = TIPOS[a.tipo];
    return (
      <button type="button" className="card" onClick={() => setDetalle(a)}
        style={{ width: '100%', border: 0, padding: 14, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, background: a.es_partido ? t.bg : '#fff' }}>
        <span className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: t.color }}>{a.todo_el_dia ? 'Todo el día' : hora(a.hora_inicio) + (a.hora_fin ? `–${hora(a.hora_fin)}` : '')} · {t.nombre}</span>
          {a.lugar && <span className="xs muted">{a.lugar}</span>}
        </span>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{titulo(a)}</span>
        {pendienteMio(a) && <span className="small" style={{ color: 'var(--warn-fg)', fontWeight: 600 }}>Prensa espera tu confirmación</span>}
      </button>
    );
  };

  return (
    <div>
      <div className="page-head" style={{ alignItems: 'center' }}>
        <div className="row">
          <button type="button" className="btn" onClick={() => setRef(new Date())}>Hoy</button>
          <button type="button" className="btn" aria-label="Anterior" onClick={() => mover(-1)} style={{ width: 44, padding: 0 }}>‹</button>
          <button type="button" className="btn" aria-label="Siguiente" onClick={() => mover(1)} style={{ width: 44, padding: 0 }}>›</button>
          <h1 className="display" style={{ fontSize: 32, marginLeft: 4 }}>{cabecera}</h1>
        </div>
        <div className="row">
          <div role="group" aria-label="Vista" style={{ display: 'flex', gap: 4, padding: 4, background: '#E9E7E2', borderRadius: 10 }}>
            {(['mes', 'semana', 'dia'] as Vista[]).map((v) => (
              <button key={v} type="button" aria-pressed={vista === v} onClick={() => setVista(v)}
                style={{ height: 36, padding: '0 14px', border: 0, borderRadius: 8, fontWeight: vista === v ? 600 : 500, background: vista === v ? '#fff' : 'transparent', color: vista === v ? 'var(--ink)' : 'var(--muted)' }}>
                {v === 'mes' ? 'Mes' : v === 'semana' ? 'Semana' : 'Día'}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => setSuscribir(true)}>Añadir a mi calendario</button>
          {puedeExportar && <button type="button" className="btn" onClick={() => nav(`/calendario/exportar?desde=${iso(lunesDe(ref))}`)}>Exportar semana</button>}
          {puedeCrear && <button type="button" className="btn btn-primary" onClick={() => setForm({ fecha: iso(ref) })}>+ Añadir actividad</button>}
        </div>
      </div>

      <div className="row" role="group" aria-label="Mostrar tipos" style={{ gap: 6, marginBottom: 12 }}>
        {(Object.keys(TIPOS) as Tipo[]).map((k) => (
          <button key={k} type="button" aria-pressed={mostrar[k]} onClick={() => setMostrar({ ...mostrar, [k]: !mostrar[k] })}
            style={{ height: 34, padding: '0 12px', borderRadius: 17, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, border: `1.5px solid ${mostrar[k] ? TIPOS[k].color : 'var(--field)'}`, background: mostrar[k] ? TIPOS[k].bg : '#fff', color: mostrar[k] ? TIPOS[k].fg : '#8A8F99', textDecoration: mostrar[k] ? 'none' : 'line-through' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: TIPOS[k].color }} />{TIPOS[k].nombre}
          </button>
        ))}
      </div>

      {error && <p className="notice notice-error" role="alert">{error}</p>}

      {vista === 'mes' && (
        <div className="card table-wrap">
          <div style={{ minWidth: 860 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', borderBottom: '1px solid var(--line)' }}>
              {DIAS_CORTOS.map((d) => <div key={d} style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' }}>{d}</div>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))' }}>
              {Array.from({ length: 42 }, (_, i) => {
                const d = sumarDias(rango.desde, i);
                const s = iso(d);
                const lista = deDia(s);
                const otroMes = d.getMonth() !== ref.getMonth();
                const fuera = lista.some((a) => a.es_partido && a.fuera);
                return (
                  <div key={s} onClick={() => { if (puedeCrear) setForm({ fecha: s }); }}
                    style={{ minHeight: 118, padding: 6, borderRight: '1px solid var(--line-soft)', borderBottom: '1px solid var(--line-soft)', display: 'flex', flexDirection: 'column', gap: 3, background: otroMes ? '#FAFAF8' : fuera ? '#F2F9EE' : '#fff', cursor: puedeCrear ? 'pointer' : 'default' }}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setRef(d); setVista('dia'); }} aria-label={fechaLarga(s)}
                      style={{ alignSelf: 'flex-start', border: 0, padding: '2px 7px', borderRadius: 12, fontSize: 13, fontWeight: 700, background: s === hoy ? 'var(--accent)' : 'transparent', color: s === hoy ? '#fff' : otroMes ? '#B7B3AA' : 'var(--ink)' }}>
                      {d.getDate()}
                    </button>
                    {lista.slice(0, 3).map((a) => <Chip key={a.id} a={a} />)}
                    {lista.length > 3 && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setRef(d); setVista('dia'); }} style={{ border: 0, background: 'transparent', textAlign: 'left', padding: '0 6px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>+{lista.length - 3} más</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {vista === 'semana' && (
        <div className="stack" style={{ gap: 8, maxWidth: 760 }}>
          {Array.from({ length: 7 }, (_, i) => {
            const d = sumarDias(rango.desde, i);
            const s = iso(d);
            const lista = deDia(s);
            return (
              <section key={s} aria-label={fechaLarga(s)} className="card" style={{ display: 'flex', gap: 12, padding: '12px 14px', boxShadow: s === hoy ? 'inset 0 0 0 2px var(--accent)' : undefined }}>
                <div style={{ width: 44, flex: 'none', textAlign: 'center' }}>
                  <div className="xs muted" style={{ fontWeight: 600, textTransform: 'uppercase' }}>{DIAS_CORTOS[diaSemana(d)]}</div>
                  <div className="display" style={{ fontSize: 26, color: s === hoy ? 'var(--accent)' : undefined }}>{d.getDate()}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {lista.length === 0 && <span className="small muted" style={{ paddingTop: 6 }}>Sin actividades</span>}
                  {lista.map((a) => <Chip key={a.id} a={a} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {vista === 'dia' && (
        <div className="stack" style={{ gap: 10, maxWidth: 640 }}>
          {deDia(iso(ref)).length === 0 && <div className="card muted" style={{ padding: 16 }}>No hay actividades este día.</div>}
          {deDia(iso(ref)).map((a) => <Tarjeta key={a.id} a={a} />)}
        </div>
      )}

      {detalle && (
        <Detalle a={detalle} yo={perfil!.id} nombreDe={nombreDe} grupos={grupos}
          puedeEditar={nivel === 'editar' || (nivel === 'propio' && detalle.creado_por === perfil!.id)}
          onCerrar={() => setDetalle(null)}
          onEditar={() => { setForm({ actividad: detalle }); setDetalle(null); }}
          onCambio={async () => { setDetalle(null); await cargar(); }} />
      )}
      {form && (
        <Formulario inicial={form.actividad} fecha={form.fecha ?? hoy} personas={personas} grupos={grupos} lugares={lugares}
          yo={perfil!.nombre} onLugares={cargarLugares}
          onCerrar={() => setForm(null)} onGuardado={async () => { setForm(null); await cargar(); }} />
      )}
      {suscribir && <Suscripcion onCerrar={() => setSuscribir(false)} />}
    </div>
  );
}

function etiquetaDestinos(ds: Destino[], nombreDe: (id: string | null) => string, grupos: Grupo[]) {
  return ds.map((d) => d.tipo === 'persona' ? nombreDe(d.ref)
    : d.tipo === 'grupo' ? (grupos.find((g) => g.id === d.ref)?.nombre ?? 'Grupo')
      : ETIQUETAS.find((e) => e.tipo === d.tipo)?.nombre).join(' · ') || 'Nadie';
}

function Detalle({ a, yo, nombreDe, grupos, puedeEditar, onCerrar, onEditar, onCambio }: {
  a: Actividad; yo: string; nombreDe: (id: string | null) => string; grupos: Grupo[]; puedeEditar: boolean;
  onCerrar: () => void; onEditar: () => void; onCambio: () => void;
}) {
  const t = TIPOS[a.tipo];
  const mia = a.confirmaciones.find((c) => c.perfil_id === yo);
  const [error, setError] = useState('');
  const [borrar, setBorrar] = useState(false);
  async function responder(estado: 'acepta' | 'no_puede') {
    const { error } = await supabase.rpc('responder_actividad', { p_id: a.id, p_estado: estado });
    if (error) setError(mensajeError(error)); else onCambio();
  }
  async function eliminar() {
    const { error } = await supabase.rpc('eliminar_actividad', { p_id: a.id });
    if (error) setError(mensajeError(error)); else onCambio();
  }
  const estilo: Record<string, CSSProperties> = {
    acepta: { background: 'var(--ok-bg)', color: 'var(--ok-fg)' },
    no_puede: { background: '#FDE2E2', color: '#8F1D1D' },
    pendiente: { background: '#FFF0D6', color: '#7A3A06' },
  };
  const texto: Record<string, string> = { acepta: 'Aceptó', no_puede: 'No puede', pendiente: 'Pendiente' };
  return (
    <Dialogo titulo={titulo(a)} onCerrar={onCerrar} ancho={500}
      pie={puedeEditar ? (borrar ? <>
        <span className="small" style={{ marginRight: 'auto', alignSelf: 'center' }}>¿Eliminar esta actividad?</span>
        <button type="button" className="btn" onClick={() => setBorrar(false)}>No</button>
        <button type="button" className="btn btn-danger" onClick={eliminar}>Sí, eliminar</button>
      </> : <>
        <button type="button" className="btn btn-ghost link-danger" onClick={() => setBorrar(true)}>Eliminar</button>
        <button type="button" className="btn" onClick={onEditar}>Editar</button>
      </>) : undefined}>
      <span className="pill" style={{ alignSelf: 'flex-start', background: t.bg, color: t.fg }}>{t.nombre}{a.es_partido ? ` · Partido${a.fuera ? ' fuera' : ' en casa'}` : ''}</span>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '100px minmax(0,1fr)', gap: '8px 12px', fontSize: 14 }}>
        <dt className="muted">Cuándo</dt><dd style={{ margin: 0, fontWeight: 500 }}>{fechaLarga(a.fecha)} · {a.todo_el_dia ? 'Todo el día' : hora(a.hora_inicio) + (a.hora_fin ? `–${hora(a.hora_fin)}` : '')}</dd>
        {a.lugar && <><dt className="muted">Dónde</dt><dd style={{ margin: 0, fontWeight: 500, display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center' }}>
          <span>{a.lugar}</span>
          <a href={enlaceMapa(a)} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, color: '#1D4ED8' }}><Pin />Abrir en el mapa</a>
        </dd></>}
        <dt className="muted">Para</dt><dd style={{ margin: 0, fontWeight: 500 }}>{etiquetaDestinos(a.destinos, nombreDe, grupos)}</dd>
        <dt className="muted">Responsable</dt><dd style={{ margin: 0, fontWeight: 500 }}>{nombreDe(a.creado_por)}</dd>
      </dl>
      {mia && (
        <div className="card" style={{ padding: 12, background: 'var(--bg)', boxShadow: 'none' }}>
          <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>{mia.estado === 'pendiente' ? 'Prensa espera tu confirmación' : `Respondiste: ${texto[mia.estado]}`}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type="button" className="btn" aria-pressed={mia.estado === 'no_puede'} onClick={() => responder('no_puede')}>No puedo</button>
            <button type="button" className="btn btn-dark" aria-pressed={mia.estado === 'acepta'} onClick={() => responder('acepta')}>Aceptar</button>
          </div>
        </div>
      )}
      {a.tipo === 'prensa' && a.confirmaciones.length > 0 && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '4px 14px' }}>
          <p style={{ margin: '8px 0 4px', fontSize: 13, fontWeight: 600 }}>Confirmaciones</p>
          {a.confirmaciones.map((c) => (
            <div key={c.perfil_id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--line-soft)', fontSize: 14 }}>
              <span>{nombreDe(c.perfil_id)}</span>
              <span className="pill" style={estilo[c.estado]}>{texto[c.estado]}</span>
            </div>
          ))}
        </div>
      )}
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </Dialogo>
  );
}

type Sugerencia = { nombre: string; direccion: string };

function Formulario({ inicial, fecha, personas, grupos, lugares, yo, onLugares, onCerrar, onGuardado }: {
  inicial?: Actividad; fecha: string; personas: PersonaMin[]; grupos: Grupo[]; lugares: Lugar[]; yo: string;
  onLugares: () => void; onCerrar: () => void; onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [tipo, setTipo] = useState<Tipo>(inicial?.tipo ?? 'deportiva');
  const [dia, setDia] = useState(inicial?.fecha ?? fecha);
  const [todoDia, setTodoDia] = useState(inicial?.todo_el_dia ?? false);
  const [desde, setDesde] = useState(hora(inicial?.hora_inicio ?? '10:00'));
  const [hasta, setHasta] = useState(hora(inicial?.hora_fin ?? ''));
  const [lugar, setLugar] = useState(inicial?.lugar ?? '');
  const [direccion, setDireccion] = useState(inicial?.direccion ?? '');
  const [partido, setPartido] = useState(inicial?.es_partido ?? false);
  const [rival, setRival] = useState(inicial?.rival ?? '');
  const [fuera, setFuera] = useState(inicial?.fuera ?? false);
  const [destinos, setDestinos] = useState<Destino[]>(inicial?.destinos ?? [{ tipo: 'equipo', ref: null }]);
  const [sugs, setSugs] = useState<Sugerencia[]>([]);
  const [verSugs, setVerSugs] = useState(false);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const temporizador = useRef<number>();

  const tiene = (t: Destino['tipo'], r: string | null = null) => destinos.some((d) => d.tipo === t && d.ref === r);
  const alternar = (t: Destino['tipo'], r: string | null = null) =>
    setDestinos(tiene(t, r) ? destinos.filter((d) => !(d.tipo === t && d.ref === r)) : [...destinos, { tipo: t, ref: r }]);

  function buscarLugar(texto: string) {
    setLugar(texto); setDireccion(''); setVerSugs(true);
    window.clearTimeout(temporizador.current);
    if (texto.trim().length < 4) { setSugs([]); return; }
    temporizador.current = window.setTimeout(async () => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=es&q=${encodeURIComponent(texto)}`);
        const j = (await r.json()) as { display_name: string; name?: string }[];
        setSugs(j.map((x) => ({ nombre: x.name || x.display_name.split(',')[0], direccion: x.display_name })));
      } catch { setSugs([]); }
    }, 500);
  }

  async function guardarLugar() {
    if (!lugar.trim()) return;
    const { error } = await supabase.rpc('guardar_lugar', { p_nombre: lugar, p_direccion: direccion || null });
    if (error) setError(mensajeError(error)); else onLugares();
  }

  async function guardar() {
    setError('');
    if (!nombre.trim()) { setError('Ponle un nombre a la actividad.'); return; }
    if (!todoDia && !desde) { setError('Falta la hora de inicio o marca «Todo el día».'); return; }
    if (destinos.length === 0) { setError('Elige para quién es la actividad.'); return; }
    setGuardando(true);
    const { error } = await supabase.rpc('guardar_actividad', {
      p_id: inicial?.id ?? null,
      p_datos: { nombre, tipo, fecha: dia, todo_el_dia: todoDia, hora_inicio: todoDia ? null : desde, hora_fin: todoDia ? null : hasta || null, lugar, direccion, es_partido: partido, rival: partido ? rival : null, fuera: partido ? fuera : false },
      p_destinos: destinos,
    });
    setGuardando(false);
    if (error) { setError(mensajeError(error)); return; }
    onGuardado();
  }

  const libres = personas.filter((p) => !tiene('persona', p.id));
  const guardado = lugares.some((l) => l.nombre.toLowerCase() === lugar.trim().toLowerCase());

  return (
    <Dialogo titulo={inicial ? 'Editar actividad' : 'Nueva actividad'} onCerrar={onCerrar}
      pie={<>
        <span className="xs muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>Responsable: {yo}</span>
        <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar y avisar'}</button>
      </>}>
      <label className="field"><span>Nombre de la actividad</span>
        <input className="input" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Pista, Vídeo, Salida del bus…" />
      </label>
      <div className="field"><span id="lbl-tipo">Tipo</span>
        <div role="group" aria-labelledby="lbl-tipo" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6 }}>
          {(Object.keys(TIPOS) as Tipo[]).map((k) => (
            <button key={k} type="button" aria-pressed={tipo === k} onClick={() => setTipo(k)}
              style={{ height: 44, borderRadius: 10, fontWeight: 600, border: tipo === k ? `2px solid ${TIPOS[k].color}` : '1.5px solid var(--field)', background: tipo === k ? TIPOS[k].bg : '#fff', color: tipo === k ? TIPOS[k].fg : '#3F444D' }}>
              {TIPOS[k].nombre}
            </button>
          ))}
        </div>
      </div>
      <div className="row" style={{ alignItems: 'flex-end', gap: '10px 14px' }}>
        <label className="field" style={{ width: 170 }}><span>Fecha</span><input className="input" type="date" required value={dia} onChange={(e) => setDia(e.target.value)} /></label>
        {!todoDia && <>
          <label className="field" style={{ width: 120 }}><span>Desde</span><input className="input" type="time" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="field" style={{ width: 120 }}><span>Hasta</span><input className="input" type="time" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        </>}
        <label className="row" style={{ minHeight: 44, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          <input type="checkbox" checked={todoDia} onChange={(e) => setTodoDia(e.target.checked)} style={{ width: 20, height: 20, accentColor: '#16181D' }} />Todo el día
        </label>
      </div>
      {todoDia && <p className="xs muted" style={{ margin: '-6px 0 0' }}>Queda marcada en el día; la hora se afina después.</p>}

      <div className="field" style={{ position: 'relative' }}>
        <span>Ubicación</span>
        <input className="input" value={lugar} onChange={(e) => buscarLugar(e.target.value)} onFocus={() => setVerSugs(true)} onBlur={() => setTimeout(() => setVerSugs(false), 200)}
          autoComplete="off" placeholder="Busca una dirección o elige un lugar guardado" />
        {verSugs && sugs.length > 0 && (
          <ul role="listbox" aria-label="Direcciones sugeridas" style={{ position: 'absolute', top: 70, left: 0, right: 0, zIndex: 3, margin: 0, padding: 6, listStyle: 'none', background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(22,24,29,.18)' }}>
            {sugs.map((s) => (
              <li key={s.direccion} role="option" aria-selected="false">
                <button type="button" onMouseDown={() => { setLugar(s.nombre); setDireccion(s.direccion); setSugs([]); }}
                  style={{ width: '100%', minHeight: 48, border: 0, borderRadius: 8, background: 'transparent', textAlign: 'left', padding: '4px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{s.nombre}</span>
                  <span className="xs muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{s.direccion}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row" style={{ gap: 6 }}>
          {lugares.length > 0 && <span className="xs muted">Guardados:</span>}
          {lugares.map((l) => (
            <button key={l.id} type="button" className="chip" aria-pressed={lugar === l.nombre} style={{ height: 32 }}
              onClick={() => { setLugar(l.nombre); setDireccion(l.direccion ?? ''); }}>{l.nombre}</button>
          ))}
          {lugar.trim() && !guardado && <button type="button" className="chip" style={{ height: 32, borderStyle: 'dashed', fontWeight: 600 }} onClick={guardarLugar}>+ Guardar este lugar</button>}
        </div>
      </div>

      <label className="row" style={{ minHeight: 40, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
        <input type="checkbox" checked={partido} onChange={(e) => setPartido(e.target.checked)} style={{ width: 20, height: 20, accentColor: '#16181D' }} />Es un partido
      </label>
      {partido && (
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '1 1 220px' }}><span>Rival</span><input className="input" value={rival} onChange={(e) => setRival(e.target.value)} placeholder="Barcelona" /></label>
          <label className="row" style={{ minHeight: 44, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
            <input type="checkbox" checked={fuera} onChange={(e) => setFuera(e.target.checked)} style={{ width: 20, height: 20, accentColor: '#16181D' }} />Fuera de casa
          </label>
        </div>
      )}

      <div className="field"><span id="lbl-para">Para quién (les llega el aviso)</span>
        <div role="group" aria-labelledby="lbl-para" className="row" style={{ gap: 6 }}>
          {ETIQUETAS.map((e) => <button key={e.tipo} type="button" className="chip" aria-pressed={tiene(e.tipo)} onClick={() => alternar(e.tipo)}>{e.nombre}</button>)}
          {grupos.map((g) => <button key={g.id} type="button" className="chip" aria-pressed={tiene('grupo', g.id)} onClick={() => alternar('grupo', g.id)}>{g.nombre}</button>)}
          {destinos.filter((d) => d.tipo === 'persona').map((d) => (
            <span key={d.ref} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '4px 4px 4px 12px', borderRadius: 18, background: '#EFEDE8', fontSize: 13, fontWeight: 600 }}>
              {personas.find((p) => p.id === d.ref)?.nombre}
              <button type="button" aria-label="Quitar" onClick={() => alternar('persona', d.ref)} style={{ width: 28, height: 28, border: 0, borderRadius: 14, background: 'transparent', fontSize: 16 }}>×</button>
            </span>
          ))}
          <label>
            <span className="sr-only">Añadir persona</span>
            <select className="select" style={{ height: 36, width: 170, borderRadius: 18, borderStyle: 'dashed', fontSize: 13 }} value=""
              onChange={(e) => { if (e.target.value) alternar('persona', e.target.value); }}>
              <option value="">+ persona</option>
              {libres.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
        </div>
      </div>
      {tipo === 'prensa' && (
        <p className="notice" style={{ margin: 0, background: '#EDE4FF', color: '#3B1A7A' }}>
          Cada persona etiquetada recibe «Aceptar» o «No puedo». Queda pendiente hasta que confirme y, si alguien no puede, lo vas a ver en la actividad.
        </p>
      )}
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </Dialogo>
  );
}

function Suscripcion({ onCerrar }: { onCerrar: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);
  const pedir = useCallback(async (regenerar = false) => {
    const { data, error } = await supabase.rpc('mi_token_calendario', { p_regenerar: regenerar });
    if (error) setError(mensajeError(error)); else { setToken(data as string); setCopiado(false); }
  }, []);
  useEffect(() => { pedir(); }, [pedir]);
  const url = token ? `${window.location.origin}/api/ics?t=${token}` : '';
  const webcal = url.replace(/^https?:/, 'webcal:');
  return (
    <Dialogo titulo="Añadir a mi calendario" ancho={520} onCerrar={onCerrar}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#3F444D' }}>
        Tus actividades aparecen en tu calendario y se actualizan solas. Es solo en un sentido: el calendario oficial es este.
        Google puede tardar varias horas en reflejar un cambio; los avisos urgentes llegan por la app.
      </p>
      {token && (
        <div className="stack" style={{ gap: 8 }}>
          <a className="btn" href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noreferrer">Google Calendar</a>
          <a className="btn" href={webcal}>Apple · iPhone</a>
          <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopiado(true); } catch { /* */ } }}>{copiado ? 'Enlace copiado' : 'Copiar enlace privado'}</button>
        </div>
      )}
      <p className="xs muted" style={{ margin: 0 }}>El enlace es personal. Si lo compartiste por error, genera uno nuevo y el anterior deja de funcionar.</p>
      <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start', textDecoration: 'underline' }} onClick={() => pedir(true)}>Generar un enlace nuevo</button>
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </Dialogo>
  );
}
