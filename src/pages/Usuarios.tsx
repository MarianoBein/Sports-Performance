import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, mensajeError } from '../lib/supabase';
import { useSesion, type Rol } from '../lib/sesion';
import Dialogo from '../components/Dialogo';
import { ESTILO_NIVEL, MODULOS, NIVELES, permisosEfectivos, type Nivel, type Permisos } from '../lib/permisos';

type Persona = {
  id: string; nombre: string; email: string; rol_id: string; es_admin: boolean;
  permisos_ajustados: Partial<Permisos> | null; eliminado_en: string | null; creado_en: string;
};
type Grupo = { id: string; nombre: string };
type Miembro = { grupo_id: string; perfil_id: string };
type Registro = { id: number; actor_nombre: string | null; accion: string; creado_en: string };

const AREAS = ['Todos', 'Staff deportivo', 'Jugadores', 'C-level', 'Prensa y sponsors'] as const;
function areaDe(rol?: Rol): (typeof AREAS)[number] {
  if (!rol) return 'Staff deportivo';
  if (rol.es_jugador) return 'Jugadores';
  if (rol.clave === 'clevel') return 'C-level';
  if (rol.clave === 'prensa') return 'Prensa y sponsors';
  return 'Staff deportivo';
}
const COLORES = ['#DCE7FF', '#DDF3E4', '#FDE2E2', '#E9E1FF', '#FFF0D6'];
const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const fecha = (iso: string) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function EditorPermisos({ valor, onCambio }: { valor: Permisos; onCambio: (p: Permisos) => void }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '4px 14px 8px' }}>
      {MODULOS.map((m) => (
        <div key={m.clave} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 170px 100px', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--line-soft)' }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{m.nombre}</span>
          <label className="field"><span className="sr-only">Nivel en {m.nombre}</span>
            <select className="select" style={{ height: 40 }} value={valor[m.clave].nivel}
              onChange={(e) => onCambio({ ...valor, [m.clave]: { ...valor[m.clave], nivel: e.target.value as Nivel } })}>
              {NIVELES.map((n) => <option key={n.clave} value={n.clave}>{n.nombre}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, minHeight: 40, cursor: 'pointer' }}>
            <input type="checkbox" checked={valor[m.clave].exporta} style={{ width: 18, height: 18, accentColor: '#16181D' }}
              onChange={(e) => onCambio({ ...valor, [m.clave]: { ...valor[m.clave], exporta: e.target.checked } })} />
            Exporta
          </label>
        </div>
      ))}
    </div>
  );
}

const iguales = (a: Permisos, b: Permisos) => MODULOS.every((m) => a[m.clave].nivel === b[m.clave].nivel && a[m.clave].exporta === b[m.clave].exporta);

