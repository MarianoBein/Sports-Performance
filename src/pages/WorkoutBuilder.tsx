import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, mensajeError } from '../lib/supabase';
import { useSesion } from '../lib/sesion';
import Dialogo from '../components/Dialogo';
import { CATEGORIAS, IMPLEMENTOS, miniatura, normalizar, tonoCategoria, type Ejercicio } from '../lib/workout';
import Semana from './workout/Semana';

type Tab = 'semana' | 'biblioteca';
const POR_PAGINA = 60;

function Etiquetas({ e }: { e: Ejercicio }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {e.categoria && <span className="pill" style={tonoCategoria(e.categoria)}>{e.categoria}</span>}
      {e.implemento && <span className="pill" style={{ background: '#F1EFEA', color: '#3F444D' }}>{e.implemento}</span>}
      {e.lateralidad && <span className="pill" style={{ background: '#F1EFEA', color: '#3F444D' }}>{e.lateralidad}</span>}
      {e.contraccion && <span className="pill" style={{ background: '#F1EFEA', color: '#3F444D' }}>{e.contraccion}</span>}
    </div>
  );
}

function Miniatura({ url, nombre }: { url: string | null; nombre: string }) {
  const src = miniatura(url);
  const [falla, setFalla] = useState(false);
  return (
    <div style={{ width: 64, height: 64, flex: 'none', borderRadius: 10, overflow: 'hidden', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {src && !falla
        ? <img src={src} alt="" loading="lazy" onError={() => setFalla(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span className="xs muted" aria-label={`Sin video de ${nombre}`}>—</span>}
    </div>
  );
}

function Editor({ ejercicio, categoriasExtra, onCerrar, onGuardado }: {
  ejercicio: Ejercicio | null; categoriasExtra: string[]; onCerrar: () => void; onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(ejercicio?.nombre ?? '');
  const [categoria, setCategoria] = useState(ejercicio?.categoria ?? '');
  const [implemento, setImplemento] = useState(ejercicio?.implemento ?? '');
  const [lateralidad, setLateralidad] = useState(ejercicio?.lateralidad ?? '');
  const [contraccion, setContraccion] = useState(ejercicio?.contraccion ?? '');
  const [video, setVideo] = useState(ejercicio?.video_url ?? '');
  const [consignas, setConsignas] = useState(ejercicio?.consignas ?? '');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const categorias = [...CATEGORIAS, ...categoriasExtra.filter((c) => !CATEGORIAS.includes(c))];

  async function guardar() {
    setGuardando(true); setError('');
    const { error } = await supabase.rpc('guardar_ejercicio', {
      p_id: ejercicio?.id || null,
      p: { nombre, categoria, implemento, lateralidad, contraccion, video_url: video, consignas },
    });
    setGuardando(false);
    if (error) { setError(mensajeError(error)); return; }
    onGuardado();
  }

  async function borrar() {
    if (!ejercicio) return;
    setGuardando(true); setError('');
    const { error } = await supabase.rpc('eliminar_ejercicio', { p_id: ejercicio.id });
    setGuardando(false);
    if (error) { setError(mensajeError(error)); return; }
    onGuardado();
  }

  return (
    <Dialogo titulo={ejercicio?.id ? 'Editar ejercicio' : 'Nuevo ejercicio'} onCerrar={onCerrar} ancho={620}
      pie={confirmarBorrar ? (
        <>
          <span className="small" style={{ marginRight: 'auto' }}>¿Eliminar «{ejercicio?.nombre}» de la biblioteca? Las sesiones ya armadas lo siguen mostrando.</span>
          <button type="button" className="btn" onClick={() => setConfirmarBorrar(false)}>Cancelar</button>
          <button type="button" className="btn btn-danger" disabled={guardando} onClick={borrar}>Eliminar</button>
        </>
      ) : (
        <>
          {ejercicio?.id && <button type="button" className="btn btn-ghost link-danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmarBorrar(true)}>Eliminar</button>}
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={guardando || !nombre.trim()} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <div className="stack" style={{ gap: 12 }}>
        <label className="field"><span>Nombre</span>
          <input id="ej-nombre" className="input" value={nombre} maxLength={120} autoFocus onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Goblet Squat" />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <label className="field"><span>Categoría</span>
            <select id="ej-categoria" className="select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Sin categoría</option>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field"><span>Implemento</span>
            <input id="ej-implemento" className="input" list="implementos" value={implemento} maxLength={60} onChange={(e) => setImplemento(e.target.value)} placeholder="Elegí o escribí" />
            <datalist id="implementos">{IMPLEMENTOS.map((i) => <option key={i} value={i} />)}</datalist>
          </label>
          <label className="field"><span>Lateralidad</span>
            <select id="ej-lateralidad" className="select" value={lateralidad} onChange={(e) => setLateralidad(e.target.value)}>
              <option value="">—</option><option>Unilateral</option><option>Bilateral</option>
            </select>
          </label>
          <label className="field"><span>Contracción</span>
            <select id="ej-contraccion" className="select" value={contraccion} onChange={(e) => setContraccion(e.target.value)}>
              <option value="">—</option><option>Isométrico</option><option>Excéntrico</option>
            </select>
          </label>
        </div>
        <label className="field"><span>Video (link de YouTube u otro)</span>
          <input id="ej-video" className="input" type="url" value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://www.youtube.com/shorts/…" />
        </label>
        <label className="field"><span>Consignas para el jugador</span>
          <textarea id="ej-consignas" className="input" rows={3} maxLength={2000} value={consignas} onChange={(e) => setConsignas(e.target.value)}
            style={{ height: 'auto', padding: '10px 12px', resize: 'vertical' }} placeholder="Ej.: espalda neutra, rodilla en línea con el pie, bajar en 3 segundos." />
        </label>
        {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      </div>
    </Dialogo>
  );
}

function Biblioteca({ editable }: { editable: boolean }) {
  const [lista, setLista] = useState<Ejercicio[] | null>(null);
  const [error, setError] = useState('');
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState<string>('Todas');
  const [implemento, setImplemento] = useState('');
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [editando, setEditando] = useState<Ejercicio | 'nuevo' | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('ejercicios')
      .select('id,nombre,categoria,implemento,lateralidad,contraccion,video_url,consignas,eliminado_en')
      .is('eliminado_en', null).order('nombre');
    if (error) { setError(mensajeError(error)); return; }
    setLista(data as Ejercicio[]);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setMostrar(POR_PAGINA); }, [busca, categoria, implemento]);

  const conteo = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of lista ?? []) m.set(e.categoria ?? 'Sin categoría', (m.get(e.categoria ?? 'Sin categoría') ?? 0) + 1);
    return m;
  }, [lista]);
  const categorias = useMemo(() => {
    const extra = [...conteo.keys()].filter((c) => !CATEGORIAS.includes(c)).sort();
    return [...CATEGORIAS.filter((c) => conteo.has(c)), ...extra];
  }, [conteo]);
  const implementos = useMemo(() => [...new Set((lista ?? []).map((e) => e.implemento).filter(Boolean) as string[])].sort(), [lista]);

  const filtrada = useMemo(() => {
    const palabras = normalizar(busca).split(' ').filter(Boolean);
    return (lista ?? []).filter((e) => {
      if (categoria !== 'Todas' && (e.categoria ?? 'Sin categoría') !== categoria) return false;
      if (implemento && e.implemento !== implemento) return false;
      if (!palabras.length) return true;
      const texto = normalizar(`${e.nombre} ${e.categoria ?? ''} ${e.implemento ?? ''} ${e.lateralidad ?? ''} ${e.contraccion ?? ''}`);
      return palabras.every((p) => texto.includes(p));
    });
  }, [lista, busca, categoria, implemento]);

  if (error) return <p className="notice notice-error" role="alert">{error}</p>;
  if (!lista) return <p className="muted">Cargando biblioteca…</p>;

  return (
    <div className="stack">
      <div className="row" style={{ gap: 10 }}>
        <label style={{ flex: '1 1 260px', maxWidth: 420 }}>
          <span className="sr-only">Buscar ejercicio</span>
          <input id="bib-buscar" className="input" type="search" placeholder="Buscar: «goblet», «single leg jump», «banda»…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <label style={{ flex: '0 1 220px' }}>
          <span className="sr-only">Implemento</span>
          <select id="bib-implemento" className="select" value={implemento} onChange={(e) => setImplemento(e.target.value)}>
            <option value="">Todos los implementos</option>
            {implementos.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
        <span className="spacer" />
        {editable && <button type="button" className="btn btn-primary" onClick={() => setEditando('nuevo')}>+ Nuevo ejercicio</button>}
      </div>

      <div className="row chips-scroll" role="group" aria-label="Filtrar por categoría" style={{ gap: 6 }}>
        <button type="button" className="chip" aria-pressed={categoria === 'Todas'} onClick={() => setCategoria('Todas')}>Todas · {lista.length}</button>
        {categorias.map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={categoria === c} onClick={() => setCategoria(c)}>{c} · {conteo.get(c)}</button>
        ))}
      </div>

      <p className="small muted" style={{ margin: 0 }} aria-live="polite">
        {filtrada.length === lista.length ? `${lista.length} ejercicios` : `${filtrada.length} de ${lista.length} ejercicios`}
      </p>

      {filtrada.length === 0 ? (
        <div className="card" style={{ padding: 20 }}>
          <p style={{ margin: 0 }}>No hay ejercicios con ese filtro.</p>
          {editable && busca.trim() && (
            <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setEditando('nuevo')}>Crear «{busca.trim()}»</button>
          )}
        </div>
      ) : (
        <ul className="card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {filtrada.slice(0, mostrar).map((e, i) => (
            <li key={e.id} className="ej-fila" style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '10px 14px', borderTop: i ? '1px solid var(--line-soft)' : 0 }}>
              <Miniatura url={e.video_url} nombre={e.nombre} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <strong style={{ fontSize: 15, overflowWrap: 'anywhere' }}>{e.nombre}</strong>
                <Etiquetas e={e} />
                {e.consignas && <span className="xs muted" style={{ overflowWrap: 'anywhere' }}>{e.consignas}</span>}
              </div>
              <div className="row ej-acciones" style={{ gap: 6, flex: 'none' }}>
                {e.video_url && <a className="btn btn-sm" href={e.video_url} target="_blank" rel="noopener noreferrer" aria-label={`Ver video de ${e.nombre}`}>Video ↗</a>}
                {editable && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditando(e)} aria-label={`Editar ${e.nombre}`}>Editar</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {filtrada.length > mostrar && (
        <button type="button" className="btn" style={{ alignSelf: 'center' }} onClick={() => setMostrar((m) => m + POR_PAGINA)}>
          Ver más ({filtrada.length - mostrar} restantes)
        </button>
      )}

      {editando && (
        <Editor
          ejercicio={editando === 'nuevo' ? (busca.trim() && filtrada.length === 0 ? { id: '', nombre: busca.trim(), categoria: categoria === 'Todas' ? null : categoria, implemento: null, lateralidad: null, contraccion: null, video_url: null, consignas: null, eliminado_en: null } : null) : editando}
          categoriasExtra={categorias}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); cargar(); }}
        />
      )}
    </div>
  );
}

