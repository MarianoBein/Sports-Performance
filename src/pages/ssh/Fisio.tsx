import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, mensajeError } from '../../lib/supabase';
import { fechaLarga, hoyIso, iso, desdeIso, sumarDias } from '../../lib/calendario';
import Dialogo from '../../components/Dialogo';

// Partes de fisio: qué jugador se atendió, cuándo, por qué, si entrena y si hace pesas
// (sí / no / con restricciones) y, si hay que volver a verlo, la fecha del rechequeo.
// Al guardarlo le llega un aviso al staff deportivo. Lo ve todo el que entra al Hub; los jugadores, nunca.

export type Estado = 'si' | 'no' | 'restricciones';
export type Parte = {
  id: string; perfil_id: string; fecha: string; motivo: string; entrena: Estado; pesas: Estado;
  restricciones: string | null; fecha_rechequeo: string | null; creado_en: string;
};
export const TXT_ESTADO: Record<Estado, string> = { si: 'Sí', no: 'No', restricciones: 'Con restricciones' };
export const COLOR_ESTADO: Record<Estado, [string, string]> = { si: ['#E3F2EA', '#1F6B45'], no: ['#FBE3E6', '#8E1022'], restricciones: ['#FDF1E3', '#8A4B00'] };
const COLS = 'id,perfil_id,fecha,motivo,entrena,pesas,restricciones,fecha_rechequeo,creado_en';
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const ddmm = (f: string) => { const d = desdeIso(f); return `${d.getDate()}/${d.getMonth() + 1}`; };

export function PillEstado({ que, estado }: { que: string; estado: Estado }) {
  const [bg, fg] = COLOR_ESTADO[estado];
  return <span className="pill" style={{ background: bg, color: fg, fontSize: 12, whiteSpace: 'nowrap' }}>{que}: {TXT_ESTADO[estado].toLowerCase()}</span>;
}

// Partes desde una fecha (para la pestaña Día, el Perfil y esta pestaña).
export function usePartes(desde: string, perfil?: string) {
  const [lista, setLista] = useState<Parte[] | null>(null);
  const [error, setError] = useState('');
  const cargar = useCallback(async () => {
    let q = supabase.from('partes_fisio').select(COLS).gte('fecha', desde).order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(500);
    if (perfil) q = q.eq('perfil_id', perfil);
    const { data, error } = await q;
    if (error) { setError(mensajeError(error)); setLista([]); return; }
    setLista((data as Parte[]) ?? []);
  }, [desde, perfil]);
  useEffect(() => { cargar(); }, [cargar]);
  return { lista, error, cargar };
}

// Un parte «vale» para un día si es de ese día, o si es anterior y el rechequeo todavía no pasó.
export const parteVigente = (p: Parte, dia: string) => p.fecha === dia || (p.fecha < dia && !!p.fecha_rechequeo && p.fecha_rechequeo >= dia);

function useJugadores() {
  const [lista, setLista] = useState<{ id: string; nombre: string }[]>([]);
  useEffect(() => {
    supabase.from('perfiles').select('id,nombre,rol:roles!inner(es_jugador)').eq('rol.es_jugador', true).is('eliminado_en', null).order('nombre')
      .then(({ data }) => setLista(((data ?? []) as { id: string; nombre: string }[]).map((j) => ({ id: j.id, nombre: j.nombre }))));
  }, []);
  return lista;
}