export default function Usuarios() {
  const { perfil, recargar } = useSesion();
  const [tab, setTab] = useState<'usuarios' | 'registro'>('usuarios');
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [registro, setRegistro] = useState<Registro[]>([]);
  const [area, setArea] = useState<(typeof AREAS)[number]>('Todos');
  const [busca, setBusca] = useState('');
  const [error, setError] = useState('');
  const [editando, setEditando] = useState<Persona | null>(null);
  const [eliminando, setEliminando] = useState<Persona | null>(null);
  const [codigoAbierto, setCodigoAbierto] = useState(false);
  const [grupoAbierto, setGrupoAbierto] = useState(false);
  const [rolAbierto, setRolAbierto] = useState(false);

  const cargar = useCallback(async () => {
    const [p, r, g, m, reg] = await Promise.all([
      supabase.from('perfiles').select('id,nombre,email,rol_id,es_admin,permisos_ajustados,eliminado_en,creado_en').is('eliminado_en', null).order('nombre'),
      supabase.from('roles').select('*').order('nombre'),
      supabase.from('grupos').select('id,nombre').order('nombre'),
      supabase.from('grupo_miembros').select('*'),
      supabase.from('registro_cambios').select('id,actor_nombre,accion,creado_en').order('id', { ascending: false }).limit(200),
    ]);
    const err = p.error || r.error || g.error || m.error || reg.error;
    if (err) setError(mensajeError(err));
    setPersonas((p.data as Persona[]) ?? []);
    setRoles((r.data as Rol[]) ?? []);
    setGrupos((g.data as Grupo[]) ?? []);
    setMiembros((m.data as Miembro[]) ?? []);
    setRegistro((reg.data as Registro[]) ?? []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const rolPorId = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, r])), [roles]);
  const gruposDe = (id: string) => miembros.filter((m) => m.perfil_id === id).map((m) => grupos.find((g) => g.id === m.grupo_id)?.nombre).filter(Boolean) as string[];
  const admins = personas.filter((p) => p.es_admin);
  const filtradas = personas.filter((p) =>
    (area === 'Todos' || areaDe(rolPorId[p.rol_id]) === area) &&
    (!busca.trim() || (p.nombre + ' ' + p.email).toLowerCase().includes(busca.trim().toLowerCase())));

  if (!perfil) return null;

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="muted small" style={{ margin: '0 0 4px' }}>{perfil.club.nombre} · solo administradores del club</p>
          <h1 className="display" style={{ fontSize: 38 }}>Usuarios</h1>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={async () => {
            const { data, error } = await supabase.rpc('exportar_club');
            if (error) { setError(mensajeError(error)); return; }
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${perfil.club.nombre.replace(/\s+/g, '_')}_datos_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
            cargar();
          }}>Exportar datos del club</button>
          <button type="button" className="btn btn-primary" onClick={() => setCodigoAbierto(true)}>+ Código de alta</button>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Secciones">
        <button type="button" role="tab" aria-selected={tab === 'usuarios'} onClick={() => setTab('usuarios')}>Usuarios</button>
        <button type="button" role="tab" aria-selected={tab === 'registro'} onClick={() => setTab('registro')}>Registro de cambios</button>
      </div>

      {error && <p className="notice notice-error" role="alert">{error}</p>}

      {tab === 'usuarios' && (
        <div className="stack">
          <div className="card row" style={{ padding: '12px 16px' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Administradores del club: {admins.length} (recomendado: mínimo 2)</span>
            <span className="small" style={{ color: '#3F444D' }}>{admins.map((a) => a.nombre).join(' · ')}</span>
            {admins.length < 2 && <span className="pill" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>Nombra un segundo administrador</span>}
          </div>

          <div className="row">
            <label style={{ flex: '1 1 240px', maxWidth: 360 }}>
              <span className="sr-only">Buscar persona</span>
              <input className="input" type="search" placeholder="Buscar por nombre o email…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </label>
            <div className="row" role="group" aria-label="Filtrar por área" style={{ gap: 6 }}>
              {AREAS.map((a) => (
                <button key={a} type="button" className="chip" aria-pressed={area === a} onClick={() => setArea(a)}>
                  {a} · {a === 'Todos' ? personas.length : personas.filter((p) => areaDe(rolPorId[p.rol_id]) === a).length}
                </button>
              ))}
            </div>
            <div className="spacer" />
            <button type="button" className="btn btn-sm" style={{ borderColor: 'var(--ink)' }} onClick={() => setRolAbierto(true)}>+ Nuevo rol</button>
          </div>

          <div className="card table-wrap">
            <table className="tbl" style={{ minWidth: 1180 }}>
              <thead>
                <tr>
                  <th scope="col">Persona</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Grupos</th>
                  {MODULOS.map((m) => <th key={m.clave} scope="col">{m.nombre}</th>)}
                  <th scope="col" style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((p, i) => {
                  const rol = rolPorId[p.rol_id];
                  const ef = permisosEfectivos(rol?.permisos ?? ({} as Permisos), p.permisos_ajustados, p.es_admin);
                  const gs = gruposDe(p.id);
                  return (
                    <tr key={p.id}>
                      <th scope="row" style={{ fontWeight: 400 }}>
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <span className="avatar" aria-hidden="true" style={{ background: COLORES[i % COLORES.length] }}>{iniciales(p.nombre)}</span>
                          <span style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.nombre}{p.id === perfil.id ? ' (tú)' : ''}</span>
                            <span className="xs muted">{p.email}</span>
                          </span>
                        </div>
                      </th>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{rol?.nombre}</span>
                          <span className="row" style={{ gap: 4 }}>
                            {p.es_admin && <span className="pill" style={{ background: '#16181D', color: '#fff', fontSize: 11 }}>Admin</span>}
                            {p.permisos_ajustados && <span className="pill" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)', fontSize: 11 }}>Ajustado</span>}
                          </span>
                        </div>
                      </td>
                      <td className="small" style={{ color: '#3F444D' }}>{rol?.es_jugador ? (gs.join(' · ') || 'Sin grupo') : '—'}</td>
                      {MODULOS.map((m) => {
                        const n = NIVELES.find((x) => x.clave === ef[m.clave].nivel)!;
                        return (
                          <td key={m.clave}>
                            <span className="row" style={{ gap: 4 }}>
                              <span className="pill" style={ESTILO_NIVEL[n.clave]}>{n.corto}</span>
                              {ef[m.clave].exporta && n.clave !== 'sin' && !p.es_admin && <span className="pill" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)', fontSize: 11 }}>Exporta</span>}
                            </span>
                          </td>
                        );
                      })}
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 4, flexWrap: 'nowrap' }}>
                          <button type="button" className="btn btn-sm" onClick={() => setEditando(p)}>Editar</button>
                          <button type="button" className="btn btn-sm btn-ghost link-danger" aria-label={`Eliminar a ${p.nombre}`} onClick={() => setEliminando(p)}>Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtradas.length === 0 && (
                  <tr><td colSpan={9} className="muted">No hay personas con ese filtro.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="row xs" style={{ gap: '6px 16px', color: '#3F444D' }}>
            {NIVELES.map((n) => <span key={n.clave} className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, ...ESTILO_NIVEL[n.clave] }} />{n.nombre}</span>)}
            <span>«Ajustado»: permisos distintos a los de su rol.</span>
          </div>

          <section className="card stack" style={{ padding: 16, gap: 10 }} aria-label="Grupos de jugadores">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 15 }}>Grupos de jugadores</h2>
              <span className="xs muted">Para asignar planes, filtrar la carga y avisar en el calendario.</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {grupos.map((g) => (
                <span key={g.id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', fontWeight: 600 }}>
                  {g.nombre} · {miembros.filter((m) => m.grupo_id === g.id).length}
                </span>
              ))}
              <button type="button" className="chip" style={{ borderStyle: 'dashed', fontWeight: 600 }} onClick={() => setGrupoAbierto(true)}>+ Nuevo grupo</button>
            </div>
          </section>
        </div>
      )}

      {tab === 'registro' && (
        <div className="stack">
          <p className="small" style={{ margin: 0, color: '#3F444D' }}>Queda registrado quién cambió qué y cuándo. No se puede editar ni borrar.</p>
          <ol className="card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {registro.map((r) => (
              <li key={r.id} className="row" style={{ padding: '14px 16px', borderTop: '1px solid var(--line-soft)', alignItems: 'baseline' }}>
                <span className="small muted" style={{ width: 130, flex: 'none' }}>{fecha(r.creado_en)}</span>
                <span style={{ flex: '1 1 380px', fontSize: 14 }}><strong>{r.actor_nombre ?? 'Sistema'}</strong> {r.accion}</span>
              </li>
            ))}
            {registro.length === 0 && <li style={{ padding: 16 }} className="muted">Todavía no hay cambios.</li>}
          </ol>
        </div>
      )}

      {editando && (
        <EditarPersona
          persona={editando} roles={roles} grupos={grupos}
          gruposActuales={miembros.filter((m) => m.perfil_id === editando.id).map((m) => m.grupo_id)}
          onCerrar={() => setEditando(null)}
          onGuardado={async () => { setEditando(null); await cargar(); if (editando.id === perfil.id) await recargar(); }}
        />
      )}
      {eliminando && (
        <Dialogo titulo={`¿Eliminar a ${eliminando.nombre}?`} ancho={480} onCerrar={() => setEliminando(null)}
          pie={<>
            <button type="button" className="btn" onClick={() => setEliminando(null)}>Cancelar</button>
            <button type="button" className="btn btn-danger" onClick={async () => {
              const { error } = await supabase.rpc('eliminar_miembro', { p_perfil: eliminando.id });
              if (error) { setError(mensajeError(error)); } else { setError(''); }
              setEliminando(null); await cargar();
            }}>Eliminar</button>
          </>}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#3F444D' }}>Pierde el acceso y desaparece de la lista. Sus cargas, wellness y tests se guardan para que no cambien las medias del equipo ni los informes de la temporada.</p>
        </Dialogo>
      )}
      {codigoAbierto && <CodigoAlta roles={roles} grupos={grupos} onCerrar={() => { setCodigoAbierto(false); cargar(); }} />}
      {grupoAbierto && <NuevoGrupo existentes={grupos.map((g) => g.nombre)} onCerrar={() => setGrupoAbierto(false)} onCreado={async () => { setGrupoAbierto(false); await cargar(); }} />}
      {rolAbierto && <NuevoRol onCerrar={() => setRolAbierto(false)} onCreado={async () => { setRolAbierto(false); await cargar(); }} />}
    </div>
  );
}

