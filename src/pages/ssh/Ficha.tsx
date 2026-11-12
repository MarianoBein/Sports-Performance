import { useEffect, useState } from 'react';
import { supabase, mensajeError } from '../../lib/supabase';
import { desdeIso, fechaLarga, hoyIso, iso, sumarDias } from '../../lib/calendario';
import { PillEstado, usePartes } from './Fisio';

// Ficha del jugador: entrenamientos de campo, partidos, sesiones de pesas, faltas e historial de partes de fisio.
type Ficha = {
  campo: number; partidos: number; faltas: number; pesas: number;
  dias: { fecha: string; partido: boolean; falto: boolean; nombre: string }[];
  dias_pesas: { fecha: string; hechos: number; total: number }[];
};
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const ddmm = (f: string) => { const d = desdeIso(f); return `${d.getDate()}/${d.getMonth() + 1}`; };
// La temporada arranca el 1 de agosto
const inicioTemporada = (hoy: string) => { const d = desdeIso(hoy); const a = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1; return `${a}-08-01`; };

export default function FichaJugador({ perfil }: { perfil: string }) {
  const hoy = hoyIso();
  const [periodo, setPeriodo] = useState<'temporada' | '30' | '90'>('temporada');
  const desde = periodo === 'temporada' ? inicioTemporada(hoy) : iso(sumarDias(desdeIso(hoy), -Number(periodo) + 1));
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [error, setError] = useState('');
  const { lista: partes } = usePartes('2000-01-01', perfil);   // historial completo de partes
  const [verTodo, setVerTodo] = useState(false);

  useEffect(() => {
    setFicha(null);
    supabase.rpc('ficha_jugador', { p_perfil: perfil, p_desde: desde, p_hasta: hoy }).then(({ data, error }) => {
      if (error) setError(mensajeError(error)); else { setError(''); setFicha(data as Ficha); }
    });
  }, [perfil, desde, hoy]);

  const tarjetas: [string, number | undefined, string][] = [
    ['Entrenamientos de campo', ficha?.campo, 'según el calendario y la asistencia'],
    ['Sesiones de pesas', ficha?.pesas, 'días con el entreno completado'],
    ['Partidos', ficha?.partidos, ''],
    ['Faltas', ficha?.faltas, 'días que no vino'],
  ];
  const ultimos = [
    ...(ficha?.dias ?? []).map((d) => ({ fecha: d.fecha, txt: d.nombre, tipo: d.falto ? 'falta' : d.partido ? 'partido' : 'campo' })),
    ...(ficha?.dias_pesas ?? []).map((d) => ({ fecha: d.fecha, txt: `Pesas · ${d.hechos} de ${d.total} ejercicios`, tipo: 'pesas' })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const COLOR: Record<string, string> = { campo: '#1D5BD8', pesas: '#2A9D8F', partido: '#9B3FB5', falta: '#8E1022' };

  return (
    <section className="card ficha-jugador" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 16 }}>Ficha</strong>
        <div className="row" role="group" aria-label="Período" style={{ gap: 4 }}>
          {([['temporada', 'Temporada'], ['30', '30 días'], ['90', '90 días']] as const).map(([k, t]) => (
            <button key={k} type="button" className="chip" aria-pressed={periodo === k} onClick={() => setPeriodo(k)}>{t}</button>
          ))}
        </div>
      </div>
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {tarjetas.map(([t, v, s]) => (
          <div key={t} style={{ padding: 12, borderRadius: 10, background: 'var(--bg)', textAlign: 'center' }}>
            <div className="small muted" style={{ fontWeight: 600 }}>{t}</div>
            <div className="display" style={{ fontSize: 30 }}>{v ?? '…'}</div>
            {s && <div className="xs muted">{s}</div>}
          </div>
        ))}
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <strong className="small">Partes de fisio y lesiones</strong>
        {!partes ? <span className="small muted">Cargando…</span> : !partes.length ? <span className="small muted">Sin partes cargados.</span> : (
          <>
            {(verTodo ? partes : partes.slice(0, 5)).map((p) => (
              <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line-soft)' }}>
                <span className="small"><strong>{cap(fechaLarga(p.fecha))}</strong> · {p.motivo}</span>
                <div className="row" style={{ gap: 6 }}>
                  <PillEstado que="Entrena" estado={p.entrena} /><PillEstado que="Pesas" estado={p.pesas} />
                  {p.fecha_rechequeo && <span className="xs muted">Rechequeo {ddmm(p.fecha_rechequeo)}</span>}
                  {p.restricciones && <span className="xs muted">· {p.restricciones}</span>}
                </div>
              </div>
            ))}
            {partes.length > 5 && <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setVerTodo(!verTodo)}>{verTodo ? 'Ver menos' : `Ver los ${partes.length}`}</button>}
          </>
        )}
      </div>

      {ultimos.length > 0 && (
        <details>
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Día por día ({ultimos.length})</summary>
          <div className="stack" style={{ gap: 2, marginTop: 6, maxHeight: 280, overflowY: 'auto' }}>
            {ultimos.map((u, i) => (
              <div key={i} className="row small" style={{ gap: 8, flexWrap: 'nowrap' }}>
                <span style={{ width: 44, fontVariantNumeric: 'tabular-nums' }}>{ddmm(u.fecha)}</span>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: COLOR[u.tipo], flex: 'none' }} />
                <span style={{ textDecoration: u.tipo === 'falta' ? 'line-through' : undefined }}>{u.txt}{u.tipo === 'falta' ? ' (no vino)' : ''}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
