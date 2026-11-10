// «Sumar persona»: el admin crea la cuenta de alguien (nombre, email, rol y contraseña temporal).
// La primera vez que entra, la app le pide elegir su contraseña.
// La clave secreta de Supabase vive en Vercel (SUPABASE_SECRET_KEY) y nunca llega al navegador.
const URL_SB = process.env.VITE_SUPABASE_URL || 'https://dpminerxndpjqillozqo.supabase.co';
const PUBLICA = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_mJQtrQeXlzI3dG7hvOAXFQ_-wRU_8NB';
const SECRETA = process.env.SUPABASE_SECRET_KEY;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rpcAdmin(token, nombre, cuerpo) {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: PUBLICA, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const datos = await r.json().catch(() => ({}));
  return { ok: r.ok, datos };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido.' }); return; }
  if (!SECRETA) { res.status(500).json({ error: 'Falta configurar SUPABASE_SECRET_KEY en Vercel.' }); return; }
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const b = req.body || {};
  const nombre = String(b.nombre || '').trim().slice(0, 120);
  const email = String(b.email || '').trim().toLowerCase();
  const clave = String(b.clave || '');
  const rol = String(b.rol || '');
  const grupo = b.grupo ? String(b.grupo) : null;
  if (!token || !nombre || !UUID.test(rol) || (grupo && !UUID.test(grupo))) { res.status(400).json({ error: 'Datos incompletos.' }); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) { res.status(400).json({ error: 'El email no es válido.' }); return; }
  if (clave.length < 8 || clave.length > 72) { res.status(400).json({ error: 'La contraseña temporal tiene que tener al menos 8 caracteres.' }); return; }

  // 1) Con la sesión del admin: ¿puede sumar a alguien con ese rol y grupo? (devuelve su club)
  const r1 = await rpcAdmin(token, 'puedo_sumar_persona', { p_rol: rol, p_grupo: grupo });
  if (!r1.ok) { res.status(403).json({ error: r1.datos.message || 'No tenés permiso para hacer esto.' }); return; }

  // 2) Con la clave secreta: crea la cuenta (ya confirmada) y la marca como creada para este club.
  const club = r1.datos;
  if (typeof club !== 'string' || !UUID.test(club)) { res.status(403).json({ error: 'No se pudo saber tu organización.' }); return; }
  const r2 = await fetch(`${URL_SB}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRETA, 'Content-Type': 'application/json' }, // las claves sb_secret_ van solo en «apikey»
    body: JSON.stringify({ email, password: clave, email_confirm: true, user_metadata: { nombre }, app_metadata: { sumado_en_club: club } }),
  });
  const u = await r2.json().catch(() => ({}));
  if (!r2.ok) {
    const txt = JSON.stringify(u).toLowerCase();
    if (r2.status === 422 || txt.includes('already') || txt.includes('exists')) {
      res.status(409).json({ error: 'Ese email ya tiene cuenta: mandale un código de alta y que entre con su contraseña.' });
    } else if (txt.includes('password')) {
      res.status(400).json({ error: 'La contraseña temporal es muy débil: probá con otra.' });
    } else {
      res.status(502).json({ error: 'No se pudo crear la cuenta. Probá de nuevo.' });
    }
    return;
  }
  const id = u.id || (u.user && u.user.id);

  // 3) Con la sesión del admin: crea el perfil en el club (si falla, se borra la cuenta recién creada).
  const r3 = await rpcAdmin(token, 'sumar_persona', { p_user: id, p_email: email, p_nombre: nombre, p_rol: rol, p_grupo: grupo });
  if (!r3.ok) {
    await fetch(`${URL_SB}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: SECRETA } }).catch(() => {});
    res.status(400).json({ error: r3.datos.message || 'No se pudo sumar a la persona.' });
    return;
  }
  res.status(200).json({ ok: true });
}
