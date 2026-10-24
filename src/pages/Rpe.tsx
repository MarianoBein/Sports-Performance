import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, mensajeError } from '../lib/supabase';
import { RPE } from '../lib/wellness';
import { hoyIso } from '../lib/calendario';
import { useSesion } from '../lib/sesion';

export default function Rpe() {
  const { perfil } = useSesion();
  const nav = useNavigate();
  const [valor, setValor] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!perfil) return;
    supabase.from('rpe').select('valor').eq('perfil_id', perfil.id).eq('fecha', hoyIso()).maybeSingle()
      .then(({ data }) => { if (data) setValor(data.valor); });
  }, [perfil]);

  async function enviar() {
    if (!valor) return;
    setEnviando(true); setError('');
    const { error } = await supabase.rpc('guardar_rpe', { p_valor: valor });
    setEnviando(false);
    if (error) { setError(mensajeError(error)); return; }
    nav('/', { replace: true });
  }

  return (
    <div className="stack" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div>
        <h1 className="display" style={{ fontSize: 36 }}>¿Qué tan duro fue hoy?</h1>
        <p className="muted small" style={{ margin: '6px 0 0' }}>Piensa en todo el trabajo del día: fuerza y pista.</p>
      </div>
      <div role="radiogroup" aria-label="Esfuerzo del 1 al 10" className="card" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {RPE.map((r) => {
          const on = valor === r.valor;
          return (
            <button key={r.valor} type="button" role="radio" aria-checked={on} onClick={() => setValor(r.valor)}
              style={{ minHeight: 48, borderRadius: 10, border: on ? '3px solid var(--ink)' : '0', display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px',
                background: r.color, color: r.texto, opacity: valor && !on ? 0.55 : 1, textAlign: 'left' }}>
              <span className="display" style={{ fontSize: 26, width: 30 }}>{r.valor}</span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{r.frase}</span>
              {on && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>}
            </button>
          );
        })}
      </div>
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button type="button" className="btn btn-primary btn-block" disabled={!valor || enviando} onClick={enviar}>
        {enviando ? 'Enviando…' : 'Enviar'}
      </button>
    </div>
  );
}
