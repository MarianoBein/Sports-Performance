import { supabase } from './supabase';

export type Tipo = 'deportiva' | 'logistica' | 'prensa';
export type Destino = { tipo: 'equipo' | 'staff' | 'clevel' | 'prensa' | 'grupo' | 'persona'; ref: string | null };
export type Confirmacion = { perfil_id: string; estado: 'pendiente' | 'acepta' | 'no_puede'; respondido_en: string | null };
export type Actividad = {
  id: string; club_id: string; nombre: string; tipo: Tipo; fecha: string; todo_el_dia: boolean;
  hora_inicio: string | null; hora_fin: string | null; lugar: string | null; direccion: string | null;
  es_partido: boolean; rival: string | null; fuera: boolean; creado_por: string | null;
  destinos: Destino[]; confirmaciones: Confirmacion[];
};

export const TIPOS: Record<Tipo, { nombre: string; color: string; bg: string; fg: string }> = {
  deportiva: { nombre: 'Deportiva', color: '#1D4ED8', bg: '#DCE7FF', fg: '#1E3A8A' },
  logistica: { nombre: 'Logística', color: '#C2610C', bg: '#FFEBD6', fg: '#7A3A06' },
  prensa: { nombre: 'Prensa', color: '#6D28D9', bg: '#EDE4FF', fg: '#4C1D95' },
};

export const ETIQUETAS: { tipo: Destino['tipo']; nombre: string }[] = [
  { tipo: 'equipo', nombre: 'Equipo' },
  { tipo: 'staff', nombre: 'Staff deportivo' },
  { tipo: 'clevel', nombre: 'C-level' },
  { tipo: 'prensa', nombre: 'Prensa' },
];

// ---------- Fechas (siempre en hora local, sin zonas raras) ----------
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const desdeIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const sumarDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const diaSemana = (d: Date) => (d.getDay() + 6) % 7; // 0 = lunes
export const lunesDe = (d: Date) => sumarDias(d, -diaSemana(d));
export const hoyIso = () => iso(new Date());
export const hora = (t: string | null) => (t ? t.slice(0, 5) : '');
export const fechaLarga = (s: string) => { const d = desdeIso(s); return `${DIAS[diaSemana(d)]} ${d.getDate()} de ${MESES[d.getMonth()]}`; };

export function ordenar(a: Actividad, b: Actividad) {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.todo_el_dia !== b.todo_el_dia) return a.todo_el_dia ? -1 : 1;
  return (a.hora_inicio ?? '') < (b.hora_inicio ?? '') ? -1 : 1;
}

export function titulo(a: Actividad) {
  return a.es_partido && a.rival ? `vs ${a.rival}` : a.nombre;
}

export async function cargarActividades(desde: string, hasta: string): Promise<Actividad[]> {
  const { data, error } = await supabase
    .from('actividades')
    .select('*, destinos:actividad_destinos(tipo,ref), confirmaciones:actividad_confirmaciones(perfil_id,estado,respondido_en)')
    .is('eliminado_en', null)
    .gte('fecha', desde)
    .lte('fecha', hasta);
  if (error) throw error;
  return ((data as Actividad[]) ?? []).sort(ordenar);
}

export function enlaceMapa(a: { lugar: string | null; direccion: string | null }) {
  const q = encodeURIComponent([a.lugar, a.direccion].filter(Boolean).join(', '));
  return /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent)
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
