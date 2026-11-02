// "Armar plan": arma la semana 1 (y la progresión de N semanas) con las reglas de Mariano.
// Reglas (ver claude/cerebro/reglas_de_planificacion.md en el proyecto):
// - Siempre cuerpo completo; 4–6 ejercicios de trabajo por sesión (sin contar activación).
// - Bloque principal = pares cruzados: empuje + cadera dominante / tracción + rodilla dominante.
// - Bloque auxiliar = los patrones opuestos al principal, a un brazo / una pierna, + core.
// - Activación según los patrones del día (empuje → hombro; rodilla → tobillo/cadera; cadera → cadera/tronco).
// - La semana recorre la curva fuerza-velocidad (integración vertical): estructura → fuerza → potencia.
//   Plio-iso intensivo va antes del principal; extensivo / iso hold al final.
// - 2 días: alterna los pares. 3 días: el tercero con más potencia. 4 días: un patrón principal por día.
// - Mismo contenido para todos; cambia la dosis según el objetivo.
import { nuevoId, normalizar, type Ejercicio, type Item } from './workout';
import { claveDia } from './programas';

export type Objetivo = 'salud' | 'futbol' | 'rugby' | 'basquet' | 'mantenimiento';
export const OBJETIVOS: [Objetivo, string][] = [
  ['salud', 'Salud / calidad de vida'], ['futbol', 'Fútbol'], ['rugby', 'Rugby'], ['basquet', 'Básquet'], ['mantenimiento', 'Mantenerse activo'],
];
export type Opciones = { nombre: string; objetivo: Objetivo; dias: number; semanas: number; plio: boolean; descansos: boolean };

type Patron = 'empuje' | 'traccion' | 'rodilla' | 'cadera';
type Fase = 'estructura' | 'fuerza' | 'potencia';
const CAT: Record<Patron, string> = {
  empuje: 'Tren superior: empuje', traccion: 'Tren superior: tracción',
  rodilla: 'Tren inferior: rodilla dominante', cadera: 'Tren inferior: cadera dominante',
};
const OPUESTO: Record<Patron, Patron> = { empuje: 'traccion', traccion: 'empuje', rodilla: 'cadera', cadera: 'rodilla' };
const RE_ZONA: Record<string, RegExp> = { hombro: /shoulder|t spine|scap|thoracic|windmill|halo/, tobillo: /ankle|dorsiflexion/, cadera: /hip|90 90|shin box|couch|hinge/ };
const NOMBRE_PATRON: Record<Patron, string> = { empuje: 'Empuje', traccion: 'Tracción', rodilla: 'Rodilla dominante', cadera: 'Cadera dominante' };

// Repertorio de Mariano (lo que más usa en TeamBuildr): sube a estos ejercicios en el orden de preferencia.
const REPERTORIO = [
  'barbell bench press', 'kb db 2 arm bench press', 'kb db alternating bench press', 'barbell military press', 'kb db 2 arm military press',
  'barbell deadlift', 'barbell hip thrust', 'barbell romanian deadlift', 'kb db 2 arm romanian deadlift', 'b stance hip thrust',
  'barbell back squat', 'barbell front squat', 'goblet squat', 'goblet box squat', 'barbell box squat',
  'barbell bent over row', 'pull up', 'chin up', 'inverted row', 'kb db 2 arm bent over row',
  'kb db 1 arm bench press', 'kb db 1 arm military press', 'landmine', 'kb db 1 arm hetero single leg deadlift', 'kb db 1 arm single leg deadlift',
  'step up', 'step down', 'cossack', 'reverse lunge', 'split squat', 'bulgarian', 'gorilla row', '3 point', '1 arm row', 'single arm row',
  'eccentric slide board hamstring curl', 'single leg hip thrust',
];
const prioridad = (e: Ejercicio) => {
  const n = normalizar(e.nombre);
  const i = REPERTORIO.findIndex((r) => n.includes(r));
  return i < 0 ? 999 : i;
};

