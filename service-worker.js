/* =====================================================================
   GUVEL Quality · Service Worker
   - Deja instalable el portal como app (ícono, pantalla completa).
   - Red primero, con una copia de respaldo simple para que algo cargue
     si se pierde la conexión un instante (esto NO es una app offline
     completa: los datos siempre vienen de Supabase en vivo).
   - Recibe y muestra las notificaciones push (Parte B).
   ===================================================================== */
const CACHE = "gq-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/assets/icons/icon-192.png", "/assets/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;            // Supabase, fuentes, etc. siguen su curso normal
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("/index.html")))
  );
});

/* ------------------------------ Notificaciones push (Parte B) ------------------------------ */
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: "GUVEL Quality", body: e.data?.text() || "" }; }
  const title = data.title || "GUVEL Quality";
  const options = {
    body: data.body || "", icon: "/assets/icons/icon-192.png", badge: "/assets/icons/icon-192.png",
    data: { url: data.url || "/" }, tag: data.tag || undefined, renotify: !!data.tag,
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = e.notification.data?.url || "/";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) { c.navigate(target); return c.focus(); } }
    return self.clients.openWindow(target);
  })());
});
