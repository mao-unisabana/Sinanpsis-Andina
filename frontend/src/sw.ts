/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
// App shell offline: toda navegación cae a index.html, excepto API y el login de Keycloak en el mismo origen (D38)
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/health/, /^\/realms\//, /^\/resources\//] }))

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
// Versión nueva publicada: se activa de inmediato en vez de esperar a que se cierren todas las pestañas
self.addEventListener('install', () => void self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// Background Sync (solo Chromium): disparador adicional; la cola y su estado viven en la app (D05)
self.addEventListener('sync', (e: Event) => {
  const ev = e as Event & { tag: string; waitUntil: (p: Promise<unknown>) => void }
  if (ev.tag === 'sses-outbox') ev.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'SYNC' }))))
})
