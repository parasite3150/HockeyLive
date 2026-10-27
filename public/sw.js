// Background script: shows goal alerts and opens the match when one is tapped.
// (It doesn't cache pages; the app handles quick start-up itself.)

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let alert = {};
  try { alert = event.data?.json() ?? {}; } catch { alert = { title: "Hockey Live", body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(alert.title || "Hockey Live", {
    body: alert.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: alert.tag,            // updates for the same match replace each other
    renotify: true,
    data: { url: alert.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        return w.navigate(url);
      }
    }
    return self.clients.openWindow(url);
  })());
});
