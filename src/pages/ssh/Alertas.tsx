import { useCallback, useEffect, useState } from 'react';
import { supabase, mensajeError } from '../../lib/supabase';
import { hoyIso, iso, desdeIso, sumarDias, fechaLarga } from '../../lib/calendario';
import Dialogo from '../../components/Dialogo';

// Alertas del Sports Science Hub: reglas del club que se revisan cada 5 minutos.
// Si un jugador cumple una, le llega un aviso al celular a todo el staff deportivo
// (entrenadores, skills, preparador físico y fisio) y queda marcada acá.
// Un dato que falta nunca cuenta: si no contestó, la condición no se cumple.

export type Condicion = { metrica: MetricaA; comparador: Comp; referencia: 'valor' | 'media'; valor: number };
type MetricaA = 'sueno' | 'fatiga' | 'estres' | 'dolor' | 'preparacion' | 'rpe';
type Comp = 'menor' | 'menor_igual' | 'mayor' | 'mayor_igual';
export type Regla = { id: string; nombre: string; activa: boolean; modo: 'todas' | 'alguna'; dias: number; condiciones: Condicion[] };
export type Disparada = { id: string; regla_id: string; perfil_id: string; fecha: string; detalle: string; creado_en: string };

const METRICAS: [MetricaA, string, string][] = [
  ['sueno', 'Sueño', '1 a 5 · 5 = durmió bien'],
  ['preparacion', 'Preparación', '1 a 5 · 5 = mejor'],
  ['fatiga', 'Fatiga', '1 a 5 · 5 = muy cansado'],
  ['estres', 'Estrés', '1 a 5 · 5 = muy estresado'],
  ['dolor', 'Dolor muscular', '1 a 5 · 5 = mucho dolor'],
  ['rpe', 'RPE', '0 a 10'],
];
const COMPS: [Comp, string][] = [['menor', 'menor que'], ['menor_igual', 'menor o igual que'], ['mayor', 'mayor que'], ['mayor_igual', 'mayor o igual que']];
const nombreM = (m: MetricaA) => METRICAS.find((x) => x[0] === m)?.[1] ?? m;
const signo: Record<Comp, string> = { menor: '<', menor_igual: '≤', mayor: '>', mayor_igual: '≥' };
const num = (v: number) => String(v).replace('.', ',');

export function textoCondicion(c: Condicion) {
  const lim = c.referencia === 'media'
    ? `su media${c.valor ? ` ${c.valor > 0 ? '+' : '−'} ${num(Math.abs(c.valor))}` : ''}`
    : num(c.valor);
  return `${nombreM(c.metrica)} ${signo[c.comparador]} ${lim}`;
}
export function textoRegla(r: Regla) {
  const conds = r.condiciones.map(textoCondicion).join(r.modo === 'todas' ? ' y ' : ' o ');
  return `${conds}${r.dias > 1 ? `, ${r.dias} días seguidos` : ''}`;
}

export const EJEMPLOS: Omit<Regla, 'id'>[] = [
  { nombre: 'Duerme mal', activa: true, modo: 'alguna', dias: 2, condiciones: [
    { metrica: 'sueno', comparador: 'menor', referencia: 'media', valor: -1 },
    { metrica: 'sueno', comparador: 'menor_igual', referencia: 'valor', valor: 2 },
  ] },
  { nombre: 'Preparación baja', activa: true, modo: 'todas', dias: 2, condiciones: [
    { metrica: 'preparacion', comparador: 'menor', referencia: 'media', valor: -0.75 },
  ] },
  { nombre: 'RPE muy alto', activa: true, modo: 'todas', dias: 2, condiciones: [
    { metrica: 'rpe', comparador: 'mayor_igual', referencia: 'valor', valor: 9 },
  ] },
];

// Alertas recientes (para marcar jugadores en otras pestañas)
export function useAlertasRecientes(dias = 14) {
  const [lista, setLista] = useState<Disparada[]>([]);
  const cargar = useCallback(async () => {
    const { data } = await supabase.from('alertas_disparadas').select('id,regla_id,perfil_id,fecha,detalle,creado_en')
      .gte('fecha', iso(sumarDias(desdeIso(hoyIso()), -dias))).order('creado_en', { ascending: false }).limit(300);
    setLista((data as Disparada[]) ?? []);
  }, [dias]);
  useEffect(() => { cargar(); }, [cargar]);
  return { lista, cargar };
}