function EditarPersona({ persona, roles, grupos, gruposActuales, onCerrar, onGuardado }: {
  persona: Persona; roles: Rol[]; grupos: Grupo[]; gruposActuales: string[]; onCerrar: () => void; onGuardado: () => void;
}) {
  const [rolId, setRolId] = useState(persona.rol_id);
  const [admin, setAdmin] = useState(persona.es_admin);
  const rol = roles.find((r) => r.id === rolId)!;
  const base = permisosEfectivos(rol.permisos, null, false);
  const [permisos, setPermisos] = useState<Permisos>(permisosEfectivos(rol.permisos, persona.permisos_ajustados, false));
  const [sel, setSel] = useState<string[]>(gruposActuales);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  function cambiarRol(id: string) {
    setRolId(id);
    const r = roles.find((x) => x.id === id)!;
    setPermisos(permisosEfectivos(r.permisos, null, false));
  }
  const ajustado = !iguales(permisos, base);

  async function guardar() {
    setGuardando(true); setError('');
    const { error } = await supabase.rpc('actualizar_miembro', {
      p_perfil: persona.id, p_rol: rolId, p_admin: admin,
      p_permisos: ajustado ? permisos : null, p_grupos: rol.es_jugador ? sel : [],
    });
    setGuardando(false);
    if (error) { setError(mensajeError(error)); return; }
    onGuardado();
  }

  return (
    <Dialogo titulo="Editar persona" onCerrar={onCerrar} ancho={720}
      pie={<>
        <span className="xs muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>Los cambios quedan en el registro.</span>
        <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button>
      </>}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <div>
          <strong style={{ fontSize: 16 }}>{persona.nombre}</strong>
          <div className="small muted">{persona.email}</div>
        </div>
        <RestablecerClave persona={persona} />
      </div>
      <label className="field"><span>Rol (plantilla)</span>
        <select className="select" value={rolId} onChange={(e) => cambiarRol(e.target.value)}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
      </label>
      {rol.es_jugador && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="xs muted" style={{ fontWeight: 600, marginBottom: 6 }}>Grupos</legend>
          <div className="row" style={{ gap: 6 }}>
            {grupos.map((g) => {
              const on = sel.includes(g.id);
              return <button key={g.id} type="button" className="chip" aria-pressed={on} onClick={() => setSel(on ? sel.filter((x) => x !== g.id) : [...sel, g.id])}>{g.nombre}</button>;
            })}
          </div>
        </fieldset>
      )}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 14 }}>Permisos de esta persona</strong>
        {ajustado
          ? <button type="button" className="btn btn-sm" onClick={() => setPermisos(base)}>Restablecer los del rol</button>
          : <span className="xs muted">Iguales a los de «{rol.nombre}». Si cambias uno, queda como «Ajustado».</span>}
      </div>
      {admin
        ? <p className="notice notice-ok" style={{ margin: 0 }}>Como administrador ve y edita todo.</p>
        : <EditorPermisos valor={permisos} onCambio={setPermisos} />}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
        <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} style={{ width: 20, height: 20, accentColor: '#16181D' }} />
        Administrador del club
      </label>
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </Dialogo>
  );
}

