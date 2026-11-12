// Avisos al celular (push). Supabase llama acá cada 5 minutos (POST con la clave del cron);
// la app pregunta a quién le toca un aviso y se lo manda. GET devuelve la clave pública.
import webpush from 'web-push';

const URL_SB = process.env.VITE_SUPABASE_URL || 'https://dpminerxndpjqillozqo.supabase.co';
const SECRETA = process.env.SUPABASE_SECRET_KEY;
const PUBLICA_VAPID = process.env.VAPID_PUBLIC_KEY;
const PRIVADA_VAPID = process.env.VAPID_PRIVATE_KEY;
const CRON = process.env.CRON_SECRET;

// Fecha de hoy en Madrid (YYYY-MM-DD) y cómo se dice («martes 3/11»).
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const diaMadrid = () => {
  const d = new Date();
  const nombre = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long' }).format(d);
  const [dd, mm] = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'numeric' }).format(d).split('/');
  return `${nombre} ${dd}/${mm}`;
};
const TEXTOS = {
  wellness: (dia) => ({ titulo: 'Wellness', cuerpo: `¿Cómo llegás hoy (${dia})? Contestá tu wellness: son cuatro respuestas.`, url: '/wellness' }),
  rpe: (dia) => ({ titulo: 'RPE', cuerpo: `¿Qué tan duro fue hoy (${dia})? Cargá tu RPE.`, url: '/rpe' }),
};

async function rpc(nombre, cuerpo) {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: SECRETA, 'Content-Type': 'application/json' }, // las claves sb_secret_ van solo en «apikey»
    body: JSON.stringify(cuerpo ?? {}),
  });
  if (!r.ok) throw new Error(`${nombre}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

export default async function handler(req, res) {
  if (req.method === 'GET') { res.status(200).json({ publica: PUBLICA_VAPID || null }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido.' }); return; }
  if (!CRON || req.headers['x-cron-secret'] !== CRON) { res.status(401).json({ error: 'No autorizado.' }); return; }
  if (!SECRETA || !PUBLICA_VAPID || !PRIVADA_VAPID) { res.status(500).json({ error: 'Faltan variables en Vercel (SUPABASE_SECRET_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).' }); return; }

  webpush.setVapidDetails('mailto:avisos@sports-performance.app', PUBLICA_VAPID, PRIVADA_VAPID);
  let enviados = 0; let quitados = 0; let fallidos = 0;
  try {
    const avisos = (await rpc('tomar_avisos')) || [];
    const fecha = hoyMadrid(); const dia = diaMadrid();
    for (const a of avisos) {
      const t = TEXTOS[a.tipo](dia);
      try {
        await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
          JSON.stringify({ titulo: t.titulo, cuerpo: t.cuerpo, url: t.url, tag: a.tipo, fecha }), { TTL: 3600, urgency: 'high' });
        enviados++;
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) { await rpc('quitar_suscripcion', { p_endpoint: a.endpoint }); quitados++; }
        else fallidos++;
      }
    }
    // Alertas del Sports Science Hub para el staff deportivo (si el 027 todavía no está, se saltea).
    // y partes de fisio (parte nuevo y recordatorio del rechequeo). Si el SQL todavía no está, se saltea.
    let alertas = [];
    for (const f of ['tomar_alertas', 'tomar_partes']) {
      try { alertas = alertas.concat((await rpc(f)) || []); } catch { /* sin esa función todavía */ }
    }
    for (const a of alertas) {
      try {
        await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
          JSON.stringify({ titulo: a.titulo, cuerpo: a.cuerpo, url: a.url, tag: a.tag, fecha: a.fecha }), { TTL: 6 * 3600, urgency: 'high' });
        enviados++;
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) { await rpc('quitar_suscripcion', { p_endpoint: a.endpoint }); quitados++; }
        else fallidos++;
      }
    }
    res.status(200).json({ enviados, quitados, fallidos });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
