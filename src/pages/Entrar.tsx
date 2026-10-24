import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase, mensajeError } from '../lib/supabase';
import { useSesion } from '../lib/sesion';

export default function Entrar() {
  const { sesion, perfil, recargar } = useSesion();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (sesion && perfil) return <Navigate to="/" replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(''); setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave });
    setEnviando(false);
    if (error) { setError(mensajeError(error)); return; }
    await recargar();
    nav('/');
  }

  return (
    <div className="mobile-shell">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', margin: '32px 0 12px' }}>
        <div className="logo-box" aria-hidden="true">SP</div>
        <h1 className="display" style={{ fontSize: 40 }}>Sports Performance</h1>
        <p className="muted" style={{ margin: 0 }}>Tu entorno deportivo, en un solo lugar.</p>
      </div>
      <form className="stack" onSubmit={enviar}>
        <label className="field"><span>Email</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field"><span>Contraseña</span>
          <input className="input" type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
        {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button className="btn btn-dark btn-block" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Iniciar sesión'}</button>
      </form>
      <Link to="/alta" className="btn btn-primary btn-block">Tengo un código</Link>
    </div>
  );
}
