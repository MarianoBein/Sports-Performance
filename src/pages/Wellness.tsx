import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, mensajeError } from '../lib/supabase';
import { COLORES_5, PREGUNTAS, TEXTO_5, bienDe, type Pregunta } from '../lib/wellness';
import { hoyIso } from '../lib/calendario';
import { useSesion } from '../lib/sesion';

type Valores = Record<Pregunta['clave'], number | null>;

export default function Wellness() {
  const { perfil } = useSesion();
  const nav = useNavigate();
  const [v, setV] = useState<Valores>({ sueno: null, fatiga: null, estres: null, dolor: null });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Si ya contestó hoy, se cargan sus respuestas para poder corregirlas.
  useEffect(() => {
    if (!perfil) return;
    supabase.from('wellness').select('sueno,fatiga,estres,dolor').eq('perfil_id', perfil.id).eq('fecha', hoyIso()).maybeSingle()
      .then(({ data }) => {
        if (data) setV({ sueno: bienDe('sueno', data.sueno), fatiga: bienDe('fatiga', data.fatiga), estres: bienDe('estres', data.estres), dolor: bienDe('dolor', data.dolor) });
      });
  }, [perfil]);

  const completo = PREGUNTAS.every((p) => v[p.clave] !== null);

  async function enviar() {
    if (!completo) return;
    setEnviando(true); setError('');
    const { error } = await supabase.rpc('guardar_wellness', { p_sueno: v.sueno, p_fatiga: v.fatiga, p_estres: v.estres, p_dolor: v.dolor });
    setEnviando(false);
    if (error) { setError(mensajeError(error)); return; }
    nav('/', { replace: true });
  }

  return (
    <div className="stack" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div>
        <h1 className="display" style={{ fontSize: 36 }}>¿Cómo llegas hoy?</h1>
        <p className="muted small" style={{ margin: '6px 0 0' }}>Cuatro respuestas. En todas, 5 es lo mejor.</p>
      </div>
      {PREGUNTAS.map((p) => {
        const sel = v[p.clave];
        return (
          <fieldset key={p.clave} className="card" style={{ margin: 0, border: 0, padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <legend style={{ float: 'left', padding: 0, fontSize: 16, fontWeight: 600 }}>
              {p.titulo}{p.ayuda && <span className="xs muted" style={{ fontWeight: 400 }}> · {p.ayuda}</span>}
            </legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 6 }}>
              {[1, 2, 3, 4, 5].map((n) => {
                const on = sel === n;
                return (
                  <button key={n} type="button" aria-pressed={on} aria-label={`${n}: ${p.frases[n - 1]}`} onClick={() => setV({ ...v, [p.clave]: n })}
                    style={{ height: 52, borderRadius: 12, fontSize: 18, fontWeight: 700, border: on ? `3px solid ${COLORES_5[n - 1]}` : '1.5px solid var(--field)',
                      background: on ? COLORES_5[n - 1] : `${COLORES_5[n - 1]}1F`, color: on ? TEXTO_5[n - 1] : 'var(--ink)', transform: on ? 'scale(1.04)' : undefined }}>
                    {n}
                  </button>
                );
              })}
            </div>
            <div style={{ minHeight: 22, textAlign: 'center', fontSize: 15, fontWeight: 600, color: sel ? 'var(--ink)' : 'var(--muted)' }}>
              {sel ? p.frases[sel - 1] : 'Toca un número'}
            </div>
            <div className="row xs muted" style={{ justifyContent: 'space-between' }}>
              <span>1 · {p.frases[0]}</span><span>5 · {p.frases[4]}</span>
            </div>
          </fieldset>
        );
      })}
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button type="button" className="btn btn-primary btn-block" disabled={!completo || enviando} onClick={enviar}>
        {enviando ? 'Enviando…' : completo ? 'Enviar' : 'Responde las cuatro'}
      </button>
    </div>
  );
}
