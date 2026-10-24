import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { supabase, mensajeError } from '../lib/supabase';

type Org = {
  id: string; nombre: string; tipo: string; plan: string; estado: string; sede_local: string | null;
  notas_dueno: string | null; creado_en: string; personas: number; jugadores: number;
  admins: string | null; ultima_actividad: string;
};

const TIPOS: Record<string, string> = { club: 'Club', entrenamiento_online: 'Entrenamiento online', otro: 'Otro' };
const PLANES: Record<string, string> = { prueba: 'Prueba', regalo: 'Regalo', pago: 'Pago' };
const ESTADOS: Record<string, string> = { activa: 'Activa', suspendida: 'Suspendida', baja: 'Baja' };
const ESTILO_ESTADO: Record<string, CSSProperties> = {
  activa: { background: 'var(--ok-bg)', color: 'var(--ok-fg)' },
  suspendida: { background: 'var(--warn-bg)', color: 'var(--warn-fg)' },
  baja: { background: '#F1EFEA', color: 'var(--muted)' },
};
const ROLES_ADMIN = [
  { clave: 'principal', nombre: 'Entrenador principal' },
  { clave: 'pf', nombre: 'Preparador físico' },
  { clave: 'fisio', nombre: 'Fisioterapeuta' },
];
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

function Dialogo({ titulo, onCerrar, children, pie }: { titulo: string; onCerrar: () => void; children: ReactNode; pie?: ReactNode }) {
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-label={titulo} style={{ maxWidth: 560 }}>
        <div className="dialog-head">
          <h2 className="display">{titulo}</h2>
          <button type="button" className="close" aria-label="Cerrar" onClick={onCerrar}>×</button>
        </div>
        <div className="dialog-body">{children}</div>
        {pie && <div className="dialog-foot">{pie}</div>}
      </section>
    </div>
  );
}

function CodigoListo({ codigo }: { codigo: string }) {
  const [copiado, setCopiado] = useState(false);
  const texto = `Tu código para crear la cuenta de administrador es ${codigo}. Entra en ${window.location.origin}/alta`;
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'center', padding: 18, borderRadius: 12, background: 'var(--bg)' }}>
        <span className="display" style={{ fontSize: 38, letterSpacing: '.1em' }}>{codigo}</span>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">Un solo uso · caduca en 14 días · da acceso de administrador</span>
        <button type="button" className="btn btn-primary" onClick={async () => { try { await navigator.clipboard.writeText(texto); setCopiado(true); } catch { /* sin portapapeles */ } }}>
          {copiado ? 'Copiado' : 'Copiar mensaje'}
        </button>
      </div>
    </>
  );
}

