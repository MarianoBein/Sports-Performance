// Calendario privado de cada persona en formato iCalendar (Google / Apple Calendar).
// Solo lectura: usa la clave pública y la función ics_eventos, que valida el token.
const URL_SB = process.env.VITE_SUPABASE_URL || 'https://dpminerxndpjqillozqo.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_mJQtrQeXlzI3dG7hvOAXFQ_-wRU_8NB';

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fecha = (d) => d.replace(/-/g, '');
const horaIcs = (t) => t.slice(0, 5).replace(':', '') + '00';
const siguienteDia = (d) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const masUnaHora = (t) => { const [h, m] = t.split(':').map(Number); const total = Math.min(h * 60 + m + 60, 23 * 60 + 59); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; };
const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const plegar = (l) => { const out = []; let s = l; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };

export default async function handler(req, res) {
  const token = String((req.query && req.query.t) || '');
  if (!/^[a-f0-9]{20,}$/.test(token)) { res.status(404).send('No encontrado'); return; }
  const r = await fetch(`${URL_SB}/rest/v1/rpc/ics_eventos`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token }),
  });
  if (!r.ok) { res.status(502).send('Error al leer el calendario'); return; }
  const eventos = await r.json();
  const tz = (eventos[0] && eventos[0].zona_horaria) || 'Europe/Madrid';
  const club = (eventos[0] && eventos[0].club) || 'Sports Performance';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sports Performance//Calendario//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(club)}`, `X-WR-TIMEZONE:${tz}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const e of eventos) {
    const titulo = e.es_partido && e.rival ? `vs ${e.rival}` : e.nombre;
    L.push('BEGIN:VEVENT', `UID:${e.id}@sports-performance`, `DTSTAMP:${stamp(e.actualizado_en)}`, `LAST-MODIFIED:${stamp(e.actualizado_en)}`);
    if (e.todo_el_dia || !e.hora_inicio) {
      L.push(`DTSTART;VALUE=DATE:${fecha(e.fecha)}`, `DTEND;VALUE=DATE:${fecha(siguienteDia(e.fecha))}`);
    } else {
      const fin = e.hora_fin && e.hora_fin > e.hora_inicio ? e.hora_fin : masUnaHora(e.hora_inicio);
      L.push(`DTSTART;TZID=${tz}:${fecha(e.fecha)}T${horaIcs(e.hora_inicio)}`, `DTEND;TZID=${tz}:${fecha(e.fecha)}T${horaIcs(fin)}`);
    }
    L.push(`SUMMARY:${esc(titulo)}`);
    if (e.lugar || e.direccion) L.push(`LOCATION:${esc([e.lugar, e.direccion].filter(Boolean).join(', '))}`);
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(L.map(plegar).join('\r\n') + '\r\n');
}