// Dosis por objetivo y fase: [series, reps] del principal; auxiliar aparte.
const DOSIS: Record<Objetivo, Record<Fase, [number, number]>> = {
  salud: { estructura: [3, 8], fuerza: [4, 6], potencia: [4, 5] },
  futbol: { estructura: [3, 8], fuerza: [4, 5], potencia: [4, 4] },
  basquet: { estructura: [3, 8], fuerza: [4, 5], potencia: [4, 4] },
  rugby: { estructura: [3, 10], fuerza: [4, 6], potencia: [4, 4] },
  mantenimiento: { estructura: [3, 8], fuerza: [3, 8], potencia: [3, 6] },
};
const AUX: Record<Objetivo, [number, number]> = { salud: [3, 8], futbol: [3, 8], basquet: [3, 8], rugby: [3, 10], mantenimiento: [3, 8] };

// Qué patrones principales y qué fase tiene cada día según cuántos días entrena.
function esquemaSemana(dias: number, deportista: boolean): { dia: number; principal: Patron[]; fase: Fase }[] {
  const A: Patron[] = ['empuje', 'cadera'], B: Patron[] = ['traccion', 'rodilla'];
  if (dias <= 2) return [{ dia: 0, principal: A, fase: 'estructura' }, { dia: 3, principal: B, fase: deportista ? 'potencia' : 'fuerza' }];
  if (dias === 3) return [
    { dia: 0, principal: A, fase: 'estructura' }, { dia: 2, principal: B, fase: 'fuerza' }, { dia: 4, principal: A, fase: 'potencia' },
  ];
  return [
    { dia: 0, principal: ['empuje'], fase: 'estructura' }, { dia: 1, principal: ['rodilla'], fase: 'estructura' },
    { dia: 3, principal: ['traccion'], fase: 'fuerza' }, { dia: 4, principal: ['cadera'], fase: 'potencia' },
  ];
}

const breakDe = (nombre: string): Item => ({
  id: nuevoId(), tipo: 'break', bloque: 'Bloque principal', ejercicio_id: null, nombre, series: 0, reps: '',
  cada_lado: false, con_carga: false, detalle: [], descanso_seg: null, nota: '', origen_id: null, modificado: false, config: {},
});
function item(e: Ejercicio, series: number, reps: number, opts: { seg?: boolean; descanso?: number | null; hueco: string; ladoAuto?: boolean }): Item {
  const cadaLado = opts.ladoAuto !== false && e.lateralidad === 'Unilateral';
  return {
    id: nuevoId(), tipo: 'ejercicio', bloque: 'Bloque principal', ejercicio_id: e.id, nombre: e.nombre, series, reps: String(reps),
    cada_lado: cadaLado, con_carga: false,
    detalle: Array.from({ length: series }, () => ({ reps: String(reps), kg: null })),
    descanso_seg: opts.descanso ?? null, nota: '', origen_id: null, modificado: false,
    config: { ...(opts.seg ? { unidad: 'seg' as const } : {}), hueco: opts.hueco } as Item['config'],
  };
}

