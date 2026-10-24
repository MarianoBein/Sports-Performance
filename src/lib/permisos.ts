import type { CSSProperties } from 'react';

export type Modulo = 'calendario' | 'sports_science' | 'workout_builder' | 'estadisticas' | 'usuarios';
export type Nivel = 'sin' | 'ver' | 'propio' | 'editar';
export type Permiso = { nivel: Nivel; exporta: boolean };
export type Permisos = Record<Modulo, Permiso>;

export const MODULOS: { clave: Modulo; nombre: string }[] = [
  { clave: 'calendario', nombre: 'Calendario' },
  { clave: 'sports_science', nombre: 'Sports Science Hub' },
  { clave: 'workout_builder', nombre: 'Workout Builder' },
  { clave: 'estadisticas', nombre: 'Estadísticas' },
  { clave: 'usuarios', nombre: 'Usuarios' },
];

export const NIVELES: { clave: Nivel; nombre: string; corto: string }[] = [
  { clave: 'sin', nombre: 'Sin acceso', corto: '—' },
  { clave: 'ver', nombre: 'Ver', corto: 'Ve' },
  { clave: 'propio', nombre: 'Solo lo suyo', corto: 'Lo suyo' },
  { clave: 'editar', nombre: 'Ver y editar', corto: 'Edita' },
];

export const ESTILO_NIVEL: Record<Nivel, CSSProperties> = {
  editar: { background: '#16181D', color: '#fff' },
  ver: { background: 'var(--blue-bg)', color: 'var(--blue-fg)' },
  propio: { background: 'var(--violet-bg)', color: 'var(--violet-fg)' },
  sin: { background: '#F1EFEA', color: 'var(--muted)' },
};

const TODO: Permiso = { nivel: 'editar', exporta: true };
const NADA: Permiso = { nivel: 'sin', exporta: false };

export function permisosEfectivos(rolPermisos: Partial<Permisos>, ajustados: Partial<Permisos> | null, esAdmin: boolean): Permisos {
  const out = {} as Permisos;
  for (const m of MODULOS) {
    out[m.clave] = esAdmin ? TODO : (ajustados?.[m.clave] ?? rolPermisos?.[m.clave] ?? NADA);
  }
  return out;
}

export function puede(p: Permisos, m: Modulo): boolean {
  return p[m].nivel !== 'sin';
}
