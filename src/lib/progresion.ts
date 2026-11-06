// Progresión asistida con las reglas de Mariano:
// - RPE 1–5 → subir lo mínimo. RPE 6–8 → mantener. RPE 9–10 → mantener (o bajar, si lo elegís).
// - La base son los kilos que la persona cargó de verdad (no los que estaban escritos).
// - Fuerza (≤ 6 reps): +1 rep hasta 5; desde ahí, el salto mínimo de carga.
// - Estructura / hipertrofia (≥ 7 reps): +2 reps hasta 10; desde ahí, más kilos y vuelve a 6.
// - Sin kilos: reps (o +5 s si es por tiempo).
// - Sin RPE o sin registro: mantener. Un dato que falta nunca cuenta como «fácil».
// - Aprende: si con un RPE dado corregiste la propuesta casi siempre igual (≥ 60 %, al menos 2 veces),
//   la próxima vez propone lo que elegiste vos.
import type { Ejercicio, Item, Serie } from './workout';

export type Decision = 'subir' | 'mantener' | 'bajar';
export type Ficha = {
  objetivo: string | null; deporte: string | null; dias_semana: number | null; lesiones: string | null; nivel: number | null;
  descansos: boolean; salto_barra: number; salto_mancuerna: number; salto_maquina: number; notas: string | null;
};
export type Antecedente = { rpe: number | null; propuesta: Decision; elegida: Decision };

export const FICHA_VACIA: Ficha = {
  objetivo: null, deporte: null, dias_semana: null, lesiones: null, nivel: null, descansos: true,
  salto_barra: 5, salto_mancuerna: 2.5, salto_maquina: 5, notas: null,
};

export const porDefecto = (rpe: number | null | undefined): Decision => (rpe != null && rpe <= 5 ? 'subir' : 'mantener');

// Lo que aprendió de tus correcciones, por valor de RPE.
export function aprendido(hist: Antecedente[]): Map<number, { decision: Decision; n: number }> {
  const out = new Map<number, { decision: Decision; n: number }>();
  const porRpe = new Map<number, Antecedente[]>();
  for (const h of hist) if (h.rpe != null) porRpe.set(h.rpe, [...(porRpe.get(h.rpe) ?? []), h]);
  for (const [rpe, hs] of porRpe) {
    const recientes = hs.slice(0, 10); // las últimas 10 pesan; si cambiás de criterio, se adapta
    if (recientes.length < 2) continue;
    for (const d of ['subir', 'mantener', 'bajar'] as Decision[]) {
      const n = recientes.filter((h) => h.elegida === d).length;
      if (n / recientes.length >= 0.6 && d !== porDefecto(rpe)) out.set(rpe, { decision: d, n: recientes.length });
    }
  }
  return out;
}

export function proponer(rpe: number | null | undefined, registrado: boolean, ap: Map<number, { decision: Decision; n: number }>): { decision: Decision; motivo: string } {
  if (!registrado) return { decision: 'mantener', motivo: 'No lo registró' };
  if (rpe == null) return { decision: 'mantener', motivo: 'Sin RPE' };
  const a = ap.get(rpe);
  if (a) return { decision: a.decision, motivo: `Aprendido: con RPE ${rpe} solés ${a.decision === 'subir' ? 'subirle' : a.decision === 'bajar' ? 'bajarle' : 'mantenerle'}` };
  return { decision: porDefecto(rpe), motivo: rpe <= 5 ? `RPE ${rpe}: fácil` : rpe <= 8 ? `RPE ${rpe}: justo` : `RPE ${rpe}: muy duro` };
}

// El salto mínimo de carga según el material del ejercicio.
export function salto(ej: Pick<Ejercicio, 'implemento'> | undefined, nombre: string, f: Ficha): { kg: number; que: string } {
  const imp = (ej?.implemento ?? '').toLowerCase();
  const n = nombre.toLowerCase();
  if (imp === 'barra' || /\b(barra|bar|trap|landmine)\b/.test(n)) return { kg: f.salto_barra, que: 'barra' };
  if (imp.includes('mancuerna') || /mancuern|\bdb\b|\bkb\b|dumbbell|kettlebell|pesa rusa/.test(n)) return { kg: f.salto_mancuerna, que: 'mancuerna' };
  return { kg: f.salto_maquina, que: 'otro' };
}

