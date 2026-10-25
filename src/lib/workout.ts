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
