import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { permisosEfectivos, type Permisos } from './permisos';

export type Rol = { id: string; clave: string; nombre: string; es_jugador: boolean; permisos: Permisos };
export type Club = { id: string; nombre: string; sede_local: string | null; temporada: string | null; logo_club_url?: string | null; logo_liga_url?: string | null; wellness_modo?: string; rpe_modo?: string; rpe_retraso_min?: number; hora_aviso_wellness?: string };
export type Perfil = {
  id: string; club_id: string; nombre: string; email: string; rol_id: string;
  es_admin: boolean; permisos_ajustados: Partial<Permisos> | null; eliminado_en: string | null; debe_cambiar_clave?: boolean;
  rol: Rol; club: Club;
};

export type Organizacion = { perfil_id: string; club_id: string; club: string; rol: string; es_admin: boolean; activa: boolean };

type Ctx = {
  cargando: boolean;
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

  const cargarPerfil = useCallback(async (s: Session | null) => {
    if (!s) { setPerfil(null); setEsDueno(false); setOrganizaciones([]); return; }
    const [dueno, yo, orgs] = await Promise.all([supabase.rpc('soy_dueno'), supabase.rpc('yo'), supabase.rpc('mis_organizaciones')]);
    setEsDueno(dueno.data === true);
    setOrganizaciones(orgs.error ? [] : ((orgs.data ?? []) as Organizacion[]));
    // Con varias organizaciones, «yo» es el perfil de la organización elegida.
    // (Si la base todavía no tiene el 020, el perfil es el de la cuenta, como antes.)
    const miPerfil = !yo.error && typeof yo.data === 'string' ? yo.data : s.user.id;
    const { data } = await supabase
      .from('perfiles')
      .select('*, rol:roles(*), club:clubs(*)')
      .eq('id', miPerfil)
      .is('eliminado_en', null)
      .maybeSingle();
    setPerfil((data as Perfil) ?? null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSesion(data.session);
      await cargarPerfil(data.session);
      setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSesion(s);
      setTimeout(() => { cargarPerfil(s); }, 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [cargarPerfil]);

  const recargar = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSesion(data.session);
    await cargarPerfil(data.session);
  }, [cargarPerfil]);

  const salir = useCallback(async () => {
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
    <SesionCtx.Provider value={{ cargando, sesion, perfil, permisos, esDueno, organizaciones, cambiarOrganizacion, recargar, salir }}>
      {children}
    </SesionCtx.Provider>
  );
}

export function useSesion() {
  const c = useContext(SesionCtx);
  if (!c) throw new Error('useSesion fuera del proveedor');
  return c;
}
