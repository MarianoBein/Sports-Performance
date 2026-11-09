// PDF del entrenamiento de un día (equipo, grupo o jugador) para compartir.
// Cada nombre de ejercicio con video es un link que abre YouTube.
import { esquema, tiempoTexto, type Ejercicio, type Item } from './workout';

const TINTA: [number, number, number] = [22, 24, 29];
const ACENTO: [number, number, number] = [179, 18, 46];
const LINK: [number, number, number] = [31, 79, 209];
const GRIS: [number, number, number] = [96, 100, 110];

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const fechaLarga = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number);
  return `${DIAS[new Date(a, m - 1, d).getDay()]} ${d}/${m}/${a}`;
};

export async function pdfEntreno(o: { club: string; plan: string; fecha: string; items: Item[]; biblioteca: Ejercicio[] }): Promise<'compartido' | 'descargado'> {
  const { jsPDF } = await import('jspdf');   // se carga solo al exportar
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const AN = 210, AL = 297, MX = 16, ANCHO = AN - 2 * MX;
  const videoDe = new Map(o.biblioteca.map((e) => [e.id, e.video_url]));
  let y = 0;

  const cabecera = () => {
    doc.setFillColor(...TINTA); doc.rect(0, 0, AN, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(o.club.toUpperCase(), MX, 10);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(19);
    const f = fechaLarga(o.fecha);
    doc.text(`Entreno del ${f}`, MX, 20);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(o.plan, AN - MX, 20, { align: 'right' });
    doc.setFillColor(...ACENTO); doc.rect(0, 30, AN, 1.2, 'F');
    y = 42;
  };
  const espacio = (alto: number) => { if (y + alto > AL - 18) { doc.addPage(); cabecera(); } };

  cabecera();
  const items = o.items.filter((it) => it.tipo !== 'pregunta');
  if (!items.some((it) => it.tipo === 'ejercicio')) {
    doc.setTextColor(...GRIS); doc.setFontSize(12); doc.text('Este día no tiene ejercicios.', MX, y);
  }
  let n = 0;
  for (const it of items) {
    if (it.tipo === 'break') {
      espacio(14);
      y += 3;
      doc.setTextColor(...ACENTO); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
      doc.text(it.nombre.toUpperCase(), MX, y);
      doc.setDrawColor(...ACENTO); doc.setLineWidth(0.4); doc.line(MX, y + 1.8, AN - MX, y + 1.8);
      y += 8;
      continue;
    }
    if (it.tipo === 'nota') {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      const lineas = doc.splitTextToSize(it.nota || it.nombre, ANCHO - 8) as string[];
      const alto = lineas.length * 4.6 + 5;
      espacio(alto + 3);
      doc.setFillColor(255, 242, 194); doc.roundedRect(MX, y - 4, ANCHO, alto, 2, 2, 'F');
      doc.setTextColor(...TINTA); doc.text(lineas, MX + 4, y + 0.5);
      y += alto + 3;
      continue;
    }
    // Ejercicio
    n++;
    const video = it.ejercicio_id ? videoDe.get(it.ejercicio_id) : null;
    const detalle = [esquema(it), it.descanso_seg ? `descanso ${tiempoTexto(it.descanso_seg)}` : ''].filter(Boolean).join(' · ');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    const nota = it.nota ? (doc.splitTextToSize(it.nota, ANCHO - 10) as string[]) : [];
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5);
    const titulo = doc.splitTextToSize(it.nombre, ANCHO - 10 - (video ? 14 : 0)) as string[];
    espacio(titulo.length * 5.6 + 6 + nota.length * 4.3 + 4);
    doc.setTextColor(...GRIS); doc.setFontSize(10); doc.text(String(n), MX, y);
    doc.setFontSize(12.5);
    if (video && /^https:\/\//.test(video)) {
      doc.setTextColor(...LINK);
      titulo.forEach((l, i) => {
        doc.textWithLink(l, MX + 8, y + i * 5.6, { url: video });
        const w = doc.getTextWidth(l); doc.setDrawColor(...LINK); doc.setLineWidth(0.25); doc.line(MX + 8, y + i * 5.6 + 0.9, MX + 8 + w, y + i * 5.6 + 0.9);
      });
      const ultimo = titulo[titulo.length - 1];
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      doc.textWithLink('(video)', MX + 8 + doc.setFontSize(12.5).setFont('helvetica', 'bold').getTextWidth(ultimo) + 3, y + (titulo.length - 1) * 5.6, { url: video });
    } else {
      doc.setTextColor(...TINTA);
      doc.text(titulo, MX + 8, y);
    }
    y += (titulo.length - 1) * 5.6 + 5.2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...TINTA);
    doc.text(detalle, MX + 8, y);
    y += 4.6;
    if (nota.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5); doc.setTextColor(...GRIS);
      doc.text(nota, MX + 8, y);
      y += nota.length * 4.3;
    }
    y += 3.5;
    doc.setDrawColor(230, 228, 222); doc.setLineWidth(0.2); doc.line(MX + 8, y - 2, AN - MX, y - 2);
    y += 2;
  }

  // Pie en cada página
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRIS);
    doc.text('Tocá el nombre de un ejercicio para ver el video.', MX, AL - 10);
    doc.text(`${p} / ${total}`, AN - MX, AL - 10, { align: 'right' });
  }

  const nombre = `Entreno ${o.fecha} ${o.plan}.pdf`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\\/:*?"<>|]/g, '-');   // sin tildes: algunos navegadores cambian el nombre por «download»
  const archivo = new File([doc.output('blob')], nombre, { type: 'application/pdf' });
  // En el celular: menú de compartir (WhatsApp, mail…). En la compu: se descarga.
  const tactil = window.matchMedia?.('(pointer: coarse)').matches;
  if (tactil && navigator.canShare?.({ files: [archivo] })) {
    try { await navigator.share({ files: [archivo], title: `Entreno del ${fechaLarga(o.fecha)}` }); return 'compartido'; }
    catch (e) { if ((e as Error).name === 'AbortError') return 'compartido'; }
  }
  doc.save(nombre);
  return 'descargado';
}
