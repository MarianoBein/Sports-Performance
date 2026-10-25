import { useState, type FormEvent } from 'react';
import { supabase, mensajeError } from '../lib/supabase';
import { useSesion } from '../lib/sesion';

// Después de entrar con una clave temporal, la persona elige la suya.
export default function CambiarClave() {
  const { perfil, recargar, salir } = useSesion();
  const [clave, setClave] = useState('');
  const [repetir, setRepetir] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (clave.length < 8) { setError('La contraseña tiene que tener al menos 8 caracteres.'); return; }
    if (clave !== repetir) { setError('Las dos contraseñas no coinciden.'); return; }
    setEnviando(true);
    const { error } = await supabase.auth.updateUser({ password: clave });
    if (error) { setEnviando(false); setError(mensajeError(error)); return; }
    const r = await supabase.rpc('clave_cambiada');
    setEnviando(false);
    if (r.error) { setError(mensajeError(r.error)); return; }
    await recargar();
  }

  return (
    <div className="mobile-shell">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '32px 0 16px' }}>
        <h1 className="display" style={{ fontSize: 34 }}>Elegí tu contraseña</h1>
        <p className="muted" style={{ margin: 0 }}>{perfil?.nombre ? `${perfil.nombre}, entraste` : 'Entraste'} con una contraseña temporal. Elegí una nueva para seguir.</p>
      </div>
      <form className="stack" onSubmit={enviar}>
        <label className="field"><span>Contraseña nueva</span>
          <input id="clave-nueva" className="input" type="password" autoComplete="new-password" required minLength={8} value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
        <label className="field"><span>Repetila</span>
          <input id="clave-repetir" className="input" type="password" autoComplete="new-password" required value={repetir} onChange={(e) => setRepetir(e.target.value)} />
        </label>
        <span className="xs muted">Al menos 8 caracteres.</span>
        {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar y entrar'}</button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => salir()}>Salir</button>
      </form>
    </div>
  );
}