function CodigoAlta({ roles, grupos, onCerrar }: { roles: Rol[]; grupos: Grupo[]; onCerrar: () => void }) {
  const jugador = roles.find((r) => r.es_jugador);
  const [rolId, setRolId] = useState(jugador?.id ?? roles[0]?.id ?? '');
  const [grupoId, setGrupoId] = useState(grupos[0]?.id ?? '');
  const [res, setRes] = useState<{ codigo: string; caduca_en: string; usos_max: number | null } | null>(null);
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);
  const rol = roles.find((r) => r.id === rolId);

  async function generar() {
    setError(''); setCopiado(false);
    const { data, error } = await supabase.rpc('crear_codigo', { p_rol: rolId, p_grupo: rol?.es_jugador ? grupoId || null : null });
    if (error) { setError(mensajeError(error)); return; }
    setRes(Array.isArray(data) ? data[0] : data);
  }
  async function copiar() {
    if (!res) return;
    const texto = `Tu código para entrar a la app del club es ${res.codigo}. Ábrela en ${window.location.origin}/alta`;
    try { await navigator.clipboard.writeText(texto); setCopiado(true); } catch { setCopiado(false); }
  }

  return (
    <Dialogo titulo="Código de alta" ancho={540} onCerrar={onCerrar}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#3F444D' }}>La persona abre la app, elige «Tengo un código» y se registra sola con el rol que elijas.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <label className="field"><span>Rol</span>
          <select className="select" value={rolId} onChange={(e) => { setRolId(e.target.value); setRes(null); }}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </label>
        {rol?.es_jugador && (
          <label className="field"><span>Grupo</span>
            <select className="select" value={grupoId} onChange={(e) => { setGrupoId(e.target.value); setRes(null); }}>
              <option value="">Sin grupo</option>
              {grupos.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </label>
        )}
      </div>
      {!rol?.es_jugador && <p className="notice notice-warn" style={{ margin: 0 }}>Código de un solo uso y válido 48 horas: si se reenvía, nadie más puede entrar con este rol.</p>}
      {res ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, borderRadius: 12, background: 'var(--bg)' }}>
            <span className="display" style={{ fontSize: 44, letterSpacing: '.12em' }}>{res.codigo}</span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">{res.usos_max ? 'Un solo uso' : 'Varios usos'} · caduca el {fecha(res.caduca_en)}</span>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={generar}>Generar otro</button>
              <button type="button" className="btn btn-primary" onClick={copiar}>{copiado ? 'Copiado' : 'Copiar mensaje'}</button>
            </div>
          </div>
        </>
      ) : (
        <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-end' }} onClick={generar} disabled={!rolId}>Generar código</button>
      )}
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </Dialogo>
  );
}

