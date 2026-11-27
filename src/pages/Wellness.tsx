import { useCallback, useEffect, useRef, useState } from 'react';
import Gracias from '../components/Gracias';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, mensajeError } from '../lib/supabase';
import { COLORES_5, PREGUNTAS, TEXTO_5, bienDe, type Pregunta } from '../lib/wellness';
import HoyAyer, { faltaFuncionNueva, fechaDe, type Dia } from '../components/HoyAyer';
import { useSesion } from '../lib/sesion';

type Valores = Record<Pregunta['clave'], number | null>;

export default function Wellness() {
  const { perfil } = useSesion();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const volver = params.get('volver');
  const destino = volver && /^\/[a-z-]*$/.test(volver) ? volver : '/';
  const [dia, setDia] = useState<Dia>(params.get('dia') === 'ayer' ? 'ayer' : 'hoy');
  const [v, setV] = useState<Valores>({ sueno: null, fatiga: null, estres: null, dolor: null });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const espera = useRef<number | null>(null);
  useEffect(() => () => { if (espera.current) window.clearTimeout(espera.current); }, []);

  // Si ya contestó hoy, se cargan sus respuestas para poder corregirlas.
  useEffect(() => {
    if (!perfil) return;
    setV({ sueno: null, fatiga: null, estres: null, dolor: null });
    supabase.from('wellness').select('sueno,fatiga,estres,dolor').eq('perfil_id', perfil.id).eq('fecha', fechaDe(dia)).maybeSingle()
      .then(({ data }) => {
        if (data) setV({ sueno: bienDe('sueno', data.sueno), fatiga: bienDe('fatiga', data.fatiga), estres: bienDe('estres', data.estres), dolor: bienDe('dolor', data.dolor) });
      });
  }, [perfil, dia]);

  const completo = PREGUNTAS.every((p) => v[p.clave] !== null);

  // Cuando están las cuatro respuestas, se guarda solo (con una pausa por si cambia otra al toque).
  async function enviar(x: Valores) {
    setEnviando(true); setError('');
    const base = { p_sueno: x.sueno, p_fatiga: x.fatiga, p_estres: x.estres, p_dolor: x.dolor };
    let { error } = await supabase.rpc('guardar_wellness', { ...base, p_fecha: fechaDe(dia) });
    if (error && dia === 'hoy' && faltaFuncionNueva(error.message)) ({ error } = await supabase.rpc('guardar_wellness', base));
    setEnviando(false);
    if (error) { setError(mensajeError(error)); return; }
    setListo(true);
  }
  function elegir(clave: Pregunta['clave'], n: number) {
    const x = { ...v, [clave]: n };
    setV(x);
    if (espera.current) window.clearTimeout(espera.current);
    if (PREGUNTAS.every((p) => x[p.clave] !== null)) espera.current = window.setTimeout(() => { void enviar(x); }, 1200);
  }
  const cerrar = useCallback(() => nav(destino, { replace: true }), [nav, destino]);
  if (listo) return <Gracias titulo="¡Gracias!" detalle={`Tu wellness de ${dia} quedó guardado. Si te equivocaste, volvé a entrar y cambiá la respuesta.`} onCerrar={cerrar} />;

  return (
    <div className="stack" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div>
        <h1 className="display" style={{ fontSize: 36 }}>{dia === 'hoy' ? '¿Cómo llegas hoy?' : '¿Cómo llegaste ayer?'}</h1>
        <p className="muted small" style={{ margin: '6px 0 0' }}>Cuatro respuestas. En todas, 5 es lo mejor.</p>
      </div>
      <HoyAyer dia={dia} onCambio={(d) => { if (espera.current) window.clearTimeout(espera.current); setDia(d); }} disabled={enviando} />
      {PREGUNTAS.map((p) => {
        const sel = v[p.clave];
        return (
          <fieldset key={p.clave} className="card" style={{ margin: 0, border: 0, padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <legend style={{ float: 'left', padding: 0, fontSize: 16, fontWeight: 600 }}>
              {p.titulo}{p.ayuda && <span className="xs muted" style={{ fontWeight: 400 }}> · {p.ayuda}</span>}
            </legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 4 }}>
              {[1, 2, 3, 4, 5].map((n) => {
                const on = sel === n;
                return (
                  <button key={n} type="button" aria-pressed={on} aria-label={`${n}: ${p.frases[n - 1]}`} disabled={enviando} onClick={() => elegir(p.clave, n)}
                    style={{ minHeight: 84, padding: '6px 1px', borderRadius: 12, border: on ? `3px solid ${COLORES_5[n - 1]}` : '1.5px solid var(--field)', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 3,
                      background: on ? COLORES_5[n - 1] : `${COLORES_5[n - 1]}1F`, color: on ? TEXTO_5[n - 1] : 'var(--ink)', transform: on ? 'scale(1.04)' : undefined }}>
                    <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>{n}</span>
                    <span style={{ fontSize: 'clamp(8px, 2.45vw, 12px)', fontWeight: 600, lineHeight: 1.15, textAlign: 'center', letterSpacing: '-0.02em', overflowWrap: 'normal', maxWidth: '100%' }}>{p.frases[n - 1]}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <p className="xs muted" style={{ margin: 0, textAlign: 'center' }}>{enviando ? 'Guardando…' : completo ? 'Se guarda solo.' : 'Respondé las cuatro: se guarda solo.'}</p>
    </div>
  );
}