export function armarPlan(bib: Ejercicio[], uso: Record<string, number>, op: Opciones): { dias: Record<string, Item[]>; resumen: string[] } {
  const vivos = bib.filter((e) => !e.eliminado_en);
  const deportista = op.objetivo !== 'salud' && op.objetivo !== 'mantenimiento';
  const usados = new Set<string>();
  const orden = (a: Ejercicio, b: Ejercicio) => (uso[b.id] ?? 0) - (uso[a.id] ?? 0) || prioridad(a) - prioridad(b) || a.nombre.localeCompare(b.nombre);
  // Elige el mejor candidato no usado todavía en el plan (así el día 3 no repite el día 1).
  const elegir = (filtro: (e: Ejercicio) => boolean, evitar = true): Ejercicio | null => {
    const c = vivos.filter(filtro).sort(orden);
    const e = (evitar ? c.find((x) => !usados.has(x.id)) : null) ?? c[0] ?? null;
    if (e) usados.add(e.id);
    return e;
  };
  const dePatron = (p: Patron, lat: 'Unilateral' | 'Bilateral' | null) => (e: Ejercicio) =>
    e.categoria === CAT[p] && (!lat || e.lateralidad === lat) && e.contraccion !== 'Isométrico';
  const nombre = (re: RegExp) => (e: Ejercicio) => re.test(normalizar(e.nombre));

  const desc = (s: number) => (op.descansos ? s : null);
  const resumen: string[] = [];
  const dias: Record<string, Item[]> = {};
  const esquema = esquemaSemana(op.dias, deportista);

  esquema.forEach(({ dia, principal, fase }) => {
    const its: Item[] = [];
    // 1) Activación: movilidad según los patrones + estabilidad (core).
    its.push(breakDe('Activación'));
    const zonas = new Set<string>();
    principal.forEach((p) => { if (p === 'empuje' || p === 'traccion') zonas.add('hombro'); if (p === 'rodilla') { zonas.add('tobillo'); zonas.add('cadera'); } if (p === 'cadera') zonas.add('cadera'); });
    [...zonas].slice(0, 2).forEach((z) => {
      const e = elegir((x) => x.categoria === 'Movilidad' && RE_ZONA[z].test(normalizar(x.nombre)));
      if (e) its.push(item(e, 1, 8, { hueco: `Movilidad · ${z}` }));
    });
    const est = elegir((x) => x.categoria === 'Core' && /dead bug|bird dog|plank|pallof|hollow/.test(normalizar(x.nombre)));
    if (est) its.push(item(est, 2, 8, { hueco: 'Estabilidad · core' }));

    // 2) Plio-iso intensivo antes del principal (día de potencia).
    if (op.plio && fase === 'potencia') {
      its.push(breakDe('Plio-iso'));
      const p1 = elegir(nombre(/broad jump|counter movement|box jump|drop jump \+ vertical|squat jump/)) ?? elegir((x) => x.categoria === 'Saltos / pliometría');
      if (p1) its.push(item(p1, 4, 3, { hueco: 'Plio intensivo', descanso: desc(90) }));
      const p2 = elegir((x) => x.categoria === 'Levantamientos olímpicos' && /hang power clean|high pull|swing/.test(normalizar(x.nombre)))
        ?? elegir((x) => x.categoria === 'Lanzamientos');
      if (p2) its.push(item(p2, 3, 4, { hueco: 'Olímpico / lanzamiento', descanso: desc(90) }));
    }

    // 3) Bloque principal.
    its.push(breakDe('Bloque principal'));
    const [s, r] = DOSIS[op.objetivo][fase];
    principal.forEach((p) => {
      const e = elegir(dePatron(p, 'Bilateral')) ?? elegir(dePatron(p, null));
      if (e) its.push(item(e, s, r, { hueco: `${NOMBRE_PATRON[p]} · principal`, descanso: desc(fase === 'estructura' ? 90 : 120) }));
    });

    // 4) Bloque auxiliar: patrones opuestos, a un brazo / una pierna, + core.
    its.push(breakDe('Bloque auxiliar'));
    const [sa, ra] = AUX[op.objetivo];
    const aux: Patron[] = principal.length === 1
      ? [OPUESTO[principal[0]], principal[0] === 'empuje' || principal[0] === 'traccion' ? 'rodilla' : 'empuje']
      : principal.map((p) => OPUESTO[p]);
    aux.forEach((p) => {
      const e = elegir(dePatron(p, 'Unilateral')) ?? elegir(dePatron(p, null));
      if (e) its.push(item(e, sa, ra, { hueco: `${NOMBRE_PATRON[p]} · auxiliar (1 brazo / 1 pierna)`, descanso: desc(60) }));
    });
    const core = elegir((x) => x.categoria === 'Core' && /pallof/.test(normalizar(x.nombre)))
      ?? elegir((x) => x.categoria === 'Core' && /suitcase|farmer|carry|side plank/.test(normalizar(x.nombre)))
      ?? elegir((x) => x.categoria === 'Core');
    if (core) its.push(item(core, sa, /hold|carry|walk|plank/.test(normalizar(core.nombre)) ? 20 : ra, { seg: /hold|plank/.test(normalizar(core.nombre)), hueco: 'Core · antirrotación / carga', descanso: desc(60) }));

    // 5) Extensivo / iso hold al final (días de estructura y fuerza).
    if (op.plio && fase !== 'potencia') {
      const ext = fase === 'estructura'
        ? elegir((x) => x.contraccion === 'Isométrico' && (x.categoria === CAT.rodilla || x.categoria === CAT.cadera || x.categoria === 'Gemelos y sóleo'))
        : elegir(nombre(/50%|multiple|pogo|skip/)) ?? elegir((x) => x.categoria === 'Saltos / pliometría');
      if (ext) {
        its.push(breakDe(fase === 'estructura' ? 'Iso hold' : 'Plio extensivo'));
        its.push(item(ext, fase === 'estructura' ? 3 : 3, fase === 'estructura' ? 30 : 8, { seg: fase === 'estructura', hueco: fase === 'estructura' ? 'Iso hold' : 'Plio extensivo' }));
      }
    }
    dias[claveDia(1, dia)] = its;
    resumen.push(`${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'][dia]}: ${principal.map((p) => NOMBRE_PATRON[p]).join(' + ')} · ${fase}`);
  });

  // Semanas 2..N: copia de la semana 1 con la progresión de Mariano (sin kilos: los pone cada persona).
  // Principal: +1 serie desde la semana 3 (máx. 5). Fuerza/potencia: +1 rep cada 2 semanas hasta 6.
  // Estructura e hipertrofia (auxiliar): +2 reps cada 2 semanas hasta 10–12. Activación y plio sin cambios.
  for (let w = 2; w <= op.semanas; w++) {
    esquema.forEach(({ dia, fase }) => {
      let bloque = '';
      dias[claveDia(w, dia)] = dias[claveDia(1, dia)].map((it) => {
        if (it.tipo === 'break') { bloque = it.nombre; return { ...it, id: nuevoId() }; }
        const base = Number(it.reps) || 0;
        let series = it.series; let reps = base;
        const paso = Math.floor((w - 1) / 2);
        if (bloque === 'Bloque principal' && it.config?.unidad !== 'seg') {
          if (w >= 3) series = Math.min(it.series + 1, 5);
          reps = fase === 'estructura' ? Math.min(base + 2 * paso, Math.max(base, 10)) : Math.min(base + paso, Math.max(base, 6));
          if (reps < base) reps = base;
        } else if (bloque === 'Bloque auxiliar' && it.config?.unidad !== 'seg') {
          reps = Math.min(base + 2 * paso, Math.max(base, 10));
        }
        return { ...it, id: nuevoId(), series, reps: String(reps), detalle: Array.from({ length: series }, () => ({ reps: String(reps), kg: null })) };
      });
    });
  }
  return { dias, resumen };
}

// Otros ejercicios que sirven para el mismo hueco (para cambiar rápido).
export function alternativas(bib: Ejercicio[], it: Item): Ejercicio[] {
  const e = bib.find((x) => x.id === it.ejercicio_id);
  if (!e) return [];
  const zona = Object.keys(RE_ZONA).find((z) => it.config?.hueco?.includes(z));
  return bib.filter((x) => !x.eliminado_en && x.id !== e.id && x.categoria === e.categoria
    && (!zona || e.categoria !== 'Movilidad' || RE_ZONA[zona].test(normalizar(x.nombre)))
    && (e.categoria?.startsWith('Tren') ? x.lateralidad === e.lateralidad : true)
    && (x.contraccion === 'Isométrico') === (e.contraccion === 'Isométrico'))
    .sort((a, b) => prioridad(a) - prioridad(b) || a.nombre.localeCompare(b.nombre));
}