const SUGERENCIAS_GRUPO = ['Base', 'Escolta', 'Alero', 'Ala-pívot', 'Pívot'];

function NuevoGrupo({ existentes, onCerrar, onCreado }: { existentes: string[]; onCerrar: () => void; onCreado: () => void }) {
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const sugerencias = SUGERENCIAS_GRUPO.filter((s) => !existentes.some((e) => e.toLowerCase() === s.toLowerCase()));
  async function crear() {
    const { error } = await supabase.rpc('crear_grupo', { p_nombre: nombre });
    if (error) { setError(mensajeError(error)); return; }
    onCreado();
  }
  return (
    <Dialogo titulo="Nuevo grupo" ancho={460} onCerrar={onCerrar}
      pie={<><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="button" className="btn btn-primary" disabled={!nombre.trim()} onClick={crear}>Crear grupo</button></>}>
      <label className="field"><span>Nombre</span><input className="input" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Escribe un nombre o elige una sugerencia" /></label>
      {sugerencias.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          <span className="xs muted">Sugerencias:</span>
          {sugerencias.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={nombre === s} onClick={() => setNombre(s)}>{s}</button>
          ))}
        </div>
      )}
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </Dialogo>
  );
}

function NuevoRol({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: () => void }) {
  const [nombre, setNombre] = useState('');
  const [permisos, setPermisos] = useState<Permisos>(permisosEfectivos({}, null, false));
  const [error, setError] = useState('');
  async function crear() {
    const { error } = await supabase.rpc('crear_rol', { p_nombre: nombre, p_permisos: permisos, p_es_jugador: false });
    if (error) { setError(mensajeError(error)); return; }
    onCreado();
  }
  return (
    <Dialogo titulo="Nuevo rol" ancho={680} onCerrar={onCerrar}
      pie={<><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="button" className="btn btn-primary" disabled={!nombre.trim()} onClick={crear}>Crear rol</button></>}>
      <label className="field"><span>Nombre del rol</span><input className="input" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Por ejemplo: Nutricionista" /></label>
      <p className="xs muted" style={{ margin: 0 }}>Todos los permisos arrancan en «Sin acceso». Elige los que necesite este rol.</p>
      <EditorPermisos valor={permisos} onCambio={setPermisos} />
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </Dialogo>
  );
}

