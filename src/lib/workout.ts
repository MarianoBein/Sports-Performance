export type Ejercicio = {
  id: string;
  nombre: string;
  categoria: string | null;
  implemento: string | null;
  lateralidad: 'Unilateral' | 'Bilateral' | null;
  contraccion: 'Isométrico' | 'Excéntrico' | null;
  video_url: string | null;
  consignas: string | null;
  eliminado_en: string | null;
};

export const CATEGORIAS = [
  'Movilidad',
  'Core',
  'Tren inferior: rodilla dominante',
  'Tren inferior: cadera dominante',
  'Aductores y abductores',
  'Gemelos y sóleo',
  'Muñeca y tobillo',
  'Tren superior: empuje',
  'Tren superior: tracción',
  'Saltos / pliometría',
  'Lanzamientos',
  'Levantamientos olímpicos',
];

export const IMPLEMENTOS = [
  'Peso corporal', 'Kb/Mancuerna', 'Barra', 'Cajón/banco', 'Banda', 'Lastre', 'Balón medicinal',
  'Barra fija/paralelas', 'Slide board', 'Pica', 'Kb/Mancuerna/Disco', 'Conos', 'Soga',
];

// Color suave por categoría para reconocerla de un vistazo.
const TONOS: Record<string, [string, string]> = {
  'Movilidad': ['#E3F1EC', '#1F5A46'],
  'Core': ['#FFF0D6', '#6B4E00'],
  'Tren inferior: rodilla dominante': ['#DCE7FF', '#1E3A8A'],
  'Tren inferior: cadera dominante': ['#E6E0FF', '#43307E'],
  'Aductores y abductores': ['#EDE7DD', '#5A4A2E'],
  'Gemelos y sóleo': ['#EDE7DD', '#5A4A2E'],
  'Muñeca y tobillo': ['#EDE7DD', '#5A4A2E'],
  'Tren superior: empuje': ['#FDE3E6', '#8F0E1F'],
  'Tren superior: tracción': ['#FCE6DA', '#7A3412'],
  'Saltos / pliometría': ['#DDF3E4', '#1D5C32'],
  'Lanzamientos': ['#DDF3E4', '#1D5C32'],
  'Levantamientos olímpicos': ['#E8E8EC', '#2B2E36'],
};
export function tonoCategoria(c: string | null): { background: string; color: string } {
  const t = (c && TONOS[c]) || ['#F1EFEA', '#5C606A'];
  return { background: t[0], color: t[1] };
}

export function idYoutube(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:shorts\/|watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export function miniatura(url: string | null): string | null {
  const id = idYoutube(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

// Para buscar sin importar mayúsculas, tildes ni barras («kb db» encuentra «Kb/Db»).
export function normalizar(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9°%]+/g, ' ').trim();
}

// ---------- Sesiones (armado de la semana) ----------

export type Destino = { tipo: 'equipo'; ref?: null } | { tipo: 'grupo'; ref: string } | { tipo: 'persona'; ref: string };
export type Serie = { reps: string; kg: number | null };
export type Item = {
  id: string;
  tipo: 'ejercicio' | 'break';   // «break» = session break: un título; lo de abajo le pertenece
  bloque: string;
  ejercicio_id: string | null;
  nombre: string;
  series: number;
  reps: string;
  cada_lado: boolean;
  con_carga: boolean;
  detalle: Serie[];
  descanso_seg: number | null;
  nota: string;
};
export type Sesion = { id: string; fecha: string; destinos: Destino[]; items: Item[] };

export const BREAKS_SUGERIDOS = ['Activación', 'Bloque principal', 'Accesorios'];

// Clave para reconocer «el mismo plan» (mismos destinatarios), calculada siempre en la app.
export function claveDestinos(d: Destino[]): string {
  return [...new Set(d.map((x) => (x.tipo === 'equipo' ? 'equipo' : `${x.tipo}:${x.ref}`)))].sort().join(',');
}

export function nuevoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function itemDesdeDb(r: Record<string, unknown>): Item {
  return {
    id: r.id as string,
    tipo: r.tipo === 'break' ? 'break' : 'ejercicio',
    bloque: (r.bloque as string) || 'Bloque principal',
    ejercicio_id: (r.ejercicio_id as string) ?? null,
    nombre: r.nombre as string,
    series: Number(r.series) || (r.tipo === 'break' ? 0 : 1),
    reps: (r.reps as string) ?? '',
    cada_lado: !!r.cada_lado,
    con_carga: !!r.con_carga,
    detalle: Array.isArray(r.detalle) ? (r.detalle as Serie[]) : [],
    descanso_seg: r.descanso_seg == null ? null : Number(r.descanso_seg),
    nota: (r.nota as string) ?? '',
  };
}

const kgTexto = (kg: number | null) => (kg == null ? '—' : String(kg).replace('.', ','));

// «4 × 8 c/lado · 60-60-60-60»
export function esquema(it: Item): string {
  const repsVariables = it.con_carga && it.detalle.length && new Set(it.detalle.map((s) => s.reps)).size > 1;
  const reps = repsVariables ? it.detalle.map((s) => s.reps || '—').join('-') : (it.reps || it.detalle[0]?.reps || '—');
  let t = `${it.series} × ${reps}${it.cada_lado ? ' c/lado' : ''}`;
  if (it.con_carga && it.detalle.some((s) => s.kg != null)) t += ` · ${it.detalle.map((s) => kgTexto(s.kg)).join('-')}`;
  return t;
}

export function tiempoTexto(seg: number | null): string {
  if (seg == null) return '';
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
}

// Etiqueta MD respecto de los partidos: MD, MD+1/MD+2 tras el partido, MD-n antes del siguiente.
export function etiquetaMD(fecha: string, partidos: string[]): string | null {
  const t = Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10));
  const dias = (f: string) => Math.round((Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10)) - t) / 86400000);
  let antes: number | null = null; let despues: number | null = null;
  for (const p of partidos) {
    const d = dias(p);
    if (d === 0) return 'MD';
    if (d < 0 && (antes == null || -d < antes)) antes = -d;
    if (d > 0 && (despues == null || d < despues)) despues = d;
  }
  if (antes != null && antes <= 2) return `MD+${antes}`;
  if (despues != null) return `MD-${despues}`;
  if (antes != null) return `MD+${antes}`;
  return null;
}
