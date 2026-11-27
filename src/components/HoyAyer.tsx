import { desdeIso, hoyIso, iso, sumarDias, DIAS, diaSemana } from '../lib/calendario';

// Wellness y RPE: el jugador puede cargar o corregir lo de hoy y lo de ayer.
export const ayerIso = () => iso(sumarDias(desdeIso(hoyIso()), -1));
export type Dia = 'hoy' | 'ayer';
export const fechaDe = (d: Dia) => (d === 'hoy' ? hoyIso() : ayerIso());

export default function HoyAyer({ dia, onCambio, disabled }: { dia: Dia; onCambio: (d: Dia) => void; disabled?: boolean }) {
  const ayer = desdeIso(ayerIso());
  return (
    <div className="row" role="group" aria-label="Qué día" style={{ gap: 6 }}>
      <button type="button" className="chip" aria-pressed={dia === 'hoy'} disabled={disabled} onClick={() => onCambio('hoy')}>Hoy</button>
      <button type="button" className="chip" aria-pressed={dia === 'ayer'} disabled={disabled} onClick={() => onCambio('ayer')}>Ayer · {DIAS[diaSemana(ayer)].toLowerCase()} {ayer.getDate()}</button>
    </div>
  );
}

// Si falta la función nueva (032 sin pegar), se reintenta sin la fecha cuando es de hoy.
export const faltaFuncionNueva = (m: string) => /p_fecha|function|función|schema cache/i.test(m);
