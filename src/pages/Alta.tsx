import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase, mensajeError } from '../lib/supabase';
import { useSesion } from '../lib/sesion';

type Info = { club: string; rol: string; grupo: string | null };
type Paso = 'codigo' | 'datos' | 'listo';

const Atras = ({ onClick }: { onClick: () => void }) => (
  <button type="button" className="back" aria-label="Volver" onClick={onClick}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
  </button>
);

export default function Alta() {
  const { sesion, perfil, recargar, salir } = useSesion();
  const nav = useNavigate();
  const [paso, setPaso] = useState<Paso>('codigo');
  const [codigo, setCodigo] = useState('');
  const [info, setInfo] = useState<Info | null>(null);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [consiento, setConsiento] = useState(false);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  if (perfil && paso !== 'listo') return <Navigate to="/" replace />;
  const completando = !!sesion && !perfil; // tiene cuenta pero le falta canjear el código

  async function comprobar(e: FormEvent) {
    e.preventDefault();
    setError(''); setOcupado(true);
    const { data, error } = await supabase.rpc('ver_codigo', { p_codigo: codigo });
    setOcupado(false);
    if (error) { setError(mensajeError(error)); return; }
    const r = Array.isArray(data) ? data[0] : data;
    if (!r?.valido) { setError(r?.motivo ?? 'Código no válido.'); return; }
    setInfo({ club: r.club, rol: r.rol, grupo: r.grupo });
    setPaso('datos');
  }

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (!consiento) return;
    setError(''); setOcupado(true);
    try {
      if (!sesion) {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: clave, options: { data: { nombre } } });
        if (error) throw error;
        if (!data.session) {
          setError('Te enviamos un email para confirmar la cuenta. Ábrelo y luego vuelve a entrar con tu código.');
          setOcupado(false);
          return;
        }
      }
      const { error } = await supabase.rpc('canjear_codigo', { p_codigo: codigo, p_nombre: nombre });
      if (error) throw error;
      await recargar();
      setPaso('listo');
    } catch (err) {
      setError(mensajeError(err));
    }
    setOcupado(false);
  }

  if (paso === 'listo') {
    return (
      <div className="mobile-shell">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, textAlign: 'center' }}>
          <span style={{ width: 72, height: 72, borderRadius: 36, background: 'var(--ok-bg)', color: 'var(--ok-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
          </span>
          <h1 className="display" style={{ fontSize: 36 }}>¡Listo!</h1>
          <p className="muted" style={{ margin: 0 }}>Ya estás en {info?.club}.</p>
        </div>
        <button type="button" className="btn btn-primary btn-block" onClick={() => nav('/')}>Ir a la app</button>
      </div>
    );
  }

  if (paso === 'datos' && info) {
    return (
      <form className="mobile-shell" onSubmit={crear}>
        <Atras onClick={() => { setPaso('codigo'); setError(''); }} />
        <h1 className="display" style={{ fontSize: 36 }}>{completando ? 'Termina tu alta' : 'Crea tu cuenta'}</h1>
        <div className="card" role="status" style={{ padding: '12px 14px' }}>
          <strong style={{ display: 'block', fontSize: 15 }}>{info.club}</strong>
          <span className="small muted">Entras como {info.rol}{info.grupo ? ` · ${info.grupo}` : ''}</span>
        </div>
        <label className="field"><span>Nombre y apellido</span>
          <input className="input" autoComplete="name" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        {!completando && (
          <>
            <label className="field"><span>Email</span>
              <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field"><span>Contraseña</span>
              <input className="input" type="password" autoComplete="new-password" minLength={8} required placeholder="Mínimo 8 caracteres" value={clave} onChange={(e) => setClave(e.target.value)} />
            </label>
          </>
        )}
        <div className="card" style={{ padding: '12px 14px' }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.45, cursor: 'pointer' }}>
            <input type="checkbox" checked={consiento} onChange={(e) => setConsiento(e.target.checked)} style={{ width: 20, height: 20, flex: 'none', margin: 0, accentColor: '#16181D' }} />
            <span>Acepto que el club trate mis datos de salud (wellness, esfuerzo, carga y tests) para gestionar mi entrenamiento. Los ve el staff deportivo y médico, y la dirección del club ve mi wellness.</span>
          </label>
        </div>
        {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <div className="spacer" />
        <button className="btn btn-primary btn-block" type="submit" disabled={!consiento || ocupado}>{ocupado ? 'Creando…' : completando ? 'Terminar alta' : 'Crear cuenta'}</button>
      </form>
    );
  }

  return (
    <form className="mobile-shell" onSubmit={comprobar}>
      <Link to="/entrar" className="back" aria-label="Volver">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </Link>
      <h1 className="display" style={{ fontSize: 36 }}>Escribe tu código</h1>
      {completando && (
        <p className="notice notice-warn" style={{ margin: 0 }}>
          Tu cuenta ya existe pero falta el código del club. <button type="button" className="btn-ghost" style={{ padding: 0, textDecoration: 'underline', color: 'inherit' }} onClick={salir}>Usar otra cuenta</button>
        </p>
      )}
      <label className="field"><span>Código</span>
        <input className="input input-lg" autoComplete="one-time-code" required value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} />
      </label>
      {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div className="spacer" />
      <button className="btn btn-primary btn-block" type="submit" disabled={ocupado || !codigo.trim()}>{ocupado ? 'Comprobando…' : 'Continuar'}</button>
    </form>
  );
}
