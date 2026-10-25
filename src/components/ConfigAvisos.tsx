import { useEffect, useState } from 'react';

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function Copiable({ nombre, valor, multilinea }: { nombre: string; valor: string; multilinea?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <code style={{ fontWeight: 700 }}>{nombre}</code>
        <button type="button" className="btn btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(valor); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* seleccioná a mano */ } }}>{ok ? 'Copiado ✓' : 'Copiar'}</button>
      </div>
      {multilinea
        ? <pre style={{ margin: 0, padding: 10, background: 'var(--bg)', borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'all' }}>{valor}</pre>
        : <code style={{ padding: '8px 10px', background: 'var(--bg)', borderRadius: 8, fontSize: 12, overflowWrap: 'anywhere', userSelect: 'all' }}>{valor}</code>}
    </div>
  );
}

// Configuración única de los avisos push. Las claves se generan en este navegador:
// no pasan por ningún otro lado hasta que las pegás en Vercel.
export default function ConfigAvisos() {
  const [configurado, setConfigurado] = useState<boolean | null>(null);
  const [claves, setClaves] = useState<{ publica: string; privada: string; cron: string } | null>(null);
  useEffect(() => { fetch('/api/avisos').then((r) => r.json()).then((j) => setConfigurado(!!j.publica)).catch(() => setConfigurado(false)); }, []);

  async function generar() {
    const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publica = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey)));
    const privada = (await crypto.subtle.exportKey('jwk', par.privateKey)).d as string;
    const cron = b64url(crypto.getRandomValues(new Uint8Array(24)));
    setClaves({ publica, privada, cron });
  }

  const sql = claves ? `create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('avisos-push', '*/5 * * * *', $$
  select net.http_post(
    url := '${window.location.origin}/api/avisos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '${claves.cron}'),
    body := '{}'::jsonb
  );
$$);` : '';

  return (
    <section className="card stack" style={{ padding: 16, gap: 12, marginBottom: 16 }} aria-label="Avisos al celular">
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 16 }}>Avisos al celular (wellness y RPE)</strong>
        {configurado === true && <span className="pill" style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)' }}>Configurados</span>}
        {configurado === false && <span className="pill" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>Sin configurar</span>}
      </div>
      {!claves ? (
        <>
          <p className="small" style={{ margin: 0 }}>Se configura una sola vez para toda la plataforma. {configurado ? 'Ya está hecho: si generás claves nuevas, los jugadores tienen que volver a activar los avisos.' : 'Tocá el botón y seguí los pasos.'}</p>
          <button type="button" className={configurado ? 'btn btn-sm' : 'btn btn-primary'} style={{ alignSelf: 'flex-start' }} onClick={generar}>Generar claves</button>
        </>
      ) : (
        <>
          <p className="notice notice-warn" style={{ margin: 0 }}>Estas claves son secretas: pegalas solo en Vercel y en Supabase. No las mandes por chat ni por foto. Si cerrás esta página antes de terminar, generá otras.</p>
          <p className="small" style={{ margin: 0 }}><strong>1. Vercel</strong> → tu proyecto → Environment Variables. Creá estas tres (Production y Preview), tipo «Sensitive»:</p>
          <Copiable nombre="VAPID_PUBLIC_KEY" valor={claves.publica} />
          <Copiable nombre="VAPID_PRIVATE_KEY" valor={claves.privada} />
          <Copiable nombre="CRON_SECRET" valor={claves.cron} />
          <p className="small" style={{ margin: 0 }}><strong>2. Vercel</strong> → Deployments → en el último, los tres puntos → <strong>Redeploy</strong> (para que tome las variables).</p>
          <p className="small" style={{ margin: 0 }}><strong>3. Supabase</strong> → SQL Editor → pegá esto y Run. Hace que Supabase llame a la app cada 5 minutos para mandar los avisos que tocan:</p>
          <Copiable nombre="SQL" valor={sql} multilinea />
        </>
      )}
    </section>
  );
}
