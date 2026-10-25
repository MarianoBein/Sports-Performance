// Sports Science Hub: datos, referencias (medias móviles) y semáforos.
// Regla general: un dato que falta nunca cuenta como cero.
import { supabase } from './supabase';
import { cargarActividades, desdeIso, iso, sumarDias } from './calendario';
import { etiquetaMD } from './workout';

export type Metrica = 'preparacion' | 'sueno' | 'fatiga' | 'estres' | 'dolor' | 'esfuerzo';
export type Dia = {
  preparacion: number | null; sueno: number | null; fatiga: number | null; estres: number | null; dolor: number | null;
  rpe: number | null; minutos: number | null; esfuerzo: number | null; // esfuerzo = sRPE = RPE × minutos
  wAplica: boolean; rAplica: boolean;
};
export type Jugador = { id: string; nombre: string; grupos: string[] };
export type Datos = {
  desde: string; hasta: string;
  jugadores: Jugador[];
  grupos: { id: string; nombre: string }[];
  partidos: string[];
  dia: (perfil: string, fecha: string) => Dia;
};

export const NOMBRE: Record<Metrica, string> = {
  preparacion: 'Preparación', sueno: 'Sueño', fatiga: 'Fatiga', estres: 'Estrés', dolor: 'Dolor muscular', esfuerzo: 'Esfuerzo',
};

// Sentido de cada métrica: qué es «peor». Sueño y preparación: más es mejor.
// Fatiga, estrés y dolor (guardados 5 = mal): más es peor. Cargas: más es «rojo».
const SENTIDO: Record<Metrica, 'alto-bueno' | 'alto-malo'> = {
  preparacion: 'alto-bueno', sueno: 'alto-bueno', fatiga: 'alto-malo', estres: 'alto-malo', dolor: 'alto-malo', esfuerzo: 'alto-malo',
};

export const VENTANA_MOVIL = 28;  // días de la media móvil
export const VENTANA_MD = 90;     // días hacia atrás para la media por tipo de día
export const MINIMO = 8;          // con menos registros, «pocos datos»

const VACIO: Dia = { preparacion: null, sueno: null, fatiga: null, estres: null, dolor: null, rpe: null, minutos: null, esfuerzo: null, wAplica: true, rAplica: true };

export async function cargarDatos(desde: string, hasta: string, modos: { wellness?: string; rpe?: string }): Promise<Datos> {
  const [j, g, m, w, r, me, mj, ex, acts] = await Promise.all([
    supabase.from('perfiles').select('id,nombre,rol:roles!inner(es_jugador)').eq('rol.es_jugador', true).is('eliminado_en', null).order('nombre'),
    supabase.from('grupos').select('id,nombre').order('nombre'),
    supabase.from('grupo_miembros').select('grupo_id,perfil_id'),
    supabase.from('wellness').select('perfil_id,fecha,sueno,fatiga,estres,dolor,preparacion').gte('fecha', desde).lte('fecha', hasta),
    supabase.from('rpe').select('perfil_id,fecha,valor').gte('fecha', desde).lte('fecha', hasta),
    supabase.from('minutos_equipo').select('fecha,minutos').gte('fecha', desde).lte('fecha', hasta),
    supabase.from('minutos_jugador').select('perfil_id,fecha,minutos').gte('fecha', desde).lte('fecha', hasta),
    supabase.from('cuestionario_excepciones').select('fecha,cuestionario,perfil_id,aplica').gte('fecha', desde).lte('fecha', hasta),
    cargarActividades(iso(sumarDias(desdeIso(desde), -30)), iso(sumarDias(desdeIso(hasta), 30))).catch(() => []),
  ]);
  for (const x of [j, g, m, w, r, me, mj, ex]) if (x.error) throw x.error;

  const miembros = (m.data ?? []) as { grupo_id: string; perfil_id: string }[];
  const jugadores: Jugador[] = ((j.data ?? []) as unknown as { id: string; nombre: string }[])
    .map((p) => ({ id: p.id, nombre: p.nombre, grupos: miembros.filter((x) => x.perfil_id === p.id).map((x) => x.grupo_id) }));

  const k = (p: string, f: string) => `${p}|${f}`;
  const W = new Map<string, Record<string, number>>(); for (const x of (w.data ?? []) as Record<string, unknown>[]) W.set(k(x.perfil_id as string, x.fecha as string), x as Record<string, number>);
  const R = new Map<string, number>(); for (const x of (r.data ?? []) as { perfil_id: string; fecha: string; valor: number }[]) R.set(k(x.perfil_id, x.fecha), x.valor);
  const ME = new Map<string, number>(); for (const x of (me.data ?? []) as { fecha: string; minutos: number }[]) ME.set(x.fecha, x.minutos);
  const MJ = new Map<string, number>(); for (const x of (mj.data ?? []) as { perfil_id: string; fecha: string; minutos: number }[]) MJ.set(k(x.perfil_id, x.fecha), x.minutos);
  const EX = new Map<string, boolean>(); for (const x of (ex.data ?? []) as { fecha: string; cuestionario: string; perfil_id: string | null; aplica: boolean }[]) EX.set(`${x.cuestionario}|${x.perfil_id ?? '*'}|${x.fecha}`, x.aplica);
  const partidosLista = acts.filter((a) => a.es_partido).map((a) => a.fecha);
  const conActividad = new Set(acts.filter((a) => a.tipo === 'deportiva').map((a) => a.fecha));

  const aplica = (c: 'wellness' | 'rpe', p: string, f: string, modo?: string) => {
    const propio = EX.get(`${c}|${p}|${f}`); if (propio !== undefined) return propio;
    const eq = EX.get(`${c}|*|${f}`); if (eq !== undefined) return eq;
    return modo === 'todos' || (modo === 'con_actividad' && conActividad.has(f));
  };

  const cache = new Map<string, Dia>();
  const dia = (p: string, f: string): Dia => {
    const key = k(p, f);
    const c = cache.get(key); if (c) return c;
    const wx = W.get(key);
    const rpe = R.get(key) ?? null;
    const minutos = MJ.get(key) ?? ME.get(f) ?? null;
    const d: Dia = wx || rpe != null || minutos != null ? {
      preparacion: wx ? Number(wx.preparacion) : null, sueno: wx?.sueno ?? null, fatiga: wx?.fatiga ?? null, estres: wx?.estres ?? null, dolor: wx?.dolor ?? null,
      rpe, minutos, esfuerzo: rpe != null && minutos != null ? rpe * minutos : null,
      wAplica: aplica('wellness', p, f, modos.wellness), rAplica: aplica('rpe', p, f, modos.rpe),
    } : { ...VACIO, wAplica: aplica('wellness', p, f, modos.wellness), rAplica: aplica('rpe', p, f, modos.rpe) };
    cache.set(key, d);
    return d;
  };

  return { desde, hasta, jugadores, grupos: (g.data ?? []) as { id: string; nombre: string }[], partidos: partidosLista, dia };
}

