import { createClient } from '@supabase/supabase-js';

// Claves públicas (se pueden ver en el navegador). La seguridad la ponen las reglas de la base de datos.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://dpminerxndpjqillozqo.supabase.co';
const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_mJQtrQeXlzI3dG7hvOAXFQ_-wRU_8NB';

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export function mensajeError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/Invalid login credentials/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/already registered|already been registered/i.test(m)) return 'Ese email ya tiene cuenta. Inicia sesión.';
  if (/Password should be at least/i.test(m)) return 'La contraseña debe tener al menos 8 caracteres.';
  if (/Email not confirmed/i.test(m)) return 'Falta confirmar el email.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'No hay conexión con el servidor. Revisa internet y vuelve a probar.';
  if (/duplicate key/i.test(m)) return 'Ya existe uno con ese nombre.';
  return m;
}
