// Restablece la contraseña de una persona del club y devuelve una clave temporal.
// Solo para administradores del club. La clave secreta de Supabase vive en Vercel
// (SUPABASE_SECRET_KEY) y nunca llega al navegador.
import { randomBytes } from 'node:crypto';

const URL_SB = process.env.VITE_SUPABASE_URL || 'https://dpminerxndpjqillozqo.supabase.co';
const PUBLICA = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_mJQtrQeXlzI3dG7hvOAXFQ_-wRU_8NB';
const SECRETA = process.env.SUPABASE_SECRET_KEY;

const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function claveTemporal() {
  const bytes = randomBytes(10);
  const c = [...bytes].map((b) => ALFABETO[b % ALFABETO.length]).join('');
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido.' }); return; }
  if (!SECRETA) { res.status(500).json({ error: 'Falta configurar SUPABASE_SECRET_KEY en Vercel.' }); return; }
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const perfil = String((req.body && req.body.perfil_id) || '');
  if (!token || !/^[0-9a-f-]{36}$/i.test(perfil)) { res.status(400).json({ error: 'Datos incompletos.' }); return; }

  // 1) Con la sesión del admin: valida que pueda hacerlo, marca «debe cambiar la clave» y deja registro.
  const r1 = await fetch(`${URL_SB}/rest/v1/rpc/preparar_clave_temporal`, {
    method: 'POST',
    headers: { apikey: PUBLICA, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_perfil: perfil }),
  });
  if (!r1.ok) {
    const e = await r1.json().catch(() => ({}));
    res.status(403).json({ error: e.message || 'No tenés permiso para hacer esto.' });
    return;
  }
  // Desde el 020 la base devuelve el id de la CUENTA (una cuenta puede tener perfiles en varias
  // organizaciones). Si todavía devuelve el nombre (base sin el 020), cuenta y perfil son lo mismo.
  const devuelto = await r1.json().catch(() => null);
  const cuenta = typeof devuelto === 'string' && /^[0-9a-f-]{36}$/i.test(devuelto) ? devuelto : perfil;

  // 2) Con la clave secreta: pone la contraseña temporal.
  const clave = claveTemporal();
  const r2 = await fetch(`${URL_SB}/auth/v1/admin/users/${cuenta}`, {
    method: 'PUT',
    headers: { apikey: SECRETA, 'Content-Type': 'application/json' }, // las claves sb_secret_ van solo en «apikey»
    body: JSON.stringify({ password: clave }),
  });
  if (!r2.ok) { res.status(502).json({ error: 'No se pudo cambiar la contraseña. Probá de nuevo.' }); return; }
  res.status(200).json({ clave });
}