export default function PestanaFisio({ edita }: { edita: boolean }) {
  const hoy = hoyIso();
  const [dias, setDias] = useState(30);
  const desde = iso(sumarDias(desdeIso(hoy), -dias));
  const { lista, error, cargar } = usePartes(desde);
  const jugadores = useJugadores();
  const nombre = (id: string) => jugadores.find((j) => j.id === id)?.nombre ?? '…';
  const [editando, setEditando] = useState<Partial<Parte> | null>(null);
  const [borrando, setBorrando] = useState<Parte | null>(null);
  const [filtro, setFiltro] = useState('');
  const [errorAccion, setErrorAccion] = useState('');

  const rechequeos = useMemo(() => (lista ?? []).filter((p) => p.fecha_rechequeo && p.fecha_rechequeo >= hoy).sort((a, b) => a.fecha_rechequeo!.localeCompare(b.fecha_rechequeo!)), [lista, hoy]);
  const visibles = (lista ?? []).filter((p) => !filtro || p.perfil_id === filtro);

  async function borrar(p: Parte) {
    const { error } = await supabase.rpc('eliminar_parte', { p_id: p.id });
    if (error) setErrorAccion(mensajeError(error));
    setBorrando(null); cargar();
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <p className="muted small" style={{ margin: 0, flex: '1 1 320px' }}>
          Cada parte le avisa al celular al staff deportivo (entrenadores, skills, PF y fisio). El día del rechequeo, le recuerda a quien lo cargó y a los fisios. Lo ve todo el que entra al Hub; los jugadores, no.
        </p>
        {edita && <button type="button" className="btn btn-primary" onClick={() => setEditando({ fecha: hoy, entrena: 'si', pesas: 'si' })}>+ Nuevo parte</button>}
      </div>
      {(error || errorAccion) && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error || errorAccion}</p>}

      {rechequeos.length > 0 && (
        <section className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong style={{ fontSize: 16 }}>Próximos rechequeos</strong>
          {rechequeos.map((p) => (
            <div key={p.id} className="row" style={{ gap: 8, padding: '6px 10px', borderRadius: 8, background: p.fecha_rechequeo === hoy ? '#FDF1E3' : 'var(--bg)' }}>
              <strong style={{ minWidth: 92 }}>{p.fecha_rechequeo === hoy ? 'Hoy' : fechaLarga(p.fecha_rechequeo!).split(' de ')[0]}</strong>
              <span style={{ flex: 1 }}>{nombre(p.perfil_id)} <span className="small muted">· {p.motivo.slice(0, 80)}</span></span>
            </div>
          ))}
        </section>
      )}

      <section className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <strong style={{ fontSize: 16 }}>Partes</strong>
          <div className="row" style={{ gap: 6 }}>
            <label><span className="sr-only">Jugador</span>
              <select className="select" style={{ height: 36, width: 200 }} value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                <option value="">Todos los jugadores</option>
                {jugadores.map((j) => <option key={j.id} value={j.id}>{j.nombre}</option>)}
              </select>
            </label>
            <label><span className="sr-only">Período</span>
              <select className="select" style={{ height: 36, width: 150 }} value={dias} onChange={(e) => setDias(Number(e.target.value))}>
                <option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option><option value={365}>Último año</option>
              </select>
            </label>
          </div>
        </div>
        {!lista ? <span className="small muted">Cargando…</span> : !visibles.length ? <span className="small muted">No hay partes en este período.</span> : visibles.map((p) => (
          <div key={p.id} className="parte" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', border: '1px solid var(--line-soft)', borderRadius: 10 }}>
            <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
              <strong>{nombre(p.perfil_id)} <span className="small muted" style={{ fontWeight: 400 }}>· {cap(fechaLarga(p.fecha))}</span></strong>
              {edita && (
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn btn-sm" onClick={() => setEditando(p)}>Editar</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setBorrando(p)}>Borrar</button>
                </div>
              )}
            </div>
            <span className="small" style={{ whiteSpace: 'pre-wrap' }}>{p.motivo}</span>
            <div className="row" style={{ gap: 6 }}>
              <PillEstado que="Entrena" estado={p.entrena} /><PillEstado que="Pesas" estado={p.pesas} />
              {p.fecha_rechequeo && <span className="pill" style={{ background: '#EEF3FD', color: '#1D3F8F', fontSize: 12 }}>Rechequeo {ddmm(p.fecha_rechequeo)}</span>}
            </div>
            {p.restricciones && <span className="small muted">Restricciones: {p.restricciones}</span>}
          </div>
        ))}
      </section>

      {editando && <EditorParte inicial={editando} jugadores={jugadores} onCerrar={() => setEditando(null)} onGuardado={() => { setEditando(null); cargar(); }} />}
      {borrando && (
        <Dialogo titulo="¿Borrar este parte?" ancho={440} onCerrar={() => setBorrando(null)}
          pie={<><button type="button" className="btn" onClick={() => setBorrando(null)}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => borrar(borrando)}>Borrar</button></>}>
          <span className="small">Parte de {nombre(borrando.perfil_id)} del {ddmm(borrando.fecha)}. No se puede deshacer.</span>
        </Dialogo>
      )}
    </div>
  );
}

function Opciones({ id, valor, onCambio }: { id: string; valor: Estado; onCambio: (v: Estado) => void }) {
  return (
    <div id={id} className="row" role="radiogroup" style={{ gap: 4 }}>
      {(['si', 'no', 'restricciones'] as Estado[]).map((e) => (
        <button key={e} type="button" role="radio" className="chip" aria-checked={valor === e} aria-pressed={valor === e} onClick={() => onCambio(e)}>{TXT_ESTADO[e]}</button>
      ))}
    </div>
  );
}

