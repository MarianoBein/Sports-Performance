// Programas plantilla (por ejemplo, «Esguince de tobillo · 3 semanas»).
// La plantilla no tiene fechas: semana 1..N y lunes..domingo. Al asignarla a un jugador,
// grupo o al equipo se COPIA a sus días reales, antes o después de lo que ya tenían.
// Lo copiado se edita como cualquier plan y la plantilla no cambia.
import { supabase, mensajeError } from './supabase';
import { iso, sumarDias, desdeIso, lunesDe } from './calendario';
import { claveDestinos, itemDesdeDb, nuevoId, type Destino, type Item } from './workout';
import { destinosDe, llave, materializar, propagar, type Conflicto, type Ctx, type Mapa } from './planes';

export type Programa = { id: string; nombre: string; descripcion: string | null; semanas: number; dias: Record<string, Item[]>; actualizado_en?: string };

export const claveDia = (semana: number, dia: number) => `${semana}-${dia}`;   // dia: 0 = lunes … 6 = domingo

export function sesionesDe(p: Pick<Programa, 'semanas' | 'dias'>): { semana: number; dia: number; items: Item[] }[] {
  const out: { semana: number; dia: number; items: Item[] }[] = [];
  for (let s = 1; s <= p.semanas; s++) for (let d = 0; d < 7; d++) {
    const its = p.dias[claveDia(s, d)] ?? [];
    if (its.length) out.push({ semana: s, dia: d, items: its });
  }
  return out;
}

export const lunesIso = (fecha: string) => iso(lunesDe(desdeIso(fecha)));
export const fechaDe = (lunes: string, semana: number, dia: number) => iso(sumarDias(desdeIso(lunes), (semana - 1) * 7 + dia));

const copiaNueva = (it: Item, programa: string): Item => ({
  ...it, id: nuevoId(), origen_id: null, modificado: false,
  detalle: (it.detalle ?? []).map((s) => ({ ...s })), config: { ...(it.config ?? {}), programa },
});
const breakDe = (nombre: string, programa?: string): Item => ({
  id: nuevoId(), tipo: 'break', bloque: 'Bloque principal', ejercicio_id: null, nombre, series: 0, reps: '',
  cada_lado: false, con_carga: false, detalle: [], descanso_seg: null, nota: '', origen_id: null, modificado: false,
  config: programa ? { programa } : {},
});

// Lo que se agrega en un día: siempre arranca con un título con el nombre del programa,
// para que se distinga del entreno normal (y para que no se mezcle con el bloque anterior).
export function bloqueDelPrograma(nombre: string, items: Item[]): Item[] {
  const copias = items.map((it) => copiaNueva(it, nombre));
  if (copias[0]?.tipo === 'break') { copias[0] = { ...copias[0], nombre: `${nombre} · ${copias[0].nombre}`.slice(0, 120) }; return copias; }
  return [breakDe(nombre, nombre), ...copias];
}

export function combinar(existente: Item[], bloque: Item[], posicion: 'antes' | 'despues'): Item[] {
  if (posicion === 'despues' || !existente.length) return [...existente, ...bloque];
  // Antes: si lo que ya había no empieza con un título, le ponemos uno para que no quede dentro del programa.
  const resto = existente[0].tipo === 'break' ? existente : [breakDe('Entreno del día'), ...existente];
  return [...bloque, ...resto];
}

export async function asignarPrograma(p: Programa, clave: string, lunes: string, posicion: 'antes' | 'despues', paraNombre: string): Promise<number> {
  const sesiones = sesionesDe(p);
  if (!sesiones.length) throw new Error('El programa está vacío: agregale ejercicios primero.');
  const fechas = sesiones.map((s) => fechaDe(lunes, s.semana, s.dia));
  const desde = [...fechas].sort()[0]; const hasta = [...fechas].sort().slice(-1)[0];

  const [ses, g, mi] = await Promise.all([
    supabase.from('sesiones')
      .select('id,fecha,destinos,sesion_items(id,orden,tipo,bloque,ejercicio_id,nombre,series,reps,cada_lado,con_carga,detalle,descanso_seg,nota,origen_id,modificado,config,eliminado_en)')
      .gte('fecha', desde).lte('fecha', hasta),
    supabase.from('grupos').select('id,nombre').order('nombre'),
    supabase.from('grupo_miembros').select('grupo_id,perfil_id'),
  ]);
  if (ses.error) throw new Error(mensajeError(ses.error));
  const grupos = (g.data as { id: string; nombre: string }[]) ?? [];
  const miembros = (mi.data as { grupo_id: string; perfil_id: string }[]) ?? [];
  const ctx: Ctx = { gruposDe: (j) => grupos.filter((x) => miembros.some((m) => m.grupo_id === x.id && m.perfil_id === j)).map((x) => x.id) };

  const m: Mapa = {};
  for (const r of (ses.data ?? []) as Record<string, unknown>[]) {
    const ds = r.destinos as Destino[];
    if (!Array.isArray(ds) || ds.length !== 1) continue;
    m[llave(claveDestinos(ds), r.fecha as string)] = ((r.sesion_items as Record<string, unknown>[]) ?? [])
      .filter((i) => !i.eliminado_en).sort((a, b) => Number(a.orden) - Number(b.orden)).map(itemDesdeDb);
  }
  const antes: Mapa = { ...m };

  const choques: Conflicto[] = [];
  sesiones.forEach((s, i) => {
    const f = fechas[i];
    const viejo = [...materializar(clave, f, m, ctx)];
    const nuevo = combinar(viejo, bloqueDelPrograma(p.nombre, s.items), posicion);
    m[llave(clave, f)] = nuevo;
    propagar(clave, f, viejo, nuevo, m, ctx, choques);   // si es un grupo o el equipo, también les llega a los que tienen su día propio
  });

  const cambios = Object.keys(m).filter((k) => m[k] !== antes[k]).map((k) => {
    const [c, fecha] = k.split('|');
    return { fecha, destinos: destinosDe(c), items: m[k].map((it) => ({ ...it, reps: it.reps || null, nota: it.nota || null })) };
  });
  const { error } = await supabase.rpc('guardar_dias', { p_cambios: cambios });
  if (error) throw new Error(mensajeError(error));
  await supabase.rpc('registrar_asignacion_programa', { p_id: p.id, p_para: paraNombre, p_desde: lunes });
  return sesiones.length;
}
