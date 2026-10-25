// Service worker: recibe los avisos y abre la app al tocarlos.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { cuerpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Sports Performance', {
    body: d.cuerpo || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag, data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const v of ventanas) { if ('focus' in v) { await v.navigate(url).catch(() => {}); return v.focus(); } }
    return self.clients.openWindow(url);
  })());
});
