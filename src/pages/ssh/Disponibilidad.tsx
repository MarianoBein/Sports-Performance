import { useState } from 'react';
import { supabase, mensajeError } from '../../lib/supabase';
import { desdeIso, fechaLarga, hoyIso, iso, sumarDias } from '../../lib/calendario';
import { DISP, TextoRechequeo, EditorParte, PillEstado, PillPartido, dispDe, useJugadores, usePartes, vigentes, type Parte } from './Fisio';

// Tablero de disponibilidad: sale de los partes de fisio.
// «Entrena: no» → Fuera · «con restricciones» o «Pesas: no» → Adaptado (con o sin partido) · el resto, disponible.
// Solo lo ve el staff que entra al Hub (también C-level); los jugadores, nunca.
const ddmm = (f: string) => { const d = desdeIso(f); return `${d.getDate()}/${d.getMonth() + 1}`; };
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function TableroDisponibilidad({ fecha, edita, compacto = false }: { fecha: string; edita: boolean; compacto?: boolean }) {
  const { lista, error, cargar } = usePartes(iso(sumarDias(desdeIso(fecha), -365)));
  const jugadores = useJugadores();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [editando, setEditando] = useState<Parte | null>(null);
  const [errorAccion, setErrorAccion] = useState('');
  const nombre = (p: Parte) => p.nombre_libre ?? jugadores.find((j) => j.id === p.perfil_id)?.nombre ?? '…';
  const vs = vigentes(lista ?? [], fecha);
  const fuera = vs.filter((p) => dispDe(p) === 'fuera').sort((a, b) => nombre(a).localeCompare(nombre(b)));
  const conPartido = vs.filter((p) => dispDe(p) === 'adaptado_partido').sort((a, b) => nombre(a).localeCompare(nombre(b)));
  const sinPartido = vs.filter((p) => dispDe(p) === 'adaptado_sin').sort((a, b) => nombre(a).localeCompare(nombre(b)));
  const registradosAfuera = new Set([...fuera, ...conPartido, ...sinPartido].map((p) => p.perfil_id).filter(Boolean));
  const disponibles = jugadores.filter((j) => !registradosAfuera.has(j.id)).length;

  async function alta(p: Parte) {
    const { error } = await supabase.rpc('dar_alta_parte', { p_id: p.id, p_fecha: fecha < p.fecha ? p.fecha : fecha });
    setErrorAccion(error ? mensajeError(error) : '');
    cargar();
  }

  const Columna = ({ titulo, color, fondo, ps, vacio }: { titulo: string; color: string; fondo: string; ps: Parte[]; vacio: string }) => (
    <section className="disp-columna" style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 14, background: fondo }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong style={{ color, fontSize: 15 }}>{titulo}</strong>
        <span className="pill" style={{ background: '#fff', color, fontWeight: 700 }}>{ps.length}</span>
      </div>
      {!ps.length && <span className="small muted">{vacio}</span>}
      {ps.map((p) => {
        const on = abierto === p.id;
        return (
          <div key={p.id} className="card disp-jugador" style={{ padding: 0, overflow: 'hidden' }}>
            <button type="button" aria-expanded={on} onClick={() => setAbierto(on ? null : p.id)}
              style={{ width: '100%', border: 0, background: 'transparent', padding: '10px 12px', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="row" style={{ justifyContent: 'space-between', gap: 6, width: '100%' }}>
                <strong>{nombre(p)}</strong>
                <TextoRechequeo p={p} dia={fecha} />
              </span>
              <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: on ? 'normal' : 'nowrap' }}>{p.motivo}</span>
            </button>
            {on && (
              <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="row" style={{ gap: 6 }}><PillEstado que="Entrena" estado={p.entrena} /><PillEstado que="Pesas" estado={p.pesas} /><PillPartido p={p} /></div>
                {p.restricciones && <span className="small">Restricciones: {p.restricciones}</span>}
                <span className="xs muted">Parte del {cap(fechaLarga(p.fecha))}{p.nombre_libre ? ' · todavía no está en la app' : ''}</span>
                {edita && (
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn btn-sm" onClick={() => setEditando(p)}>Nuevo parte / cambiar</button>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => alta(p)}>Dar el alta</button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <span className="small"><strong>Disponibles:</strong> todos los demás{jugadores.length ? ` (${disponibles} de ${jugadores.length} registrados)` : ''}</span>
        {edita && !compacto && <button type="button" className="btn btn-sm btn-primary" onClick={() => setNuevo(true)}>+ Agregar al tablero</button>}
      </div>
      {(error || errorAccion) && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error || errorAccion}</p>}
      {!lista ? <span className="small muted">Cargando…</span> : (
        <div className="row" style={{ gap: 10, alignItems: 'stretch' }}>
          <Columna titulo={DISP.adaptado_partido.nombre} color={DISP.adaptado_partido.fg} fondo="#FDF6EC" ps={conPartido} vacio="Nadie adaptado que juegue." />
          <Columna titulo={DISP.adaptado_sin.nombre} color={DISP.adaptado_sin.fg} fondo="#FCEFE4" ps={sinPartido} vacio="Nadie adaptado sin partido." />
          <Columna titulo="Fuera" color="#8E1022" fondo="#FCEEF0" ps={fuera} vacio="Nadie fuera." />
        </div>
      )}
      {nuevo && <EditorParte inicial={{ fecha, entrena: 'restricciones', pesas: 'restricciones' }} jugadores={jugadores} onCerrar={() => setNuevo(false)} onGuardado={() => { setNuevo(false); cargar(); }} />}
      {editando && (
        <EditorParte inicial={{ perfil_id: editando.perfil_id, nombre_libre: editando.nombre_libre, fecha: fecha < editando.fecha ? editando.fecha : fecha, entrena: editando.entrena, pesas: editando.pesas, motivo: editando.motivo, restricciones: editando.restricciones, fecha_rechequeo: editando.fecha_rechequeo, juega_partido: editando.juega_partido ?? false }}
          jugadores={jugadores} onCerrar={() => setEditando(null)} onGuardado={() => { setEditando(null); cargar(); }} />
      )}
    </div>
  );
}

export default function PestanaDisponibilidad({ edita }: { edita: boolean }) {
  const [fecha, setFecha] = useState(hoyIso());
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <p className="muted small" style={{ margin: 0, flex: '1 1 320px' }}>
          Quién está adaptado y quién está fuera, según los partes de fisio. Cada jugador queda así hasta que le den el alta; si pasó el rechequeo y nadie lo actualizó, aparece «⚠ rechequeo vencido». Si alguien todavía no está en la app, se escribe su nombre en el parte.
        </p>
        <div className="row">
          <button type="button" className="btn" style={{ width: 44, padding: 0 }} aria-label="Día anterior" onClick={() => setFecha(iso(sumarDias(desdeIso(fecha), -1)))}>‹</button>
          <label><span className="sr-only">Fecha</span><input className="input" type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} style={{ width: 170 }} /></label>
          <button type="button" className="btn" style={{ width: 44, padding: 0 }} aria-label="Día siguiente" onClick={() => setFecha(iso(sumarDias(desdeIso(fecha), 1)))}>›</button>
          <button type="button" className="btn" onClick={() => setFecha(hoyIso())}>Hoy</button>
        </div>
      </div>
      <p className="small" style={{ margin: 0, fontWeight: 600 }}>{cap(fechaLarga(fecha))}</p>
      <TableroDisponibilidad fecha={fecha} edita={edita} />
    </div>
  );
}
