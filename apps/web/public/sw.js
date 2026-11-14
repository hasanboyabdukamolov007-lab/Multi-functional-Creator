/* Multi-functional Creator service worker: installable app, offline shell, instant repeat loads.
 * - Hashed build assets (/assets/*) are immutable: cache-first.
 * - Page navigations: network-first, falling back to the cached app shell when offline.
 * - The API (/api/*) is never cached — secrets and live data always come from the server. */
const VERSION = "mfc-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit || new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } }))),
    );
    return;
  }

  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

// Push notifications (mentions, replies, alerts). The payload is { title, body, link, tag }.
self.addEventListener("push", (e) => {
  let m = { title: "Multi-functional Creator", body: "", link: "/" };
  try {
    m = { ...m, ...e.data.json() };
  } catch {
    if (e.data) m.body = e.data.text();
  }
  e.waitUntil(
    self.registration.showNotification(m.title, {
      body: m.body,
      tag: m.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { link: m.link || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = new URL((e.notification.data && e.notification.data.link) || "/", location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(location.origin));
      if (open) return open.focus().then(() => open.navigate(link));
      return self.clients.openWindow(link);
    }),
  );
});
