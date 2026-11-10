import { useEffect, useRef, useState } from 'react';
import { desdeIso } from '../../lib/calendario';
import { fmt, type Datos, type Dia } from '../../lib/carga';

// Comparador: de 2 a 4 jugadores en el mismo gráfico, día por día.
// Un día sin dato queda vacío con una marca chica: nunca se dibuja como cero.
export type MetricaComp = 'preparacion' | 'sueno' | 'fatiga' | 'estres' | 'dolor' | 'rpe' | 'esfuerzo';
const NOMBRE_COMP: Record<MetricaComp, string> = {
  preparacion: 'Preparación', sueno: 'Sueño', fatiga: 'Fatiga', estres: 'Estrés', dolor: 'Dolor muscular', rpe: 'RPE', esfuerzo: 'Esfuerzo',
};
const AYUDA: Record<MetricaComp, string> = {
  preparacion: 'de 1 a 5 · 5 = mejor', sueno: '5 = durmió bien', fatiga: '5 = muy cansado', estres: '5 = muy estresado',
  dolor: '5 = mucho dolor', rpe: 'de 0 a 10', esfuerzo: 'RPE × minutos',
};
const TOPE: Partial<Record<MetricaComp, number>> = { preparacion: 5, sueno: 5, fatiga: 5, estres: 5, dolor: 5, rpe: 10 };
const DEC: Record<MetricaComp, number> = { preparacion: 2, sueno: 0, fatiga: 0, estres: 0, dolor: 0, rpe: 0, esfuerzo: 0 };
// Sin rojo ni verde: esos colores ya significan «alerta» y «bien» en el Hub.
export const COLORES = ['#1D5BD8', '#E07A10', '#2A9D8F', '#9B3FB5'];
const MAX = 4;

// La selección se recuerda al pasar de pestaña (solo en esta pestaña del navegador).
function useSeleccion(): [string[], (v: string[]) => void] {
  const [sel, setSel] = useState<string[]>(() => {
    try { const v = JSON.parse(sessionStorage.getItem('ssh-comparar') || '[]'); return Array.isArray(v) ? v.slice(0, MAX) : []; } catch { return []; }
  });
  const cambiar = (v: string[]) => { setSel(v); try { sessionStorage.setItem('ssh-comparar', JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
  return [sel, cambiar];
}

export default function Comparador({ datos, dias, metricas, titulo = 'Comparar jugadores', etiquetas }: {
  datos: Datos; dias: string[]; metricas: MetricaComp[]; titulo?: string; etiquetas?: (string | null)[];
}) {
  const [sel0, setSel] = useSeleccion();
  const sel = sel0.filter((id) => datos.jugadores.some((j) => j.id === id));
  const [metrica, setMetrica] = useState<MetricaComp>(metricas[0]);
  const m = metricas.includes(metrica) ? metrica : metricas[0];
  const nombre = (id: string) => datos.jugadores.find((j) => j.id === id)?.nombre ?? '';
  const libres = datos.jugadores.filter((j) => !sel.includes(j.id));
  const valor = (id: string, f: string) => (datos.dia(id, f) as Dia)[m] ?? null;

  return (
    <section className="card" id="comparador" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 16 }}>{titulo}</strong>
        <span className="xs muted">Elegí de 2 a {MAX} jugadores</span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {sel.map((id, i) => (
          <span key={id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderColor: COLORES[i], cursor: 'default' }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: COLORES[i] }} />
            {nombre(id)}
            <button type="button" aria-label={`Sacar a ${nombre(id)}`} onClick={() => setSel(sel.filter((x) => x !== id))}
              style={{ border: 0, background: 'none', padding: '0 2px', cursor: 'pointer', fontSize: 15, lineHeight: 1, color: 'var(--muted)' }}>×</button>
          </span>
        ))}
        {sel.length < MAX && libres.length > 0 && (
          <label><span className="sr-only">Agregar jugador</span>
            <select className="select comparar-agregar" style={{ height: 34, width: 200 }} value="" onChange={(e) => e.target.value && setSel([...sel, e.target.value])}>
              <option value="">+ Agregar jugador</option>
              {libres.map((j) => <option key={j.id} value={j.id}>{j.nombre}</option>)}
            </select>
          </label>
        )}
      </div>
      {metricas.length > 1 && (
        <div className="row" role="group" aria-label="Qué comparar" style={{ gap: 4 }}>
          {metricas.map((x) => <button key={x} type="button" className="chip" aria-pressed={x === m} onClick={() => setMetrica(x)}>{NOMBRE_COMP[x]}</button>)}
        </div>
      )}
      {sel.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>Agregá jugadores para verlos juntos en el mismo gráfico.</p>
      ) : (
        <>
          <GraficoComparado titulo={`${NOMBRE_COMP[m]} · ${AYUDA[m]}`} dias={dias} etiquetas={etiquetas} max={TOPE[m]} decimales={DEC[m]}
            series={sel.map((id, i) => ({ nombre: nombre(id), color: COLORES[i], valores: dias.map((f) => valor(id, f)) }))} />
          <div className="table-wrap">
            <table className="tbl" style={{ fontSize: 13 }}>
              <thead><tr><th />{dias.map((f) => { const d = desdeIso(f); return <th key={f} style={{ textAlign: 'center' }}>{d.getDate()}/{d.getMonth() + 1}</th>; })}</tr></thead>
              <tbody>
                {sel.map((id, i) => (
                  <tr key={id}>
                    <th scope="row" style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>
                      <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: COLORES[i], marginRight: 6 }} />{nombre(id)}
                    </th>
                    {dias.map((f) => { const v = valor(id, f); return <td key={f} style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }} className={v == null ? 'muted' : undefined}>{fmt(v, DEC[m])}</td>; })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="xs muted">«—» = no contestó ese día (no cuenta como cero).</span>
        </>
      )}
    </section>
  );
}