export default function Plataforma() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [error, setError] = useState('');
  const [nueva, setNueva] = useState(false);
  const [editando, setEditando] = useState<Org | null>(null);
  const [codigo, setCodigo] = useState<{ org: string; codigo: string } | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('plataforma_organizaciones');
    if (error) setError(mensajeError(error)); else setError('');
    setOrgs((data as Org[]) ?? []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const activas = orgs.filter((o) => o.estado === 'activa');
  const personas = orgs.reduce((t, o) => t + o.personas, 0);

  async function nuevoCodigo(o: Org) {
    const { data, error } = await supabase.rpc('plataforma_nuevo_codigo_admin', { p_club: o.id, p_rol_admin: 'principal' });
    if (error) { setError(mensajeError(error)); return; }
    setCodigo({ org: o.nombre, codigo: data as string });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="muted small" style={{ margin: '0 0 4px' }}>Solo el dueño de la plataforma · sin acceso a los datos internos de cada organización</p>
          <h1 className="display" style={{ fontSize: 38 }}>Plataforma</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setNueva(true)}>+ Nueva organización</button>
      </div>

      {error && <p className="notice notice-error" role="alert">{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[['Organizaciones', orgs.length], ['Activas', activas.length], ['En prueba o regalo', orgs.filter((o) => o.plan !== 'pago').length], ['Personas en total', personas]].map(([l, v]) => (
          <div key={l} className="card" style={{ padding: 14, textAlign: 'center' }}>
            <div className="small muted" style={{ fontWeight: 600 }}>{l}</div>
            <div className="display" style={{ fontSize: 32 }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="card table-wrap">
        <table className="tbl" style={{ minWidth: 1080 }}>
          <thead>
            <tr>
              <th scope="col">Organización</th>
              <th scope="col">Tipo</th>
              <th scope="col">Plan</th>
              <th scope="col">Estado</th>
              <th scope="col">Personas</th>
              <th scope="col">Administradores (contacto)</th>
              <th scope="col">Última actividad</th>
              <th scope="col" style={{ textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id}>
                <th scope="row">
                  <div style={{ fontWeight: 600 }}>{o.nombre}</div>
                  <div className="xs muted">Alta {fecha(o.creado_en)}{o.notas_dueno ? ` · ${o.notas_dueno}` : ''}</div>
                </th>
                <td>{TIPOS[o.tipo] ?? o.tipo}</td>
                <td>{PLANES[o.plan] ?? o.plan}</td>
                <td><span className="pill" style={ESTILO_ESTADO[o.estado]}>{ESTADOS[o.estado] ?? o.estado}</span></td>
                <td>{o.personas} <span className="xs muted">({o.jugadores} jugadores)</span></td>
                <td className="small" style={{ maxWidth: 280 }}>{o.admins ?? <span className="muted">Aún sin administrador</span>}</td>
                <td className="small">{fecha(o.ultima_actividad)}</td>
                <td>
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 4, flexWrap: 'nowrap' }}>
                    <button type="button" className="btn btn-sm" onClick={() => nuevoCodigo(o)}>Código admin</button>
                    <button type="button" className="btn btn-sm" onClick={() => setEditando(o)}>Editar</button>
                  </div>
                </td>
              </tr>
            ))}
            {orgs.length === 0 && !error && <tr><td colSpan={8} className="muted">Todavía no hay organizaciones.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="xs muted" style={{ marginTop: 10 }}>Una organización suspendida pierde el acceso, pero sus datos se conservan. Los datos internos (personas, cargas, wellness) solo los ve cada organización.</p>

      {nueva && <NuevaOrg onCerrar={() => setNueva(false)} onCreada={async () => { await cargar(); }} />}
      {editando && <EditarOrg org={editando} onCerrar={() => setEditando(null)} onGuardada={async () => { setEditando(null); await cargar(); }} />}
      {codigo && (
        <Dialogo titulo={`Código de administrador · ${codigo.org}`} onCerrar={() => setCodigo(null)}>
          <CodigoListo codigo={codigo.codigo} />
        </Dialogo>
      )}
    </div>
  );
}

function NuevaOrg({ onCerrar, onCreada }: { onCerrar: () => void; onCreada: () => void }) {
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('club');
  const [plan, setPlan] = useState('regalo');
  const [sede, setSede] = useState('');
  const [rol, setRol] = useState('principal');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState('');

  async function crear() {
    setError('');
    const { data, error } = await supabase.rpc('plataforma_crear_organizacion', { p_nombre: nombre, p_tipo: tipo, p_plan: plan, p_sede: sede, p_rol_admin: rol });
    if (error) { setError(mensajeError(error)); return; }
    const r = Array.isArray(data) ? data[0] : data;
    setCodigo(r.codigo);
    onCreada();
  }

  return (
    <Dialogo titulo="Nueva organización" onCerrar={onCerrar}
      pie={codigo ? <button type="button" className="btn" onClick={onCerrar}>Listo</button> : <>
        <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={!nombre.trim()} onClick={crear}>Crear organización</button>
      </>}>
      {codigo ? (
        <>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>Listo. Pásale este código a quien vaya a administrarla: con él crea su cuenta y queda como administrador.</p>
          <CodigoListo codigo={codigo} />
        </>
      ) : (
        <>
          <label className="field"><span>Nombre</span><input className="input" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Club o negocio" /></label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <label className="field"><span>Tipo</span>
              <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value)}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="field"><span>Plan</span>
              <select className="select" value={plan} onChange={(e) => setPlan(e.target.value)}>{Object.entries(PLANES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
          </div>
          <label className="field"><span>Lugar habitual (opcional)</span><input className="input" value={sede} onChange={(e) => setSede(e.target.value)} placeholder="Pabellón, gimnasio…" /></label>
          <label className="field"><span>Rol del primer administrador</span>
            <select className="select" value={rol} onChange={(e) => setRol(e.target.value)}>{ROLES_ADMIN.map((r) => <option key={r.clave} value={r.clave}>{r.nombre}</option>)}</select>
          </label>
          <p className="xs muted" style={{ margin: 0 }}>Se crea con los roles base y un código de administrador de un solo uso.</p>
        </>
      )}
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </Dialogo>
  );
}

function EditarOrg({ org, onCerrar, onGuardada }: { org: Org; onCerrar: () => void; onGuardada: () => void }) {
  const [plan, setPlan] = useState(org.plan);
  const [estado, setEstado] = useState(org.estado);
  const [notas, setNotas] = useState(org.notas_dueno ?? '');
  const [error, setError] = useState('');
  async function guardar() {
    const { error } = await supabase.rpc('plataforma_actualizar_organizacion', { p_club: org.id, p_plan: plan, p_estado: estado, p_notas: notas || null });
    if (error) { setError(mensajeError(error)); return; }
    onGuardada();
  }
  return (
    <Dialogo titulo={org.nombre} onCerrar={onCerrar}
      pie={<><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="button" className="btn btn-primary" onClick={guardar}>Guardar</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <label className="field"><span>Plan</span>
          <select className="select" value={plan} onChange={(e) => setPlan(e.target.value)}>{Object.entries(PLANES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="field"><span>Estado</span>
          <select className="select" value={estado} onChange={(e) => setEstado(e.target.value)}>{Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
      </div>
      {estado !== 'activa' && <p className="notice notice-warn" style={{ margin: 0 }}>Nadie de esta organización podrá entrar mientras no esté activa. Sus datos se conservan.</p>}
      <label className="field"><span>Notas internas (solo tú)</span><input className="input" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej.: prueba hasta enero" /></label>
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </Dialogo>
  );
}
