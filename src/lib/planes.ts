// Herencia de planes: equipo → grupo → jugador.
// El equipo es la base. Un grupo o un jugador hereda el día de su nivel superior
// hasta que lo cambiás; ahí se guarda una copia propia que manda para ellos.
import { nuevoId, type Destino, type Item } from './workout';

export type Mapa = Record<string, Item[]>; // «clave|fecha» → ejercicios del día (solo los días propios)
export type Ctx = { gruposDe: (jugador: string) => string[] }; // grupos del jugador, ordenados por nombre
export type Conflicto = { clave: string; fecha: string; tipo: 'cambiar' | 'borrar'; padre: Item };

export const llave = (clave: string, fecha: string) => `${clave}|${fecha}`;

export function destinosDe(clave: string): Destino[] {
  if (clave === 'equipo') return [{ tipo: 'equipo' }];
  const [t, ref] = clave.split(':');
  return [{ tipo: t as 'grupo' | 'persona', ref }];
}

// ¿De quién hereda este plan ese día?
export function padre(clave: string, fecha: string, m: Mapa, ctx: Ctx): string | null {
  if (clave === 'equipo') return null;
  if (clave.startsWith('grupo:')) return 'equipo';
  const j = clave.slice('persona:'.length);
  for (const g of ctx.gruposDe(j)) if (m[llave(`grupo:${g}`, fecha)]) return `grupo:${g}`;
  return 'equipo';
}

export function efectivo(clave: string, fecha: string, m: Mapa, ctx: Ctx): { items: Item[]; desde: string; propio: boolean } {
  const propios = m[llave(clave, fecha)];
  if (propios) return { items: propios, desde: clave, propio: true };
  const p = padre(clave, fecha, m, ctx);
  if (!p) return { items: [], desde: clave, propio: true };
  const e = efectivo(p, fecha, m, ctx);
  return { items: e.items, desde: e.desde, propio: false };
}

const copia = (it: Item): Item => ({ ...it, id: nuevoId(), origen_id: it.id, modificado: false, detalle: it.detalle.map((s) => ({ ...s })), config: { ...(it.config ?? {}) } });

// Convierte el día heredado en propio (copiando lo de arriba). Muta «m».
export function materializar(clave: string, fecha: string, m: Mapa, ctx: Ctx): Item[] {
  const k = llave(clave, fecha);
  if (!m[k]) m[k] = efectivo(clave, fecha, m, ctx).items.map(copia);
  return m[k];
}

export function contenido(it: Item): string {
  const { tipo, ejercicio_id, nombre, series, reps, cada_lado, con_carga, detalle, descanso_seg, nota, config } = it;
  return JSON.stringify([tipo, ejercicio_id, nombre, series, reps, cada_lado, con_carga, detalle, descanso_seg, nota, config ?? {}]);
}

// En un nivel inferior, lo que cambiaste de una copia queda marcado como «modificado».
export function marcarModificados(clave: string, viejo: Item[], nuevo: Item[]): Item[] {
  if (clave === 'equipo') return nuevo;
  const antes = new Map(viejo.map((i) => [i.id, i]));
  let cambio = false;
  const out = nuevo.map((n) => {
    const v = antes.get(n.id);
    if (n.origen_id && !n.modificado && v && contenido(v) !== contenido(n)) { cambio = true; return { ...n, modificado: true }; }
    return n;
  });
  return cambio ? out : nuevo;
}

function hijos(clave: string, fecha: string, m: Mapa, ctx: Ctx): string[] {
  const out: string[] = [];
  for (const k of Object.keys(m)) {
    const [c, f] = k.split('|');
    if (f === fecha && c !== clave && padre(c, fecha, m, ctx) === clave) out.push(c);
  }
  return out;
}

// Baja a los niveles inferiores lo que cambió en «clave» ese día. Muta «m» y junta los choques.
export function propagar(clave: string, fecha: string, viejo: Item[], nuevo: Item[], m: Mapa, ctx: Ctx, conflictos: Conflicto[]) {
  const antes = new Map(viejo.map((i) => [i.id, i]));
  const ahora = new Map(nuevo.map((i) => [i.id, i]));
  for (const h of hijos(clave, fecha, m, ctx)) {
    const k = llave(h, fecha);
    const original = m[k];
    const res = [...original];
    let cambio = false;
    const idx = (origen: string) => res.findIndex((x) => x.origen_id === origen);

    for (const v of viejo) {
      if (ahora.has(v.id)) continue;
      const i = idx(v.id);
      if (i < 0) continue;
      if (!res[i].modificado) { res.splice(i, 1); cambio = true; } else conflictos.push({ clave: h, fecha, tipo: 'borrar', padre: v });
    }
    for (const n of nuevo) {
      const v = antes.get(n.id);
      if (!v || contenido(v) === contenido(n)) continue;
      const i = idx(n.id);
      if (i < 0) continue;
      if (!res[i].modificado) { res[i] = { ...copia(n), id: res[i].id }; cambio = true; } else conflictos.push({ clave: h, fecha, tipo: 'cambiar', padre: n });
    }
    nuevo.forEach((n, i) => {
      if (antes.has(n.id) || idx(n.id) >= 0) return;
      let pos = -1;
      for (let j = i - 1; j >= 0 && pos < 0; j--) { const p = idx(nuevo[j].id); if (p >= 0) pos = p + 1; }
      for (let j = i + 1; j < nuevo.length && pos < 0; j++) { const p = idx(nuevo[j].id); if (p >= 0) pos = p; }
      res.splice(pos < 0 ? res.length : pos, 0, copia(n));
      cambio = true;
    });
    if (cambio) { m[k] = res; propagar(h, fecha, original, res, m, ctx, conflictos); }
  }
}

// Aplica los choques que el PF eligió (pisa lo personalizado con lo de arriba).
export function aplicarConflictos(lista: Conflicto[], m: Mapa, ctx: Ctx, otros: Conflicto[]) {
  const porDia = new Map<string, Conflicto[]>();
  for (const c of lista) { const k = llave(c.clave, c.fecha); porDia.set(k, [...(porDia.get(k) ?? []), c]); }
  for (const [k, cs] of porDia) {
    const original = m[k];
    if (!original) continue;
    let res = [...original];
    for (const c of cs) {
      const i = res.findIndex((x) => x.origen_id === c.padre.id);
      if (i < 0) continue;
      if (c.tipo === 'borrar') res = res.filter((_, j) => j !== i);
      else res[i] = { ...copia(c.padre), id: res[i].id };
    }
    m[k] = res;
    propagar(cs[0].clave, cs[0].fecha, original, res, m, ctx, otros);
  }
}
