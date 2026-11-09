// Excel de la semana con el diseño del «PLANNING TEMPORADA»:
// cabecera con escudo y grilla de días; por cada día con pesas, «GYM n» con la entrada en calor
// en columnas (MOV. / CAL. / PREP.…) y la tabla BLOQUE · EJERCICIO · SEMANA (A1, A2, B1…).
// Cada nombre de ejercicio con video es un link a YouTube.
import { desdeIso, iso, lunesDe, sumarDias } from './calendario';
import { esquema, progresaBloque, tiempoTexto, type Ejercicio, type Item } from './workout';

const DIAS = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO'];
const AZUL = 'FF0000FF';
const ddmm = (f: string) => { const d = desdeIso(f); return `${d.getDate()}/${d.getMonth() + 1}`; };

type Dia = { fecha: string; items: Item[] };

// Dosis corta para la entrada en calor: «10 Dead bug», «2×8 c/lado Wall slide».
function dosisCorta(it: Item) {
  const reps = it.detalle[0]?.reps || it.reps || '';
  const seg = it.config?.unidad === 'seg' ? '´´' : '';
  const lado = it.cada_lado ? ' c/lado' : '';
  if (!reps) return '';
  return it.series > 1 ? `${it.series}×${reps}${seg}${lado}` : `${reps}${seg}${lado}`;
}