// ---------- Estadística ----------

export type Ref = { media: number | null; de: number | null; n: number };
export function resumen(xs: number[]): Ref {
  const n = xs.length;
  if (!n) return { media: null, de: null, n };
  const media = xs.reduce((a, b) => a + b, 0) / n;
  const de = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - media) ** 2, 0) / (n - 1)) : null;
  return { media, de, n };
}
export const valor = (d: Dia, m: Metrica) => d[m];

export function diasEntre(desde: string, hasta: string): string[] {
  const out: string[] = []; let d = desdeIso(desde); const fin = desdeIso(hasta);
  while (d <= fin) { out.push(iso(d)); d = sumarDias(d, 1); }
  return out;
}

// Media móvil de los 28 días anteriores (sin contar el día), solo días con dato.
export function refMovil(datos: Datos, p: string, fecha: string, m: Metrica): Ref {
  const xs: number[] = [];
  for (let i = 1; i <= VENTANA_MOVIL; i++) { const v = datos.dia(p, iso(sumarDias(desdeIso(fecha), -i)))[m]; if (v != null) xs.push(v); }
  return resumen(xs);
}

// Media del jugador en el mismo tipo de día (MD), en los 90 días anteriores.
export function refMD(datos: Datos, p: string, fecha: string, m: Metrica): Ref {
  const md = etiquetaMD(fecha, datos.partidos);
  const xs: number[] = [];
  for (let i = 1; i <= VENTANA_MD; i++) {
    const f = iso(sumarDias(desdeIso(fecha), -i));
    if (etiquetaMD(f, datos.partidos) !== md) continue;
    const v = datos.dia(p, f)[m]; if (v != null) xs.push(v);
  }
  return resumen(xs);
}

// ---------- Semáforo ----------
// Rojo = siempre malo. Wellness: rojo si está más de 1 DE peor que su media, azul si más de 1 DE mejor.
// Cargas: rojo por encima de +1 DE, azul por debajo de −1 DE. Verde en el medio.
export type Tono = 'rojo' | 'verde' | 'azul';
export const TONOS: Record<Tono, { bg: string; fg: string; nombre: string }> = {
  rojo: { bg: '#FDE3E6', fg: '#8F0E1F', nombre: 'fuera de lo habitual (peor)' },
  verde: { bg: '#DDF3E4', fg: '#1D5C32', nombre: 'dentro de lo habitual' },
  azul: { bg: '#DCE7FF', fg: '#1E3A8A', nombre: 'fuera de lo habitual (mejor / menos carga)' },
};
export function semaforo(v: number | null, ref: Ref, m: Metrica): Tono | null {
  if (v == null || ref.media == null || ref.de == null) return null;
  if (ref.de === 0) return 'verde';
  const z = (v - ref.media) / ref.de;
  const malo = SENTIDO[m] === 'alto-malo' ? z > 1 : z < -1;
  const bueno = SENTIDO[m] === 'alto-malo' ? z < -1 : z > 1;
  return malo ? 'rojo' : bueno ? 'azul' : 'verde';
}

export const fmt = (n: number | null | undefined, d = 1) => (n == null ? '—' : Number(n).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }));

// ---------- Periodos ----------
export type ModoPeriodo = 'partidos' | 'semana' | 'rango';
export type Periodo = { modo: ModoPeriodo; desde: string; hasta: string };

export function semanaDe(f: string): { desde: string; hasta: string; numero: number } {
  const d = desdeIso(f); const lunes = sumarDias(d, -((d.getDay() + 6) % 7));
  const jueves = sumarDias(lunes, 3);
  const enero1 = new Date(jueves.getFullYear(), 0, 1);
  const numero = 1 + Math.floor((jueves.getTime() - enero1.getTime()) / 86400000 / 7);
  return { desde: iso(lunes), hasta: iso(sumarDias(lunes, 6)), numero };
}

// Del día siguiente al partido anterior hasta el próximo partido (incluido).
export function entrePartidos(f: string, partidos: string[]): { desde: string; hasta: string } {
  const ord = [...new Set(partidos)].sort();
  const siguiente = ord.find((p) => p >= f);
  const anterior = [...ord].reverse().find((p) => p < (siguiente ?? f) && p < f) ?? ord.filter((p) => p < f).pop();
  const desde = anterior ? iso(sumarDias(desdeIso(anterior), 1)) : iso(sumarDias(desdeIso(f), -6));
  const hasta = siguiente ?? iso(sumarDias(desdeIso(desde), 6));
  return { desde, hasta };
}
