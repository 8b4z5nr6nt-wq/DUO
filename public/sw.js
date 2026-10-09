const CACHE = "duo-shell-v1";
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const base = new URL("./", self.location).href;
      const response = await fetch(base, { cache: "reload" });
      if (!response.ok) throw Error("shell fetch failed");
      const html = await response.text();
      const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((m) => new URL(m[1], base))
        .filter((u) => u.origin === self.location.origin && !u.hash);
      await cache.addAll([
        ...new Set([
          base,
          new URL("index.html", base).href,
          new URL("manifest.webmanifest", base).href,
          new URL("icon-192.png", base).href,
          new URL("icon-512.png", base).href,
          ...assets.map((u) => u.href),
        ]),
      ]);
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys())
        if (k.startsWith("duo-shell-") && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (e) => {
  if (
    e.request.method !== "GET" ||
    new URL(e.request.url).origin !== self.location.origin
  )
    return;
  e.respondWith(
    (async () => {
      const cached = await caches.match(e.request, { ignoreVary: true });
      if (cached) return cached;
      try {
        const response = await fetch(e.request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(e.request, response.clone());
        }
        return response;
      } catch (error) {
        if (e.request.mode === "navigate")
          return (
            (await caches.match(new URL("./", self.location).href)) ||
            Response.error()
          );
        throw error;
      }
    })(),
  );
});