export async function excelSemana(o: {
  club: string; plan: string; dia: string; logoUrl?: string | null;
  itemsDe: (fecha: string) => Item[]; biblioteca: Ejercicio[];
}): Promise<'compartido' | 'descargado'> {
  const ExcelJS = (await import('exceljs')).default;   // se carga solo al exportar
  const videoDe = new Map(o.biblioteca.map((e) => [e.id, e.video_url]));
  const link = (it: Item) => { const v = it.ejercicio_id ? videoDe.get(it.ejercicio_id) : null; return v && /^https:\/\//.test(v) ? v : null; };

  const lunes = lunesDe(desdeIso(o.dia));
  const semana: Dia[] = Array.from({ length: 7 }, (_, i) => { const f = iso(sumarDias(lunes, i)); return { fecha: f, items: o.itemsDe(f) }; });
  const conPesas = semana.filter((d) => d.items.some((it) => it.tipo === 'ejercicio'));
  const gym = new Map(conPesas.map((d, i) => [d.fecha, `GYM ${i + 1}`]));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sports Performance';
  const ws = wb.addWorksheet('PLANNING SEMANA', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }],
  });
  ws.columns = [{ width: 9 }, { width: 9 }, { width: 2 }, { width: 37 }, { width: 32 }, { width: 27 }, { width: 27.5 }, { width: 27 }];
  const fino = { style: 'thin' as const, color: { argb: 'FF000000' } };
  const borde = { top: fino, left: fino, bottom: fino, right: fino };
  const celda = (ref: string, valor: unknown, est: { bold?: boolean; size?: number; italic?: boolean; borde?: boolean; centro?: boolean; color?: string; fondo?: string } = {}) => {
    const c = ws.getCell(ref);
    c.value = valor as never;
    c.font = { name: 'Arial', size: est.size ?? 10, bold: !!est.bold, italic: !!est.italic, ...(est.color ? { color: { argb: est.color } } : {}) };
    c.alignment = { vertical: 'middle', wrapText: true, ...(est.centro ? { horizontal: 'center' } : {}) };
    if (est.borde) c.border = borde;
    if (est.fondo) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: est.fondo } };
    return c;
  };
  const ejercicio = (ref: string, texto: string, it: Item, est: { borde?: boolean; size?: number } = {}) => {
    const url = link(it);
    if (url) {
      const c = celda(ref, { text: texto, hyperlink: url }, { ...est, color: AZUL });
      c.font = { ...c.font, underline: true };
    } else celda(ref, texto, est);
  };

  // ---------- Cabecera ----------
  ws.mergeCells('A1:B10');
  if (o.logoUrl) {
    try {
      const r = await fetch(o.logoUrl);
      const tipo = (r.headers.get('content-type') ?? '').includes('png') ? 'png' : 'jpeg';
      if (r.ok) ws.addImage(wb.addImage({ buffer: await r.arrayBuffer(), extension: tipo }), { tl: { col: 0.15, row: 0.3 }, ext: { width: 120, height: 120 } });
    } catch { /* sin escudo */ }
  }
  ws.mergeCells('D2:G2'); celda('D2', `PLAN ${o.plan.toUpperCase()}`, { bold: true, size: 18, centro: true });
  ws.mergeCells('D4:G4'); celda('D4', `SEMANA: del lunes ${ddmm(semana[0].fecha)} al domingo ${ddmm(semana[6].fecha)}/${semana[6].fecha.slice(0, 4)}`, { bold: true });
  ws.mergeCells('D5:G5'); celda('D5', `SESIONES: ${conPesas.length} GYM`, { bold: true });
  ws.mergeCells('D6:G6'); celda('D6', o.club.toUpperCase());
  ['D', 'E', 'F', 'G', 'H'].forEach((col, i) => {
    celda(`${col}7`, DIAS[i], { bold: true, borde: true });
    celda(`${col}8`, gym.get(semana[i].fecha) ?? '—', { borde: true });
  });
  ['D', 'E'].forEach((col, i) => {
    celda(`${col}9`, DIAS[5 + i], { bold: true, borde: true });
    celda(`${col}10`, gym.get(semana[5 + i].fecha) ?? '—', { borde: true });
  });

  // ---------- Cada sesión ----------
  let fila = 12;
  for (const d of conPesas) {
    // Separar entrada en calor (bloques que no progresan) del trabajo principal
    type Bloque = { nombre: string; calor: boolean; items: Item[] };
    const bloques: Bloque[] = [];
    const notas: string[] = [];
    let actual: Bloque | null = null;
    for (const it of d.items) {
      if (it.tipo === 'break') { actual = { nombre: it.nombre, calor: !progresaBloque(it), items: [] }; bloques.push(actual); continue; }
      if (it.tipo === 'nota') { notas.push(it.nota || it.nombre); continue; }
      if (it.tipo !== 'ejercicio') continue;
      if (!actual) { actual = { nombre: '', calor: false, items: [] }; bloques.push(actual); }
      actual.items.push(it);
    }
    const calor = bloques.filter((b) => b.calor && b.items.length);
    const trabajo = bloques.filter((b) => !b.calor && b.items.length);

    ws.mergeCells(`D${fila}:G${fila}`);
    celda(`D${fila}`, `${gym.get(d.fecha)} · ${DIAS[(desdeIso(d.fecha).getDay() + 6) % 7]} ${ddmm(d.fecha)}`, { bold: true, borde: true, size: 12, fondo: 'FFF2F2F2' });
    fila++;

    // Entrada en calor: una columna por bloque (MOV. · CAL. · PREP. …), hasta 4
    if (calor.length) {
      const cols = ['D', 'E', 'F', 'G'];
      const usados = calor.slice(0, 4);
      usados.forEach((b, i) => celda(`${cols[i]}${fila}`, b.nombre.toUpperCase(), { bold: true, borde: true }));
      const alto = Math.max(...usados.map((b) => b.items.length));
      for (let r = 0; r < alto; r++) {
        usados.forEach((b, i) => {
          const it = b.items[r];
          const ref = `${cols[i]}${fila + 1 + r}`;
          if (it) ejercicio(ref, `${dosisCorta(it)} ${it.nombre}`.trim(), it, { borde: true });
          else celda(ref, '', { borde: true });
        });
      }
      fila += alto + 1;
    }

    // Trabajo: BLOQUE · EJERCICIO · SEMANA · NOTAS
    celda(`D${fila}`, 'BLOQUE', { bold: true, borde: true });
    celda(`E${fila}`, 'EJERCICIO', { bold: true, borde: true });
    celda(`F${fila}`, `SEMANA ${ddmm(semana[0].fecha)}`, { bold: true, borde: true });
    celda(`G${fila}`, 'NOTAS', { bold: true, borde: true });
    fila++;
    trabajo.forEach((b, bi) => {
      const letra = String.fromCharCode(65 + (bi % 26));
      b.items.forEach((it, ii) => {
        celda(`D${fila}`, `${letra}${ii + 1}${ii === 0 && b.nombre ? `  ·  ${b.nombre}` : ''}`, { bold: true, borde: true, centro: !b.nombre || ii > 0 });
        ejercicio(`E${fila}`, it.nombre, it, { borde: true });
        celda(`F${fila}`, esquema(it), { borde: true });
        celda(`G${fila}`, [it.descanso_seg ? `Descanso ${tiempoTexto(it.descanso_seg)}` : '', it.nota ?? ''].filter(Boolean).join(' · '), { borde: true, size: 9 });
        fila++;
      });
    });
    for (const n of notas) {
      ws.mergeCells(`D${fila}:G${fila}`);
      celda(`D${fila}`, n, { italic: true, borde: true, fondo: 'FFFFF2C2' });
      fila++;
    }
    fila += 2;
  }
  if (!conPesas.length) celda('D12', 'Esta semana no tiene sesiones cargadas.', { italic: true });

  const nombre = `Plan ${o.plan} semana ${ddmm(semana[0].fecha).replace('/', '-')}.xlsx`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\\/:*?"<>|]/g, '-');   // sin tildes: algunos navegadores cambian el nombre por «download»
  const buf = await wb.xlsx.writeBuffer();
  const archivo = new File([buf], nombre, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const tactil = window.matchMedia?.('(pointer: coarse)').matches;
  if (tactil && navigator.canShare?.({ files: [archivo] })) {
    try { await navigator.share({ files: [archivo], title: `Plan semana ${ddmm(semana[0].fecha)}` }); return 'compartido'; }
    catch (e) { if ((e as Error).name === 'AbortError') return 'compartido'; }
  }
  const url = URL.createObjectURL(archivo);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a);
  a.dispatchEvent(new MouseEvent('click'));
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 40000);
  return 'descargado';
}