export default function PestanaAlertas({ edita }: { edita: boolean }) {
  const [reglas, setReglas] = useState<Regla[] | null>(null);
  const { lista, cargar: cargarDisparadas } = useAlertasRecientes(14);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState<Regla | Omit<Regla, 'id'> | null>(null);
  const [borrando, setBorrando] = useState<Regla | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('alertas_reglas').select('id,nombre,activa,modo,dias,condiciones').order('creado_en');
    if (error) { setError(mensajeError(error)); setReglas([]); return; }
    setReglas((data as Regla[]) ?? []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function guardar(r: Regla | Omit<Regla, 'id'>) {
    const { error } = await supabase.rpc('guardar_alerta', {
      p_id: 'id' in r ? r.id : null, p_nombre: r.nombre, p_activa: r.activa, p_modo: r.modo, p_dias: r.dias, p_condiciones: r.condiciones,
    });
    if (error) return mensajeError(error);
    await cargar();
    return '';
  }
  async function agregarEjemplos() {
    setError('');
    for (const e of EJEMPLOS) {
      if (reglas?.some((r) => r.nombre === e.nombre)) continue;
      const m = await guardar(e);
      if (m) { setError(m); return; }
    }
  }
  async function borrar(r: Regla) {
    const { error } = await supabase.rpc('eliminar_alerta', { p_id: r.id });
    if (error) setError(mensajeError(error));
    setBorrando(null); await cargar(); await cargarDisparadas();
  }

  const nombreRegla = (id: string) => reglas?.find((r) => r.id === id)?.nombre;
  const porDia = lista.reduce<Record<string, Disparada[]>>((acc, d) => { (acc[d.fecha] ??= []).push(d); return acc; }, {});

  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        Cada regla se revisa cada 5 minutos. Si un jugador la cumple, le llega un aviso al celular a todo el staff deportivo (entrenador principal, ayudante, skills, preparador físico y fisio) y queda marcada acá y en la pestaña Día. Cada uno tiene que activar los avisos una vez desde Inicio. Si un jugador no contestó, esa condición no cuenta.
      </p>
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}

      <section className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <strong style={{ fontSize: 16 }}>Últimas 2 semanas</strong>
        {!lista.length ? <span className="small muted">Ninguna alerta en los últimos 14 días.</span> : Object.entries(porDia).map(([f, ds]) => (
          <div key={f} className="stack" style={{ gap: 4 }}>
            <span className="xs muted" style={{ fontWeight: 600, textTransform: 'capitalize' }}>{fechaLarga(f)}</span>
            {ds.map((d) => (
              <div key={d.id} className="row alerta-disparada" style={{ gap: 8, padding: '6px 10px', borderRadius: 8, background: '#FDF1E3' }}>
                <span aria-hidden="true">⚠</span>
                <span className="small" style={{ flex: 1 }}>{d.detalle}</span>
                {!nombreRegla(d.regla_id) && <span className="xs muted">(regla borrada)</span>}
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <strong style={{ fontSize: 16 }}>Reglas</strong>
          {edita && (
            <div className="row" style={{ gap: 6 }}>
              {reglas && EJEMPLOS.some((e) => !reglas.some((r) => r.nombre === e.nombre)) && <button type="button" className="btn btn-sm" onClick={agregarEjemplos}>Agregar ejemplos</button>}
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditando({ nombre: '', activa: true, modo: 'todas', dias: 1, condiciones: [{ metrica: 'sueno', comparador: 'menor', referencia: 'media', valor: -1 }] })}>+ Nueva regla</button>
            </div>
          )}
        </div>
        {!reglas ? <span className="small muted">Cargando…</span> : !reglas.length ? (
          <span className="small muted">Todavía no hay reglas.{edita ? ' Tocá «Agregar ejemplos» para empezar con tres típicas y cambiarlas a tu gusto.' : ''}</span>
        ) : reglas.map((r) => (
          <div key={r.id} className="row regla" style={{ gap: 10, padding: '10px 12px', border: '1px solid var(--line-soft)', borderRadius: 10, opacity: r.activa ? 1 : 0.6 }}>
            <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <strong>{r.nombre}{!r.activa && <span className="xs muted" style={{ fontWeight: 400 }}> · pausada</span>}</strong>
              <span className="small muted">{textoRegla(r)}</span>
            </div>
            {edita && (
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn btn-sm" onClick={async () => { const m = await guardar({ ...r, activa: !r.activa }); if (m) setError(m); }}>{r.activa ? 'Pausar' : 'Activar'}</button>
                <button type="button" className="btn btn-sm" onClick={() => setEditando(r)}>Editar</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setBorrando(r)}>Borrar</button>
              </div>
            )}
          </div>
        ))}
      </section>

      {editando && <EditorRegla inicial={editando} onCerrar={() => setEditando(null)} onGuardar={async (r) => { const m = await guardar(r); if (!m) setEditando(null); return m; }} />}
      {borrando && (
        <Dialogo titulo={`¿Borrar «${borrando.nombre}»?`} ancho={460} onCerrar={() => setBorrando(null)}
          pie={<><button type="button" className="btn" onClick={() => setBorrando(null)}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => borrar(borrando)}>Borrar</button></>}>
          <span className="small">Se borra la regla y sus alertas anteriores. Si solo querés que deje de avisar un tiempo, usá «Pausar».</span>
        </Dialogo>
      )}
    </div>
  );
}

function EditorRegla({ inicial, onCerrar, onGuardar }: { inicial: Regla | Omit<Regla, 'id'>; onCerrar: () => void; onGuardar: (r: Regla | Omit<Regla, 'id'>) => Promise<string> }) {
  const [r, setR] = useState(inicial);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const setC = (i: number, c: Partial<Condicion>) => setR({ ...r, condiciones: r.condiciones.map((x, j) => (j === i ? { ...x, ...c } : x)) });

  async function guardar() {
    setError('');
    if (!r.nombre.trim()) { setError('Poné un nombre.'); return; }
    if (r.condiciones.some((c) => !Number.isFinite(c.valor))) { setError('Hay un número vacío.'); return; }
    setGuardando(true);
    const m = await onGuardar({ ...r, nombre: r.nombre.trim() });
    setGuardando(false);
    if (m) setError(m);
  }

  return (
    <Dialogo titulo={'id' in inicial ? 'Editar regla' : 'Nueva regla'} ancho={720} onCerrar={onCerrar}
      pie={<><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button id="regla-guardar" type="button" className="btn btn-primary" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar'}</button></>}>
      <label className="field"><span>Nombre (es lo que dice el aviso)</span>
        <input id="regla-nombre" className="input" maxLength={80} value={r.nombre} onChange={(e) => setR({ ...r, nombre: e.target.value })} placeholder="Por ejemplo: Duerme mal" />
      </label>
      <div className="stack" style={{ gap: 8 }}>
        <span className="small" style={{ fontWeight: 600 }}>Qué mirar</span>
        {r.condiciones.map((c, i) => (
          <div key={i} className="row condicion" style={{ gap: 6, padding: 8, borderRadius: 10, background: 'var(--bg)' }}>
            {i > 0 && <span className="xs" style={{ fontWeight: 700, width: '100%' }}>{r.modo === 'todas' ? 'Y' : 'O'}</span>}
            <select className="select" aria-label="Métrica" style={{ height: 36, width: 'auto' }} value={c.metrica}
              onChange={(e) => { const m = e.target.value as MetricaA; setC(i, { metrica: m, valor: c.referencia === 'valor' ? (m === 'rpe' ? 8 : 2) : c.valor }); }}>
              {METRICAS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
            <select className="select" aria-label="Comparación" style={{ height: 36, width: 'auto' }} value={c.comparador} onChange={(e) => setC(i, { comparador: e.target.value as Comp })}>
              {COMPS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
            <select className="select" aria-label="Contra qué" style={{ height: 36, width: 'auto' }} value={c.referencia}
              onChange={(e) => { const ref = e.target.value as 'valor' | 'media'; setC(i, { referencia: ref, valor: ref === 'media' ? -1 : (c.metrica === 'rpe' ? 8 : 2) }); }}>
              <option value="valor">un número fijo</option>
              <option value="media">su propia media</option>
            </select>
            {c.referencia === 'media' ? (
              <select className="select" aria-label="Margen" style={{ height: 36, width: 'auto' }} value={String(c.valor)} onChange={(e) => setC(i, { valor: Number(e.target.value) })}>
                {[-2, -1.5, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.5, 2].map((v) => <option key={v} value={String(v)}>{v === 0 ? 'exacta' : `${v > 0 ? '+' : '−'} ${num(Math.abs(v))}`}</option>)}
              </select>
            ) : (
              <input className="input" aria-label="Número" inputMode="decimal" style={{ height: 36, width: 80 }}
                value={Number.isFinite(c.valor) ? num(c.valor) : ''}
                onChange={(e) => { const t = e.target.value.replace(',', '.'); setC(i, { valor: t === '' ? NaN : Number(t) }); }} />
            )}
            <span className="xs muted">{METRICAS.find((x) => x[0] === c.metrica)?.[2]}</span>
            {r.condiciones.length > 1 && <button type="button" className="btn btn-sm btn-ghost" aria-label="Sacar condición" onClick={() => setR({ ...r, condiciones: r.condiciones.filter((_, j) => j !== i) })}>×</button>}
          </div>
        ))}
        {r.condiciones.length < 6 && (
          <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }}
            onClick={() => setR({ ...r, condiciones: [...r.condiciones, { metrica: 'sueno', comparador: 'menor_igual', referencia: 'valor', valor: 2 }] })}>+ Otra condición</button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {r.condiciones.length > 1 && (
          <label className="field"><span>Se avisa cuando se cumplen</span>
            <select id="regla-modo" className="select" value={r.modo} onChange={(e) => setR({ ...r, modo: e.target.value as 'todas' | 'alguna' })}>
              <option value="todas">todas las condiciones</option>
              <option value="alguna">alguna de las condiciones</option>
            </select>
          </label>
        )}
        <label className="field"><span>Días seguidos</span>
          <select id="regla-dias" className="select" value={r.dias} onChange={(e) => setR({ ...r, dias: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{d === 1 ? 'Solo hoy' : `${d} días seguidos`}</option>)}
          </select>
        </label>
      </div>
      <p className="small" style={{ margin: 0, padding: '8px 10px', borderRadius: 8, background: '#EEF3FD' }}>
        <strong>Se lee así:</strong> {textoRegla(r as Regla) || '—'}.
        {r.condiciones.some((c) => c.referencia === 'media') && <span className="muted"> «Su media» es la del propio jugador en los 28 días anteriores (hacen falta al menos 5 respuestas).</span>}
      </p>
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </Dialogo>
  );
}
