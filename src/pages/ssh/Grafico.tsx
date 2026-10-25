import { useEffect, useRef, useState } from 'react';
import { desdeIso } from '../../lib/calendario';
import { TONOS, fmt, type Tono } from '../../lib/carga';

type Punto = { fecha: string; valor: number | null; tono?: Tono | null; nota?: string };

// Barras por día (un solo eje) con una línea de referencia opcional (media móvil).
// Un día sin dato queda vacío, con una marca chica: nunca se dibuja como cero.
export default function Grafico({ titulo, puntos, linea, lineaNombre, max, decimales = 0, alto = 150, etiquetas }: {
  titulo: string; puntos: Punto[]; linea?: (number | null)[]; lineaNombre?: string; max?: number; decimales?: number; alto?: number;
  etiquetas?: (string | null)[];
}) {
  const caja = useRef<HTMLDivElement>(null);
  const [ancho0, setAncho0] = useState(600);
  useEffect(() => {
    const el = caja.current; if (!el) return;
    const ro = new ResizeObserver(() => setAncho0(el.clientWidth || 600));
    ro.observe(el); setAncho0(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);
  const n = puntos.length;
  const W = Math.max(ancho0, n * 8, 240); const H = alto; const pie = 30; const arriba = 10; const izq = 34;
  const cadaCuanto = n > 31 ? 7 : 1; // con muchos días, una etiqueta por semana const pie = 30; const arriba = 10; const izq = 34;
  const valores = [...puntos.map((p) => p.valor ?? 0), ...(linea ?? []).map((v) => v ?? 0)];
  const tope = max ?? (Math.max(1, ...valores) * 1.1);
  const y = (v: number) => arriba + (H - arriba - pie) * (1 - v / tope);
  const ancho = (W - izq) / Math.max(n, 1);
  const marcas = [0, tope / 2, tope];
  const camino = (linea ?? []).map((v, i) => (v == null ? null : `${izq + ancho * i + ancho / 2},${y(v)}`));
  const segmentos: string[][] = []; let actual: string[] = [];
  for (const c of camino) { if (c) actual.push(c); else if (actual.length) { segmentos.push(actual); actual = []; } }
  if (actual.length) segmentos.push(actual);

  return (
    <figure style={{ margin: 0, minWidth: 0 }}>
      <figcaption className="small" style={{ fontWeight: 600, marginBottom: 4 }}>
        {titulo}
        {linea && lineaNombre && <span className="xs muted" style={{ fontWeight: 400 }}> · <span aria-hidden="true" style={{ display: 'inline-block', width: 14, borderTop: '2px solid #3F444D', verticalAlign: 'middle' }} /> {lineaNombre}</span>}
      </figcaption>
      <div ref={caja} style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }} role="img" aria-label={titulo}>
          {marcas.map((m) => (
            <g key={m}>
              <line x1={izq} x2={W} y1={y(m)} y2={y(m)} stroke="#E4E1DA" strokeWidth={1} />
              <text x={izq - 6} y={y(m) + 4} textAnchor="end" fontSize={10} fill="#6B6F78">{fmt(m, decimales)}</text>
            </g>
          ))}
          {puntos.map((p, i) => {
            const gap = ancho > 14 ? 3 : 1;
            const x = izq + ancho * i + gap; const w = Math.max(ancho - gap * 2, 2);
            const r = Math.min(4, w / 2);
            const d = desdeIso(p.fecha);
            const color = p.tono ? (p.tono === 'rojo' ? '#D6192F' : p.tono === 'azul' ? '#1D5BD8' : '#1E9E4A') : '#9A9DA4';
            return (
              <g key={p.fecha}>
                <title>{`${d.getDate()}/${d.getMonth() + 1}${etiquetas?.[i] ? ` · ${etiquetas[i]}` : ''}: ${p.valor == null ? 'sin dato' : fmt(p.valor, decimales)}${linea?.[i] != null ? ` · ${lineaNombre ?? 'referencia'} ${fmt(linea[i], decimales)}` : ''}${p.tono ? ` · ${TONOS[p.tono].nombre}` : ''}${p.nota ? ` · ${p.nota}` : ''}`}</title>
                <rect x={izq + ancho * i} y={arriba} width={ancho} height={H - arriba - pie} fill="transparent" />
                {p.valor != null ? (
                  <path d={`M${x},${y(0)} V${Math.min(y(p.valor) + r, y(0))} q0,-${r} ${r},-${r} H${x + w - r} q${r},0 ${r},${r} V${y(0)} Z`} fill={color} />
                ) : (
                  <line x1={x + w / 2 - 3} x2={x + w / 2 + 3} y1={y(0) - 3} y2={y(0) - 3} stroke="#C9C6BF" strokeWidth={2} />
                )}
                {i % cadaCuanto === 0 && <text x={izq + ancho * i + ancho / 2} y={H - 17} textAnchor="middle" fontSize={10} fill="#3F444D">{d.getDate()}/{d.getMonth() + 1}</text>}
                {cadaCuanto === 1 && etiquetas?.[i] && <text x={izq + ancho * i + ancho / 2} y={H - 5} textAnchor="middle" fontSize={8.5} fill="#6B6F78">{etiquetas[i]}</text>}
              </g>
            );
          })}
          {segmentos.map((s, i) => s.length > 1
            ? <polyline key={i} points={s.join(' ')} fill="none" stroke="#3F444D" strokeWidth={2} strokeLinejoin="round" />
            : <circle key={i} cx={Number(s[0].split(',')[0])} cy={Number(s[0].split(',')[1])} r={2.5} fill="#3F444D" />)}
        </svg>
      </div>
    </figure>
  );
}