// Barras agrupadas por día: una barra por jugador, cada uno con su color.
export function GraficoComparado({ titulo, dias, series, max, decimales = 0, alto = 170, etiquetas }: {
  titulo: string; dias: string[]; series: { nombre: string; color: string; valores: (number | null)[] }[];
  max?: number; decimales?: number; alto?: number; etiquetas?: (string | null)[];
}) {
  const caja = useRef<HTMLDivElement>(null);
  const [ancho0, setAncho0] = useState(600);
  useEffect(() => {
    const el = caja.current; if (!el) return;
    const ro = new ResizeObserver(() => setAncho0(el.clientWidth || 600));
    ro.observe(el); setAncho0(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);
  const n = dias.length; const k = Math.max(series.length, 1);
  const W = Math.max(ancho0, n * (k * 7 + 6), 240); const H = alto; const pie = 30; const arriba = 10; const izq = 34;
  const cadaCuanto = n > 31 ? 7 : 1;
  const tope = max ?? Math.max(1, ...series.flatMap((s) => s.valores.map((v) => v ?? 0))) * 1.1;
  const y = (v: number) => arriba + (H - arriba - pie) * (1 - v / tope);
  const ancho = (W - izq) / Math.max(n, 1);
  const gap = ancho > 30 ? 6 : 2;
  const wb = Math.max((ancho - gap * 2) / k, 2);
  const r = Math.min(3, wb / 2);

  return (
    <figure style={{ margin: 0, minWidth: 0 }}>
      <figcaption className="small" style={{ fontWeight: 600, marginBottom: 4 }}>{titulo}</figcaption>
      <div className="row xs" style={{ gap: 12, marginBottom: 4 }}>
        {series.map((s) => <span key={s.nombre} className="row" style={{ gap: 4 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />{s.nombre}</span>)}
      </div>
      <div ref={caja} style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }} role="img" aria-label={titulo}>
          {[0, tope / 2, tope].map((mk) => (
            <g key={mk}>
              <line x1={izq} x2={W} y1={y(mk)} y2={y(mk)} stroke="#E4E1DA" strokeWidth={1} />
              <text x={izq - 6} y={y(mk) + 4} textAnchor="end" fontSize={10} fill="#6B6F78">{fmt(mk, decimales > 1 ? 1 : decimales)}</text>
            </g>
          ))}
          {dias.map((f, i) => {
            const d = desdeIso(f);
            return (
              <g key={f}>
                {series.map((s, si) => {
                  const v = s.valores[i];
                  const x = izq + ancho * i + gap + wb * si;
                  const w = Math.max(wb - 1, 1.5);
                  return (
                    <g key={s.nombre}>
                      <title>{`${d.getDate()}/${d.getMonth() + 1} · ${s.nombre}: ${v == null ? 'sin dato' : fmt(v, decimales)}`}</title>
                      <rect x={x} y={arriba} width={wb} height={H - arriba - pie} fill="transparent" />
                      {v != null
                        ? <path d={`M${x},${y(0)} V${Math.min(y(v) + r, y(0))} q0,-${r} ${r},-${r} H${x + w - r} q${r},0 ${r},${r} V${y(0)} Z`} fill={s.color} />
                        : <line x1={x + w / 2 - 2} x2={x + w / 2 + 2} y1={y(0) - 3} y2={y(0) - 3} stroke={s.color} strokeOpacity={0.45} strokeWidth={2} />}
                    </g>
                  );
                })}
                {i % cadaCuanto === 0 && <text x={izq + ancho * i + ancho / 2} y={H - 17} textAnchor="middle" fontSize={10} fill="#3F444D">{d.getDate()}/{d.getMonth() + 1}</text>}
                {cadaCuanto === 1 && etiquetas?.[i] && <text x={izq + ancho * i + ancho / 2} y={H - 5} textAnchor="middle" fontSize={8.5} fill="#6B6F78">{etiquetas[i]}</text>}
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