const entero = (t: string | undefined) => (t && /^\s*\d+\s*$/.test(t) ? Number(t) : null);
const redondear = (kg: number) => Math.round(kg * 4) / 4;

export function prescritas(it: Item): Serie[] {
  const n = it.series || it.detalle.length;
  return Array.from({ length: n }, (_, i) => it.detalle[i] ?? it.detalle[it.detalle.length - 1] ?? { reps: it.reps ?? '', kg: null });
}

// Devuelve la dosis de la semana siguiente (no cambia el ejercicio).
export function aplicar(it: Item, hecho: Serie[] | null | undefined, d: Decision, paso: number): { detalle: Serie[]; nota: string } {
  const base = prescritas(it).map((p, i) => ({ ...p, reps: p.reps, kg: hecho?.[i]?.kg ?? p.kg }));   // el tempo se conserva
  if (!base.length) return { detalle: base, nota: '' };
  if (d === 'mantener') return { detalle: base, nota: '' };
  const conKg = base.some((s) => s.kg != null && s.kg > 0);
  const seg = it.config?.unidad === 'seg';
  const masKg = (s: Serie, signo: 1 | -1) => (s.kg != null && s.kg > 0 ? { ...s, kg: Math.max(0, redondear(s.kg + signo * paso)) } : s);
  const reps = (s: Serie, delta: number, min = 1) => { const r = entero(s.reps); return r == null ? s : { ...s, reps: String(Math.max(min, r + delta)) }; };

  if (d === 'bajar') {
    if (conKg) return { detalle: base.map((s) => masKg(s, -1)), nota: `−${String(paso).replace('.', ',')} kg` };
    return seg ? { detalle: base.map((s) => reps(s, -5, 5)), nota: '−5 s' } : { detalle: base.map((s) => reps(s, -2)), nota: '−2 reps' };
  }
  // Subir
  if (seg) return { detalle: base.map((s) => reps(s, 5)), nota: '+5 s' };
  const r = Math.max(...base.map((s) => entero(s.reps) ?? -1));
  if (r < 0) return conKg ? { detalle: base.map((s) => masKg(s, 1)), nota: `+${String(paso).replace('.', ',')} kg` } : { detalle: base, nota: 'Reps no numéricas: cambialo a mano' };
  if (r <= 6) { // fuerza
    if (r < 5 || !conKg) return { detalle: base.map((s) => reps(s, 1)), nota: '+1 rep' };
    return { detalle: base.map((s) => masKg(s, 1)), nota: `+${String(paso).replace('.', ',')} kg` };
  }
  // estructura / hipertrofia
  if (r + 2 <= 10 || !conKg) return { detalle: base.map((s) => reps(s, 2)), nota: '+2 reps' };
  return { detalle: base.map((s) => ({ ...masKg(s, 1), reps: entero(s.reps) != null ? '6' : s.reps })), nota: `+${String(paso).replace('.', ',')} kg y vuelve a 6 reps` };
}

export function textoDosis(series: Serie[], seg = false): string {
  if (!series.length) return '—';
  const reps = new Set(series.map((s) => s.reps)).size === 1 ? (series[0].reps || '—') : series.map((s) => s.reps || '—').join('-');
  const kgs = series.map((s) => (s.kg == null ? null : String(s.kg).replace('.', ',')));
  const conKg = kgs.some((k) => k != null);
  const kg = !conKg ? '' : new Set(kgs).size === 1 ? ` · ${kgs[0]} kg` : ` · ${kgs.map((k) => k ?? '—').join('-')} kg`;
  return `${series.length} × ${reps}${seg ? ' s' : ''}${kg}`;
}
