import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { supabase, mensajeError } from '../../lib/supabase';
import { DIAS_CORTOS, MESES, desdeIso, hoyIso } from '../../lib/calendario';
import { BREAKS_SUGERIDOS, esquema, nuevoId, textoPregunta, type Ejercicio, type Item } from '../../lib/workout';
import { asignarPrograma, claveDia, fechaDe, lunesIso, sesionesDe, type Programa } from '../../lib/programas';
import Dialogo from '../../components/Dialogo';
import EditorItem from './EditorItem';
import { EditorBreak, EditorNota, EditorPregunta } from './Semana';

type Tipo = Item['tipo'];
type Edicion = { clave: string; item: Item | null; tipo: Tipo };
const vacio = (): Programa => ({ id: '', nombre: '', descripcion: '', semanas: 3, dias: {} });
const fechaCorta = (f: string) => { const d = desdeIso(f); return `${DIAS_CORTOS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; };

export default function Programas({ biblioteca, onBibliotecaCambio }: { biblioteca: Ejercicio[]; onBibliotecaCambio: (e: Ejercicio) => void }) {
  const [lista, setLista] = useState<Programa[] | null>(null);
  const [abierto, setAbierto] = useState<Programa | null>(null);
  const [asignando, setAsignando] = useState<Programa | null>(null);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.from('programas').select('id,nombre,descripcion,semanas,dias,actualizado_en').order('nombre');
    if (e) { setError(mensajeError(e)); setLista([]); return; }
    setLista((data as Programa[]) ?? []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  if (abierto) return (
    <EditorPrograma inicial={abierto} biblioteca={biblioteca} onBibliotecaCambio={onBibliotecaCambio}
      onVolver={() => { setAbierto(null); cargar(); }}
      onAsignar={(p) => setAsignando(p)}
      asignando={asignando} onCerrarAsignar={(msg) => { setAsignando(null); if (msg) setAviso(msg); }} />
  );

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 10 }}>
        <p className="small muted" style={{ margin: 0, flex: '1 1 320px' }}>
          Programas guardados para usar cuando haga falta (por ejemplo, la vuelta de un esguince de tobillo).
          Se arman por semanas y días, sin fechas. Al asignarlo, se copia a los días del jugador o grupo, antes o después de su entreno, y ahí lo podés ajustar sin tocar el programa.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setAbierto(vacio())}>+ Nuevo programa</button>
      </div>
      {aviso && <p className="notice notice-ok" role="status" style={{ margin: 0 }}>{aviso}</p>}
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      {!lista ? <p className="muted">Cargando…</p> : lista.length === 0 ? (
        <div className="card" style={{ padding: 18 }}><p className="muted" style={{ margin: 0 }}>Todavía no hay programas. Creá el primero con «+ Nuevo programa».</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {lista.map((p) => {
            const ses = sesionesDe(p);
            const porSemana = new Set(ses.filter((s) => s.semana === 1).map((s) => DIAS_CORTOS[s.dia])) ;
            return (
              <section key={p.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <strong style={{ fontSize: 17 }}>{p.nombre}</strong>
                <span className="small muted">
                  {p.semanas} semana{p.semanas > 1 ? 's' : ''} · {ses.length} sesion{ses.length === 1 ? '' : 'es'}
                  {porSemana.size > 0 && ` · ${[...porSemana].join(', ')}`}
                </span>
                {p.descripcion && <span className="small" style={{ color: '#3F444D' }}>{p.descripcion}</span>}
                <span style={{ flex: 1 }} />
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn btn-sm" onClick={() => setAbierto(p)}>Abrir</button>
                  <button type="button" className="btn btn-sm btn-dark" disabled={!ses.length} onClick={() => setAsignando(p)}>Asignar</button>
                </div>
              </section>
            );
          })}
        </div>
      )}
      {asignando && <DialogoAsignar programa={asignando} onCerrar={(msg) => { setAsignando(null); if (msg) setAviso(msg); }} />}
    </div>
  );
}

function EditorPrograma({ inicial, biblioteca, onBibliotecaCambio, onVolver, onAsignar, asignando, onCerrarAsignar }: {
  inicial: Programa; biblioteca: Ejercicio[]; onBibliotecaCambio: (e: Ejercicio) => void;
  onVolver: () => void; onAsignar: (p: Programa) => void; asignando: Programa | null; onCerrarAsignar: (msg?: string) => void;
}) {
  const [p, setP] = useState<Programa>(inicial);
  const [guardado, setGuardado] = useState<Programa>(inicial);
  const [sel, setSel] = useState<{ clave: string; id: string } | null>(null);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [arrastre, setArrastre] = useState<{ clave: string; id: string } | null>(null);
  const [soltarEn, setSoltarEn] = useState<string | null>(null);
  const [pasado, setPasado] = useState<Programa[]>([]);
  const [estado, setEstado] = useState<'' | 'guardando' | 'ok'>('');
  const [error, setError] = useState('');
  const [borrar, setBorrar] = useState(false);
  const sinGuardar = JSON.stringify(p) !== JSON.stringify(guardado);

  const cambiar = (nuevo: Programa) => { setPasado((h) => [...h, p].slice(-40)); setP(nuevo); setEstado(''); };
  const dia = (k: string) => p.dias[k] ?? [];
  const conDia = (k: string, its: Item[]) => {
    const dias = { ...p.dias };
    if (its.length) dias[k] = its; else delete dias[k];
    return { ...p, dias };
  };

  async function guardar() {
    setError('');
    if (!p.nombre.trim()) { setError('Ponele un nombre al programa.'); return; }
    // Solo se guardan las semanas que existen.
    const dias = Object.fromEntries(Object.entries(p.dias).filter(([k, v]) => Number(k.split('-')[0]) <= p.semanas && v.length));
    setEstado('guardando');
    const { data, error: e } = await supabase.rpc('guardar_programa', { p_id: p.id || null, p_nombre: p.nombre, p_descripcion: p.descripcion ?? '', p_semanas: p.semanas, p_dias: dias });
    if (e) { setEstado(''); setError(mensajeError(e)); return; }
    const nuevo = { ...p, id: data as string, dias };
    setP(nuevo); setGuardado(nuevo); setEstado('ok');
  }
  async function eliminar() {
    const { error: e } = await supabase.rpc('eliminar_programa', { p_id: p.id });
    if (e) { setError(mensajeError(e)); return; }
    onVolver();
  }

  function guardarItem(ed: Edicion, it: Item) {
    const its = dia(ed.clave);
    cambiar(conDia(ed.clave, ed.item ? its.map((x) => (x.id === ed.item!.id ? { ...it, id: x.id } : x)) : [...its, it]));
    if (ed.item || ed.tipo !== 'ejercicio') setEdicion(null);
  }
  function quitar(k: string, id: string) { cambiar(conDia(k, dia(k).filter((x) => x.id !== id))); setSel(null); }
  function mover(desde: { clave: string; id: string }, hacia: string, copiar: boolean, antesDe?: string) {
    const it = dia(desde.clave).find((x) => x.id === desde.id);
    if (!it) return;
    const pieza = copiar ? { ...it, id: nuevoId(), detalle: it.detalle.map((s) => ({ ...s })), config: { ...it.config } } : it;
    let n = p;
    if (!copiar) n = { ...n, dias: { ...n.dias, [desde.clave]: dia(desde.clave).filter((x) => x.id !== desde.id) } };
    const destino = [...(n.dias[hacia] ?? [])];
    let pos = antesDe ? destino.findIndex((x) => x.id === antesDe) : -1;
    if (pos < 0) pos = destino.length;
    destino.splice(pos, 0, pieza);
    const dias = { ...n.dias, [hacia]: destino };
    for (const k of Object.keys(dias)) if (!dias[k].length) delete dias[k];
    cambiar({ ...n, dias });
    setSel({ clave: hacia, id: pieza.id });
  }
  // Copia una semana entera a la siguiente (para repetirla y después progresar).
  function copiarSemana(s: number) {
    if (s >= p.semanas) return;
    const dias = { ...p.dias };
    for (let d = 0; d < 7; d++) {
      const its = p.dias[claveDia(s, d)] ?? [];
      if (its.length) dias[claveDia(s + 1, d)] = its.map((x) => ({ ...x, id: nuevoId(), detalle: x.detalle.map((y) => ({ ...y })), config: { ...x.config } }));
      else delete dias[claveDia(s + 1, d)];
    }
    cambiar({ ...p, dias });
  }
  function deshacer() { if (!pasado.length) return; setP(pasado[pasado.length - 1]); setPasado(pasado.slice(0, -1)); setSel(null); }

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement | null)?.tagName ?? '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t) || edicion || asignando) return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); deshacer(); }
      else if ((e.metaKey || e.ctrlKey) && k === 's') { e.preventDefault(); void guardar(); }
      else if ((k === 'delete' || k === 'backspace') && sel) { e.preventDefault(); quitar(sel.clave, sel.id); }
      else if (k === 'escape') setSel(null);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });

  const nombresBreak = useMemo(() => [...new Set([...BREAKS_SUGERIDOS, ...Object.values(p.dias).flat().filter((i) => i.tipo === 'break').map((i) => i.nombre)])], [p.dias]);
  const ses = sesionesDe(p);

  const tarjeta = (k: string, it: Item) => {
    const on = sel?.clave === k && sel.id === it.id;
    const base = {
      draggable: true,
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); setSel({ clave: k, id: it.id }); },
      onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); setEdicion({ clave: k, item: it, tipo: it.tipo }); },
      onDragStart: (e: DragEvent) => { try { e.dataTransfer.setData('text/plain', it.id); e.dataTransfer.effectAllowed = 'copyMove'; } catch { /* nada */ } setArrastre({ clave: k, id: it.id }); },
      onDragEnd: () => { setArrastre(null); setSoltarEn(null); },
      onDragOver: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); if (soltarEn !== k) setSoltarEn(k); },
      onDrop: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); if (arrastre && arrastre.id !== it.id) mover(arrastre, k, e.altKey || e.ctrlKey, it.id); setArrastre(null); setSoltarEn(null); },
    };
    const sombra = on ? 'inset 0 0 0 2px var(--accent)' : undefined;
    if (it.tipo === 'break') return (
      <button key={it.id} type="button" {...base} className="prog-item" style={{ background: '#2B2E36', color: '#fff', fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '.03em', boxShadow: sombra }}>{it.nombre}</button>
    );
    if (it.tipo === 'nota') return (
      <button key={it.id} type="button" {...base} className="prog-item" style={{ background: '#FFF2C2', color: '#4A3600', fontSize: 11, boxShadow: sombra ?? 'inset 3px 0 0 #E5A800' }}>{it.nota || it.nombre}</button>
    );
    if (it.tipo === 'pregunta') return (
      <button key={it.id} type="button" {...base} className="prog-item" style={{ background: '#EFE9FF', color: '#43307E', boxShadow: sombra ?? 'inset 3px 0 0 #7C5CE0' }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{it.nombre}</span><span className="xs">{textoPregunta(it.config)}</span>
      </button>
    );
    return (
      <button key={it.id} type="button" {...base} className="prog-item" style={{ background: on ? '#FDECEE' : 'var(--card)', boxShadow: on ? 'inset 3px 0 0 var(--accent)' : undefined }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{it.nombre}</span><span className="xs muted">{esquema(it)}</span>
      </button>
    );
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 10 }}>
        <button type="button" className="btn btn-sm" onClick={() => { if (!sinGuardar || window.confirm('Hay cambios sin guardar. ¿Salir igual?')) onVolver(); }}>‹ Programas</button>
        <span className="spacer" />
        <span className="xs muted" role="status">{estado === 'guardando' ? 'Guardando…' : sinGuardar ? 'Cambios sin guardar' : estado === 'ok' ? 'Guardado' : ''}</span>
        <button type="button" className="btn btn-sm" disabled={!pasado.length} onClick={deshacer}>Deshacer</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={!sinGuardar || estado === 'guardando'} onClick={guardar}>Guardar</button>
        <button type="button" className="btn btn-sm btn-dark" disabled={!p.id || sinGuardar || !ses.length}
          title={sinGuardar ? 'Guardá primero' : undefined} onClick={() => onAsignar(p)}>Asignar…</button>
      </div>

      <div className="card" style={{ padding: 16, display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) minmax(140px, 1fr)', gap: 12 }}>
        <label className="field"><span>Nombre del programa</span>
          <input className="input" autoFocus={!p.id} maxLength={120} value={p.nombre} placeholder="Ej.: Esguince de tobillo · vuelta progresiva" onChange={(e) => cambiar({ ...p, nombre: e.target.value })} />
        </label>
        <label className="field"><span>Duración</span>
          <select className="select" value={p.semanas} onChange={(e) => cambiar({ ...p, semanas: Number(e.target.value) })}>
            {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} semana{n > 1 ? 's' : ''} ({n * 7} días)</option>)}
          </select>
        </label>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Descripción (opcional)</span>
          <input className="input" maxLength={1000} value={p.descripcion ?? ''} placeholder="Para qué es, criterios para avanzar…" onChange={(e) => cambiar({ ...p, descripcion: e.target.value })} />
        </label>
      </div>

      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}

      <div className="table-wrap">
        <div style={{ minWidth: 980, display: 'grid', gridTemplateColumns: '92px repeat(7, minmax(0, 1fr))', gap: 6 }}>
          <span />
          {DIAS_CORTOS.map((d) => <span key={d} className="xs muted" style={{ fontWeight: 700, textTransform: 'uppercase', paddingLeft: 6 }}>{d}</span>)}
          {Array.from({ length: p.semanas }, (_, i) => i + 1).map((s) => (
            <div key={s} style={{ display: 'contents' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8 }}>
                <strong style={{ fontSize: 14 }}>Semana {s}</strong>
                {s < p.semanas && (
                  <button type="button" className="xs" onClick={() => copiarSemana(s)} title={`Copia la semana ${s} sobre la semana ${s + 1}`}
                    style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'left', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}>Copiar a la semana {s + 1} ↓</button>
                )}
              </div>
              {Array.from({ length: 7 }, (_, d) => {
                const k = claveDia(s, d);
                const its = dia(k);
                return (
                  <section key={k} aria-label={`Semana ${s}, ${DIAS_CORTOS[d]}`} onClick={() => setSel(null)}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = e.altKey || e.ctrlKey ? 'copy' : 'move'; if (soltarEn !== k) setSoltarEn(k); }}
                    onDragLeave={() => { if (soltarEn === k) setSoltarEn(null); }}
                    onDrop={(e) => { e.preventDefault(); if (arrastre) mover(arrastre, k, e.altKey || e.ctrlKey); setArrastre(null); setSoltarEn(null); }}
                    style={{ minHeight: 120, borderRadius: 12, padding: 6, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
                      background: its.length ? 'var(--card)' : '#EDEBE6', boxShadow: soltarEn === k ? 'inset 0 0 0 2px var(--accent)' : undefined }}>
                    {its.map((it) => tarjeta(k, it))}
                    <span style={{ flex: 1 }} />
                    <MenuAgregar onElegir={(tipo) => setEdicion({ clave: k, item: null, tipo })} />
                  </section>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="xs muted" style={{ margin: 0 }}>
        Clic para elegir · doble clic para editar · arrastrá para mover (con ⌥ Alt apretado, copia) · Supr borrar · ⌘Z deshacer · ⌘S guardar.
      </p>
      {p.id && (
        borrar ? (
          <div className="row" style={{ gap: 8 }}>
            <span className="small">¿Borrar el programa? Lo que ya asignaste a jugadores queda como está.</span>
            <button type="button" className="btn btn-sm" onClick={() => setBorrar(false)}>No</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={eliminar}>Sí, borrar</button>
          </div>
        ) : <button type="button" className="btn btn-sm btn-ghost link-danger" style={{ alignSelf: 'flex-start' }} onClick={() => setBorrar(true)}>Borrar programa</button>
      )}

      {edicion && edicion.tipo === 'ejercicio' && (
        <EditorItem dia={`${p.nombre || 'Programa'} · semana ${edicion.clave.split('-')[0]}, ${DIAS_CORTOS[Number(edicion.clave.split('-')[1])]}`}
          item={edicion.item} biblioteca={biblioteca} onBibliotecaCambio={onBibliotecaCambio}
          onCerrar={() => setEdicion(null)} onGuardar={(it) => guardarItem(edicion, it)} />
      )}
      {edicion && edicion.tipo === 'break' && <EditorBreak item={edicion.item} sugeridos={nombresBreak} onCerrar={() => setEdicion(null)} onGuardar={(it) => guardarItem(edicion, it)} />}
      {edicion && edicion.tipo === 'nota' && <EditorNota item={edicion.item} onCerrar={() => setEdicion(null)} onGuardar={(it) => guardarItem(edicion, it)} />}
      {edicion && edicion.tipo === 'pregunta' && <EditorPregunta item={edicion.item} onCerrar={() => setEdicion(null)} onGuardar={(it) => guardarItem(edicion, it)} />}
      {asignando && <DialogoAsignar programa={asignando} onCerrar={onCerrarAsignar} />}
    </div>
  );
}

function MenuAgregar({ onElegir }: { onElegir: (t: Tipo) => void }) {
  const [abierto, setAbierto] = useState(false);
  if (!abierto) return (
    <button type="button" className="btn btn-sm btn-ghost" style={{ border: '1.5px dashed #C9C6BF', height: 28, fontSize: 12 }}
      onClick={(e) => { e.stopPropagation(); setAbierto(true); }}>+ Añadir</button>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} onMouseLeave={() => setAbierto(false)}>
      {([['ejercicio', 'Ejercicio', 'var(--ink)'], ['break', 'Session break', 'var(--muted)'], ['nota', 'Nota', '#6B4E00'], ['pregunta', 'Cuestionario', '#43307E']] as const).map(([t, n, c]) => (
        <button key={t} type="button" className="btn btn-sm btn-ghost" style={{ height: 26, fontSize: 12, color: c }}
          onClick={(e) => { e.stopPropagation(); setAbierto(false); onElegir(t); }}>+ {n}</button>
      ))}
    </div>
  );
}

function DialogoAsignar({ programa, onCerrar }: { programa: Programa; onCerrar: (msg?: string) => void }) {
  const [jugadores, setJugadores] = useState<{ id: string; nombre: string }[]>([]);
  const [grupos, setGrupos] = useState<{ id: string; nombre: string }[]>([]);
  const [clave, setClave] = useState('');
  const [inicio, setInicio] = useState(() => lunesIso(hoyIso()));
  const [posicion, setPosicion] = useState<'antes' | 'despues'>('antes');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      supabase.from('perfiles').select('id,nombre,rol:roles!inner(es_jugador)').eq('rol.es_jugador', true).is('eliminado_en', null).order('nombre'),
      supabase.from('grupos').select('id,nombre').order('nombre'),
    ]).then(([p, g]) => { setJugadores((p.data as unknown as { id: string; nombre: string }[]) ?? []); setGrupos((g.data as { id: string; nombre: string }[]) ?? []); });
  }, []);

  const lunes = lunesIso(inicio);
  const fechas = sesionesDe(programa).map((s) => fechaDe(lunes, s.semana, s.dia));
  const nombrePara = clave === 'equipo' ? 'todo el equipo' : clave.startsWith('grupo:') ? `el grupo ${grupos.find((g) => `grupo:${g.id}` === clave)?.nombre ?? ''}`
    : jugadores.find((j) => `persona:${j.id}` === clave)?.nombre ?? '';

  async function asignar() {
    if (!clave) { setError('Elegí a quién se lo asignás.'); return; }
    setError(''); setOcupado(true);
    try {
      const n = await asignarPrograma(programa, clave, lunes, posicion, nombrePara);
      onCerrar(`Listo: «${programa.nombre}» quedó en ${n} día${n > 1 ? 's' : ''} de ${nombrePara}, desde el ${fechaCorta(fechas[0])}. Lo ves y lo ajustás en «Planes».`);
    } catch (e) { setOcupado(false); setError(mensajeError(e)); }
  }

  return (
    <Dialogo titulo={`Asignar «${programa.nombre}»`} onCerrar={() => onCerrar()} ancho={560}
      pie={<>
        <button type="button" className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={ocupado || !clave} onClick={asignar}>{ocupado ? 'Asignando…' : 'Asignar'}</button>
      </>}>
      <div className="stack" style={{ gap: 14 }}>
        <label className="field"><span>Para</span>
          <select className="select" value={clave} onChange={(e) => setClave(e.target.value)}>
            <option value="">Elegí…</option>
            {jugadores.length > 0 && <optgroup label="Jugadores">{jugadores.map((j) => <option key={j.id} value={`persona:${j.id}`}>{j.nombre}</option>)}</optgroup>}
            {grupos.length > 0 && <optgroup label="Grupos">{grupos.map((g) => <option key={g.id} value={`grupo:${g.id}`}>{g.nombre}</option>)}</optgroup>}
            <option value="equipo">Todo el equipo</option>
          </select>
        </label>
        <label className="field"><span>Empieza la semana del</span>
          <input className="input" type="date" value={inicio} onChange={(e) => e.target.value && setInicio(e.target.value)} />
          <span className="xs muted">La semana 1 arranca el lunes {fechaCorta(lunes)}.</span>
        </label>
        <div className="field"><span>¿Dónde va en el día?</span>
          <div className="row" role="group" aria-label="Posición" style={{ gap: 6 }}>
            <button type="button" className="chip" aria-pressed={posicion === 'antes'} onClick={() => setPosicion('antes')}>Antes del entreno</button>
            <button type="button" className="chip" aria-pressed={posicion === 'despues'} onClick={() => setPosicion('despues')}>Después del entreno</button>
          </div>
          <span className="xs muted">Lo que ya tenía ese día se queda (por ejemplo, el tren superior). El programa entra con su propio título.</span>
        </div>
        <div className="card" style={{ padding: 12, background: 'var(--bg)', boxShadow: 'none' }}>
          <strong className="small">{fechas.length} día{fechas.length > 1 ? 's' : ''}:</strong>
          <p className="xs" style={{ margin: '6px 0 0', lineHeight: 1.6 }}>{fechas.map(fechaCorta).join(' · ')}</p>
        </div>
        <p className="xs muted" style={{ margin: 0 }}>Se copia: si después le cambiás series o repeticiones a {nombrePara || 'quien elijas'}, el programa guardado no cambia.</p>
        {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      </div>
    </Dialogo>
  );
}
