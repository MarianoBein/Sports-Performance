import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSesion } from '../lib/sesion';
import { mensajeError, supabase } from '../lib/supabase';
import Dialogo from './Dialogo';

// Nombre de la organización arriba a la izquierda. Al tocarlo: cambiar a otra
// organización de la misma cuenta o unirse a una nueva con un código.
export default function MenuOrganizacion() {
  const { perfil, organizaciones, cambiarOrganizacion } = useSesion();
  const [abierto, setAbierto] = useState(false);
  const [unirme, setUnirme] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  const otras = organizaciones.filter((o) => o.perfil_id !== perfil?.id);

  return (
    <div className="org-menu" ref={ref}>
      <button type="button" className="brand org-boton" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
        {perfil?.club.nombre ?? 'Sports Performance'}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {abierto && (
        <div className="org-lista" role="menu">
          <div className="org-titulo">Estás en</div>
          <div className="org-item actual">
            <strong>{perfil?.club.nombre}</strong>
            <span>{perfil?.rol.nombre}{perfil?.es_admin ? ' · admin' : ''}</span>
          </div>
          {otras.length > 0 && <div className="org-titulo">Cambiar a</div>}
          {otras.map((o) => (
            <button key={o.perfil_id} type="button" role="menuitem" className="org-item"
              onClick={async () => { setError(''); try { await cambiarOrganizacion(o.perfil_id); } catch (e) { setError(mensajeError(e)); } }}>
              <strong>{o.club}</strong>
              <span>{o.rol}{o.es_admin ? ' · admin' : ''}</span>
            </button>
          ))}
          {error && <div className="org-error">{error}</div>}
          <button type="button" role="menuitem" className="org-item org-unirme" onClick={() => { setAbierto(false); setUnirme(true); }}>
            + Unirme a otra organización con un código
          </button>
        </div>
      )}
      {unirme && createPortal(<Unirme onCerrar={() => setUnirme(false)} />, document.body)}
    </div>
  );
}

function Unirme({ onCerrar }: { onCerrar: () => void }) {
  const { perfil } = useSesion();
  const [codigo, setCodigo] = useState('');
  const [info, setInfo] = useState<{ club: string; rol: string; grupo: string | null } | null>(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function revisar() {
    setError(''); setOcupado(true);
    const { data, error: e } = await supabase.rpc('ver_codigo', { p_codigo: codigo });
    setOcupado(false);
    if (e) { setError(mensajeError(e)); return; }
    const r = Array.isArray(data) ? data[0] : data;
    if (!r?.valido) { setError(r?.motivo ?? 'Código no válido.'); return; }
    setInfo({ club: r.club, rol: r.rol, grupo: r.grupo });
  }

  async function confirmar() {
    setError(''); setOcupado(true);
    const { error: e } = await supabase.rpc('canjear_codigo', { p_codigo: codigo, p_nombre: perfil?.nombre ?? '' });
    if (e) { setOcupado(false); setError(mensajeError(e)); return; }
    window.location.assign('/');   // entra directo a la organización nueva
  }

  return (
    <Dialogo titulo="Unirme a otra organización" ancho={460} onCerrar={onCerrar}
      pie={info
        ? <><button type="button" className="btn" onClick={() => setInfo(null)} disabled={ocupado}>Atrás</button>
            <button type="button" className="btn btn-primary" onClick={confirmar} disabled={ocupado}>Unirme</button></>
        : <><button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={revisar} disabled={ocupado || codigo.trim().length < 4}>Seguir</button></>}>
      {!info ? (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            Con tu misma cuenta podés estar en varias organizaciones, con un rol distinto en cada una.
            Pedile un código de alta al administrador de la otra organización.
          </p>
          <label className="field">
            <span>Código</span>
            <input autoFocus value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter' && codigo.trim().length >= 4) revisar(); }} placeholder="FR-ADMIN-XXXX" />
          </label>
        </>
      ) : (
        <p style={{ marginTop: 0 }}>
          Vas a entrar a <strong>{info.club}</strong> como <strong>{info.rol}</strong>{info.grupo ? <> ({info.grupo})</> : null}.
          Tus datos de cada organización quedan separados.
        </p>
      )}
      {error && <p className="small" style={{ color: 'var(--accent)' }}>{error}</p>}
    </Dialogo>
  );
}
