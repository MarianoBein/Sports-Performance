// Avisos al celular (push): activar y desactivar en este dispositivo.
import { supabase } from './supabase';

// Staff deportivo: le llegan las alertas del Sports Science Hub.
export const STAFF_DEPORTIVO = ['principal', 'ayudante', 'skills', 'pf', 'fisio'];
export const recibeAvisos = (rol: { clave: string; es_jugador: boolean }) => rol.es_jugador || STAFF_DEPORTIVO.includes(rol.clave);

export type EstadoAvisos = 'no-soportado' | 'instalar-primero' | 'sin-configurar' | 'bloqueados' | 'activos' | 'apagados';

const b64 = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalada = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

async function clavePublica(): Promise<string | null> {
  try { const r = await fetch('/api/avisos'); const j = await r.json(); return j.publica ?? null; } catch { return null; }
}

export async function estadoAvisos(): Promise<EstadoAvisos> {
  if (esIOS() && !instalada()) return 'instalar-primero';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'no-soportado';
  if (Notification.permission === 'denied') return 'bloqueados';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'activos' : 'apagados';
}

export async function activarAvisos(): Promise<EstadoAvisos> {
  const clave = await clavePublica();
  if (!clave) return 'sin-configurar';
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return permiso === 'denied' ? 'bloqueados' : 'apagados';
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(clave) });
  const j = sub.toJSON();
  const { error } = await supabase.rpc('guardar_suscripcion', { p_endpoint: sub.endpoint, p_p256dh: j.keys?.p256dh ?? '', p_auth: j.keys?.auth ?? '' });
  if (error) throw error;
  return 'activos';
}

// Al abrir la app: si el permiso está dado, se asegura de que el servidor tenga la suscripción
// de este celular y a nombre de esta persona (si se borró o quedó de otra cuenta, la vuelve a guardar).
export async function asegurarAvisos(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (esIOS() && !instalada()) return;
  const reg = (await navigator.serviceWorker.getRegistration('/sw.js')) ?? await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const clave = await clavePublica();
    if (!clave) return;
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(clave) });
  }
  const j = sub.toJSON();
  await supabase.rpc('guardar_suscripcion', { p_endpoint: sub.endpoint, p_p256dh: j.keys?.p256dh ?? '', p_auth: j.keys?.auth ?? '' });
}

export async function desactivarAvisos(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await supabase.rpc('borrar_suscripcion', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
}