// Clave temporal para quien se olvidó la suya: el admin se la manda por WhatsApp
// y al entrar la persona elige una nueva.
function RestablecerClave({ persona }: { persona: Persona }) {
  const [paso, setPaso] = useState<'inicio' | 'confirmar' | 'listo'>('inicio');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function restablecer() {
    setEnviando(true); setError('');
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    try {
      const r = await fetch('/api/restablecer-clave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ perfil_id: persona.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error || 'No se pudo restablecer la contraseña.'); return; }
      setClave(j.clave); setPaso('listo');
    } catch {
      setError('No hay conexión. Probá de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  const mensaje = `Hola ${persona.nombre.split(' ')[0]}, tu contraseña temporal para entrar a la app es: ${clave}\nEntrá en ${window.location.origin} con tu email (${persona.email}) y esa contraseña; te va a pedir que elijas una nueva.`;

  if (paso === 'inicio') return <button type="button" className="btn btn-sm" onClick={() => setPaso('confirmar')}>Restablecer contraseña</button>;
  return (
    <div className="card stack" style={{ padding: 12, gap: 8, flex: '1 1 100%', background: 'var(--bg)' }}>
      {paso === 'confirmar' ? (
        <>
          <span className="small">Se crea una contraseña temporal para {persona.nombre} y la actual deja de funcionar. ¿Seguimos?</span>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm" onClick={() => setPaso('inicio')}>Cancelar</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={enviando} onClick={restablecer}>{enviando ? 'Creando…' : 'Crear contraseña temporal'}</button>
          </div>
        </>
      ) : (
        <>
          <span className="small">Contraseña temporal de {persona.nombre}:</span>
          <code style={{ fontSize: 22, fontWeight: 700, letterSpacing: '.04em', userSelect: 'all' }}>{clave}</code>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(mensaje); setCopiado(true); } catch { setCopiado(false); } }}>{copiado ? 'Copiado ✓' : 'Copiar mensaje'}</button>
            <a className="btn btn-sm btn-primary" href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noopener noreferrer">Mandar por WhatsApp</a>
          </div>
          <span className="xs muted">Al entrar con esta contraseña, la app le pide elegir una nueva. Queda anotado en el registro de cambios.</span>
        </>
      )}
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
