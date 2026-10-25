// Comprobación de salud: la usa la vigilancia automática de GitHub cada 30 minutos.
const URL_SB = process.env.VITE_SUPABASE_URL || 'https://dpminerxndpjqillozqo.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_mJQtrQeXlzI3dG7hvOAXFQ_-wRU_8NB';

export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${URL_SB}/rest/v1/rpc/ver_codigo`, {
      method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_codigo: 'SALUD-0000' }),
    });
    if (!r.ok) { res.status(503).json({ ok: false, base: r.status }); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, ms: Date.now() - t0 });
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e.message || e) });
  }
}
