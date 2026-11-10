import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { permisosEfectivos, type Permisos } from './permisos';

export type Rol = { id: string; clave: string; nombre: string; es_jugador: boolean; permisos: Permisos };
export type Club = { id: string; nombre: string; sede_local: string | null; temporada: string | null; logo_club_url?: string | null; logo_liga_url?: string | null; wellness_modo?: string; rpe_modo?: string; rpe_retraso_min?: number; hora_aviso_wellness?: string; fuentes?: { gps?: boolean; fuerza?: boolean }; rpe_ejercicio?: boolean };
export type Perfil = {
  id: string; club_id: string; nombre: string; email: string; rol_id: string;
  es_admin: boolean; permisos_ajustados: Partial<Permisos> | null; eliminado_en: string | null; debe_cambiar_clave?: boolean; consentimiento_en?: string | null;
  rol: Rol; club: Club;
};

export type Organizacion = { perfil_id: string; club_id: string; club: string; rol: string; es_admin: boolean; activa: boolean };

type Ctx = {
  cargando: boolean;
  errorCarga: boolean;   // no se pudo leer el perfil (sin señal, sesión renovándose…): NO es «no tiene club»
  sesion: Session | null;
  perfil: Perfil | null;
  permisos: Permisos | null;
  esDueno: boolean;
  organizaciones: Organizacion[];
  cambiarOrganizacion: (perfilId: string) => Promise<void>;
  recargar: () => Promise<void>;
  salir: () => Promise<void>;
};

const SesionCtx = createContext<Ctx | null>(null);

export function SesionProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);
  const [esDueno, setEsDueno] = useState(false);
  const [organizaciones, setOrganizaciones] = useState<Organizacion[]>([]);
  const [errorCarga, setErrorCarga] = useState(false);
  const turno = useRef(0);
  const [leyendo, setLeyendo] = useState(false);   // hay una carga del perfil en curso   // solo vale la última carga (si llegan dos, no gana la vieja)

  // Lee el perfil. Devuelve false si algo falló (red, sesión vencida…), para reintentar.
  const leer = useCallback(async (s: Session): Promise<{ ok: boolean; perfil?: Perfil | null; dueno?: boolean; orgs?: Organizacion[] }> => {
    const [dueno, yo, orgs] = await Promise.all([supabase.rpc('soy_dueno'), supabase.rpc('yo'), supabase.rpc('mis_organizaciones')]);
    if (yo.error) return { ok: false };
    // Con varias organizaciones, «yo» es el perfil de la organización elegida.
    const miPerfil = typeof yo.data === 'string' ? yo.data : null;
    if (!miPerfil) return { ok: true, perfil: null, dueno: dueno.data === true, orgs: orgs.error ? [] : (orgs.data ?? []) as Organizacion[] };
    // Sin «*»: el email de las personas solo lo ven los administradores (024). El propio sale de la cuenta.
    const { data, error } = await supabase
      .from('perfiles')
      .select('id,club_id,nombre,rol_id,es_admin,permisos_ajustados,eliminado_en,debe_cambiar_clave,consentimiento_en,rol:roles(*),club:clubs(*)')
      .eq('id', miPerfil)
      .is('eliminado_en', null)
      .maybeSingle();
    if (error) return { ok: false };
    return {
      ok: true, dueno: dueno.data === true, orgs: orgs.error ? [] : (orgs.data ?? []) as Organizacion[],
      perfil: data ? ({ ...(data as unknown as Perfil), email: s.user.email ?? '' }) : null,
    };
  }, []);

  const cargarPerfil = useCallback(async (s: Session | null) => {
    const mio = ++turno.current;
    if (!s) { setPerfil(null); setEsDueno(false); setOrganizaciones([]); setErrorCarga(false); setLeyendo(false); return; }
    setLeyendo(true);
    // Hasta 5 intentos (≈ 9 s): al abrir la app «en frío» la sesión puede estar renovándose o no haber señal.
    for (let intento = 0; intento < 5; intento++) {
      if (intento > 0) {
        await new Promise((r) => setTimeout(r, 600 * 2 ** (intento - 1)));
        if (mio !== turno.current) return;
        if (intento === 1 || intento === 3) await supabase.auth.refreshSession().catch(() => {});
        if (mio !== turno.current) return;
      }
      const r = await leer(s).catch(() => ({ ok: false } as const));
      if (mio !== turno.current) return;
      // «Sin perfil» con la sesión abierta: se confirma una vez más (con la sesión renovada) antes de pedir el código.
      if (r.ok && !r.perfil && intento === 0) continue;
      if (r.ok) {
        setPerfil(r.perfil ?? null); setEsDueno(!!r.dueno); setOrganizaciones(r.orgs ?? []); setErrorCarga(false); setLeyendo(false);
        return;
      }
    }
    setErrorCarga(true); setLeyendo(false);   // no se pudo: NO lo mandamos a la pantalla del código
  }, [leer]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSesion(data.session);
      await cargarPerfil(data.session);
      setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSesion(s);
      // Renovar la sesión no cambia de persona: no hace falta volver a leer el perfil.
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED') setTimeout(() => { cargarPerfil(s); }, 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [cargarPerfil]);

  // Si no se pudo cargar, se reintenta solo al volver a la app.
  useEffect(() => {
    if (!errorCarga) return;
    const volver = () => { if (document.visibilityState === 'visible') void supabase.auth.getSession().then(({ data }) => cargarPerfil(data.session)); };
    document.addEventListener('visibilitychange', volver);
    window.addEventListener('online', volver);
    return () => { document.removeEventListener('visibilitychange', volver); window.removeEventListener('online', volver); };
  }, [errorCarga, cargarPerfil]);

  const recargar = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSesion(data.session);
    await cargarPerfil(data.session);
  }, [cargarPerfil]);

  const salir = useCallback(async () => {
    // Este celular deja de recibir los avisos de esta cuenta (si otra persona entra acá, no le llegan los ajenos).
    try {
      const reg = await navigator.serviceWorker?.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) await supabase.rpc('borrar_suscripcion', { p_endpoint: sub.endpoint });
    } catch { /* sin avisos: nada que hacer */ }
    await supabase.auth.signOut();
    setPerfil(null);
  }, []);

  const cambiarOrganizacion = useCallback(async (perfilId: string) => {
    const { error } = await supabase.rpc('cambiar_organizacion', { p_perfil: perfilId });
    if (error) throw error;
    window.location.assign('/');   // recarga todo con los datos de la otra organización
  }, []);

  const permisos = perfil ? permisosEfectivos(perfil.rol.permisos, perfil.permisos_ajustados, perfil.es_admin) : null;

  return (
    <SesionCtx.Provider value={{ cargando: cargando || (!!sesion && !perfil && leyendo), errorCarga, sesion, perfil, permisos, esDueno, organizaciones, cambiarOrganizacion, recargar, salir }}>
      {children}
    </SesionCtx.Provider>
  );
}

export function useSesion() {
  const c = useContext(SesionCtx);
  if (!c) throw new Error('useSesion fuera del proveedor');
  return c;
}