function EditorParte({ inicial, jugadores, onCerrar, onGuardado }: {
  inicial: Partial<Parte>; jugadores: { id: string; nombre: string }[]; onCerrar: () => void; onGuardado: () => void;
}) {
  const [p, setP] = useState({
    perfil_id: inicial.perfil_id ?? '', fecha: inicial.fecha ?? hoyIso(), motivo: inicial.motivo ?? '',
    entrena: (inicial.entrena ?? 'si') as Estado, pesas: (inicial.pesas ?? 'si') as Estado, restricciones: inicial.restricciones ?? '',
  });
  const [volver, setVolver] = useState(!!inicial.fecha_rechequeo);
  const [rechequeo, setRechequeo] = useState(inicial.fecha_rechequeo ?? iso(sumarDias(desdeIso(inicial.fecha ?? hoyIso()), 2)));
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const conRestr = p.entrena === 'restricciones' || p.pesas === 'restricciones';

  async function guardar() {
    setError('');
    if (!p.perfil_id) { setError('Elegí el jugador.'); return; }
    if (!p.motivo.trim()) { setError('Escribí el motivo.'); return; }
    if (volver && (!rechequeo || rechequeo < p.fecha)) { setError('La fecha del rechequeo tiene que ser después del parte.'); return; }
    setGuardando(true);
    const { error } = await supabase.rpc('guardar_parte', {
      p_id: inicial.id ?? null, p_perfil: p.perfil_id, p_fecha: p.fecha, p_motivo: p.motivo.trim(), p_entrena: p.entrena, p_pesas: p.pesas,
      p_restricciones: conRestr ? p.restricciones.trim() || null : null, p_fecha_rechequeo: volver ? rechequeo : null,
    });
    setGuardando(false);
    if (error) { setError(mensajeError(error)); return; }
    onGuardado();
  }

  return (
    <Dialogo titulo={inicial.id ? 'Editar parte' : 'Nuevo parte de fisio'} ancho={600} onCerrar={onCerrar}
      pie={<><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button id="parte-guardar" type="button" className="btn btn-primary" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : inicial.id ? 'Guardar' : 'Guardar y avisar'}</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <label className="field"><span>Jugador</span>
          <select id="parte-jugador" className="select" value={p.perfil_id} onChange={(e) => setP({ ...p, perfil_id: e.target.value })}>
            <option value="">Elegí…</option>
            {jugadores.map((j) => <option key={j.id} value={j.id}>{j.nombre}</option>)}
          </select>
        </label>
        <label className="field"><span>Día de la atención</span>
          <input id="parte-fecha" className="input" type="date" value={p.fecha} max={iso(sumarDias(new Date(), 1))} onChange={(e) => setP({ ...p, fecha: e.target.value })} />
        </label>
      </div>
      <label className="field"><span>Motivo</span>
        <textarea id="parte-motivo" className="input" rows={3} maxLength={2000} value={p.motivo} onChange={(e) => setP({ ...p, motivo: e.target.value })}
          placeholder="Por ejemplo: molestia en isquio derecho después del partido" style={{ height: 'auto', padding: 10, resize: 'vertical' }} />
      </label>
      <div className="field"><span>¿Entrena?</span><Opciones id="parte-entrena" valor={p.entrena} onCambio={(v) => setP({ ...p, entrena: v })} /></div>
      <div className="field"><span>¿Pesas?</span><Opciones id="parte-pesas" valor={p.pesas} onCambio={(v) => setP({ ...p, pesas: v })} /></div>
      {conRestr && (
        <label className="field"><span>¿Qué restricciones? (opcional)</span>
          <input id="parte-restricciones" className="input" maxLength={1000} value={p.restricciones} onChange={(e) => setP({ ...p, restricciones: e.target.value })} placeholder="Por ejemplo: sin sprints ni saltos; tren superior libre" />
        </label>
      )}
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
          <input id="parte-volver" type="checkbox" checked={volver} onChange={(e) => setVolver(e.target.checked)} />
          <span>Hay que volver a verlo</span>
        </label>
        {volver && (
          <label className="row" style={{ gap: 6 }}><span className="small">Rechequeo:</span>
            <input id="parte-rechequeo" className="input" type="date" value={rechequeo} min={p.fecha} onChange={(e) => setRechequeo(e.target.value)} style={{ width: 170 }} />
          </label>
        )}
      </div>
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </Dialogo>
  );
}
