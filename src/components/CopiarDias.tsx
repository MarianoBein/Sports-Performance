import { useState } from 'react';
import Dialogo from './Dialogo';
import { desdeIso, iso, sumarDias } from '../lib/calendario';

// Ventana para copiar días completos (uno o un rango) y pegarlos en otro día o en un rango.
// Si el destino es un rango, lo copiado se repite: por ejemplo, una semana copiada en un mes entero.
export type Copia = { pares: [string, string][]; opciones: Record<string, boolean> };
type Opcion = { clave: string; texto: string; ayuda?: string; def: boolean };

const MAX_ORIGEN = 62, MAX_DESTINO = 120;
const entre = (a: string, b: string) => {
  const out: string[] = [];
  for (let d = desdeIso(a); iso(d) <= b && out.length <= 400; d = sumarDias(d, 1)) out.push(iso(d));
  return out;
};
const ddmm = (f: string) => { const d = desdeIso(f); return `${d.getDate()}/${d.getMonth() + 1}`; };

function Modo({ id, valor, onCambio }: { id: string; valor: 'uno' | 'rango'; onCambio: (v: 'uno' | 'rango') => void }) {
  return (
    <div id={id} className="row" role="radiogroup" style={{ gap: 4 }}>
      <button type="button" role="radio" className="chip" aria-checked={valor === 'uno'} aria-pressed={valor === 'uno'} onClick={() => onCambio('uno')}>Un día</button>
      <button type="button" role="radio" className="chip" aria-checked={valor === 'rango'} aria-pressed={valor === 'rango'} onClick={() => onCambio('rango')}>Rango de fechas</button>
    </div>
  );
}

export default function CopiarDias({ titulo, inicio, opciones, nota, onCerrar, onCopiar }: {
  titulo: string; inicio: string; opciones: Opcion[]; nota?: string;
  onCerrar: () => void; onCopiar: (c: Copia) => Promise<string>;
}) {
  const [modoDe, setModoDe] = useState<'uno' | 'rango'>('uno');
  const [de1, setDe1] = useState(inicio);
  const [de2, setDe2] = useState(iso(sumarDias(desdeIso(inicio), 6)));
  const [modoA, setModoA] = useState<'uno' | 'rango'>('uno');
  const [a1, setA1] = useState(iso(sumarDias(desdeIso(inicio), 7)));
  const [a2, setA2] = useState(iso(sumarDias(desdeIso(inicio), 13)));
  const [ops, setOps] = useState<Record<string, boolean>>(() => Object.fromEntries(opciones.map((o) => [o.clave, o.def])));
  const [error, setError] = useState('');
  const [copiando, setCopiando] = useState(false);

  const origen = modoDe === 'uno' ? [de1] : de2 >= de1 ? entre(de1, de2) : [];
  let destino: string[] = [];
  if (origen.length) destino = modoA === 'uno' ? origen.map((_, i) => iso(sumarDias(desdeIso(a1), i))) : a2 >= a1 ? entre(a1, a2) : [];
  const pares: [string, string][] = destino.map((d, i) => [origen[i % origen.length], d]);
  const pisa = pares.some(([, d]) => origen.includes(d));
  const problema = !origen.length ? 'La fecha «hasta» del origen tiene que ser después de la de «desde».'
    : origen.length > MAX_ORIGEN ? `Copiá como mucho ${MAX_ORIGEN} días por vez.`
      : !destino.length ? 'La fecha «hasta» del destino tiene que ser después de la de «desde».'
        : destino.length > MAX_DESTINO ? `Pegá como mucho en ${MAX_DESTINO} días por vez.`
          : pisa ? 'El destino se superpone con lo que copiás: elegí otras fechas.' : '';

  async function copiar() {
    if (problema) { setError(problema); return; }
    setCopiando(true); setError('');
    const e = await onCopiar({ pares, opciones: ops });
    setCopiando(false);
    if (e) setError(e);
  }

  const resumen = !problema && (modoA === 'rango' && origen.length > 1
    ? `Se repiten los ${origen.length} días copiados del ${ddmm(destino[0])} al ${ddmm(destino[destino.length - 1])}.`
    : modoA === 'rango' ? `El ${ddmm(origen[0])} se pega en cada día del ${ddmm(destino[0])} al ${ddmm(destino[destino.length - 1])}.`
      : origen.length > 1 ? `Se pegan del ${ddmm(destino[0])} al ${ddmm(destino[destino.length - 1])}, en el mismo orden.` : '');

  return (
    <Dialogo titulo={titulo} ancho={560} onCerrar={onCerrar}
      pie={<><button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
        <button id="copiar-dias-ok" type="button" className="btn btn-primary" disabled={copiando || !!problema} onClick={copiar}>
          {copiando ? 'Copiando…' : `Copiar a ${destino.length || 0} día${destino.length === 1 ? '' : 's'}`}
        </button></>}>
      <div className="stack" style={{ gap: 6 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}><strong>Copiar</strong><Modo id="copiar-modo-de" valor={modoDe} onCambio={setModoDe} /></div>
        <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ flex: '1 1 160px' }}><span>{modoDe === 'uno' ? 'Día' : 'Desde'}</span><input id="copiar-de1" className="input" type="date" value={de1} onChange={(e) => e.target.value && setDe1(e.target.value)} /></label>
          {modoDe === 'rango' && <label className="field" style={{ flex: '1 1 160px' }}><span>Hasta</span><input id="copiar-de2" className="input" type="date" value={de2} min={de1} onChange={(e) => e.target.value && setDe2(e.target.value)} /></label>}
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}><strong>Pegar en</strong><Modo id="copiar-modo-a" valor={modoA} onCambio={setModoA} /></div>
        <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ flex: '1 1 160px' }}><span>{modoA === 'uno' ? (origen.length > 1 ? 'Desde el día' : 'Día') : 'Desde'}</span><input id="copiar-a1" className="input" type="date" value={a1} onChange={(e) => e.target.value && setA1(e.target.value)} /></label>
          {modoA === 'rango' && <label className="field" style={{ flex: '1 1 160px' }}><span>Hasta</span><input id="copiar-a2" className="input" type="date" value={a2} min={a1} onChange={(e) => e.target.value && setA2(e.target.value)} /></label>}
        </div>
        {resumen && <span className="xs muted">{resumen}</span>}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <strong>Opciones</strong>
        {opciones.map((o) => (
          <label key={o.clave} className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input id={`copiar-op-${o.clave}`} type="checkbox" checked={!!ops[o.clave]} onChange={(e) => setOps({ ...ops, [o.clave]: e.target.checked })} style={{ marginTop: 3 }} />
            <span>{o.texto}{o.ayuda && <span className="xs muted" style={{ display: 'block' }}>{o.ayuda}</span>}</span>
          </label>
        ))}
        {nota && <span className="xs muted">{nota}</span>}
      </div>
      {(error || problema) && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error || problema}</p>}
    </Dialogo>
  );
}