export default function WorkoutBuilder() {
  const { perfil, permisos } = useSesion();
  const editable = permisos?.workout_builder.nivel === 'editar';
  const esJugador = !!perfil?.rol.es_jugador && !perfil.es_admin;
  const [tab, setTab] = useState<Tab>(esJugador || !editable ? 'biblioteca' : 'semana');
  const [biblioteca, setBiblioteca] = useState<Ejercicio[]>([]);

  useEffect(() => {
    if (!editable) return;
    supabase.from('ejercicios').select('id,nombre,categoria,implemento,lateralidad,contraccion,video_url,consignas,eliminado_en')
      .is('eliminado_en', null).order('nombre')
      .then(({ data }) => setBiblioteca((data as Ejercicio[]) ?? []));
  }, [editable, tab]);

  if (!perfil) return null;

  return (
    <div className="stack">
      <div>
        <p className="muted small" style={{ margin: '0 0 4px' }}>{perfil.club.nombre}</p>
        <h1 className="display" style={{ fontSize: 38 }}>Workout Builder</h1>
      </div>

      {esJugador ? (
        <div className="card" style={{ padding: 20 }}>
          <p style={{ margin: 0 }}>Acá vas a ver tus entrenamientos. Llega en la próxima versión.</p>
        </div>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Secciones">
            {editable && <button type="button" role="tab" aria-selected={tab === 'semana'} onClick={() => setTab('semana')}>Semana</button>}
            <button type="button" role="tab" aria-selected={tab === 'biblioteca'} onClick={() => setTab('biblioteca')}>Biblioteca</button>
          </div>
          {tab === 'semana' && editable && <Semana biblioteca={biblioteca} onBibliotecaCambio={(e) => setBiblioteca((b) => [...b, e].sort((x, y) => x.nombre.localeCompare(y.nombre)))} />}
          {tab === 'biblioteca' && <Biblioteca editable={editable} />}
        </>
      )}
    </div>
  );
}
