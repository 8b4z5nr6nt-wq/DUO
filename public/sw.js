const CACHE = "duo-shell-v2";
function appResponse(response, url, type) {
  return (
    response.ok &&
    !response.redirected &&
    new URL(response.url).origin === self.location.origin &&
    type.test(response.headers.get("Content-Type") || "")
  );
}
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const base = new URL("./", self.location).href;
      const response = await fetch(base, {
        cache: "reload",
        credentials: "same-origin",
      });
      if (!appResponse(response, base, /text\/html/i))
        throw Error("shell fetch failed");
      const html = await response.clone().text();
      if (!/<title>\s*DUO/.test(html)) throw Error("not a DUO shell");
      // Workers can redirect /index.html to /. Use the already validated shell as its offline alias.
      await cache.put(base, response.clone());
      await cache.put(new URL("index.html", base).href, response.clone());
      const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((m) => new URL(m[1], base))
        .filter(
          (u) =>
            u.origin === self.location.origin && !u.hash && u.href !== base,
        );
      const urls = new Set([
        new URL("manifest.webmanifest", base).href,
        new URL("icon-192.png", base).href,
        new URL("icon-512.png", base).href,
        ...assets.map((u) => u.href),
      ]);
      for (const url of urls) {
        const pathname = new URL(url).pathname;
        const type = pathname.endsWith(".js")
          ? /javascript/i
          : pathname.endsWith(".css")
            ? /text\/css/i
            : pathname.endsWith(".png")
              ? /image\/png/i
              : pathname.endsWith(".webmanifest")
                ? /application\/(manifest\+json|json)/i
                : /text\/html/i;
        const asset = await fetch(url, { credentials: "same-origin" });
        if (!appResponse(asset, url, type))
          throw Error("asset authentication or type check failed");
        await cache.put(url, asset);
      }
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys())
        if (k.startsWith("duo-shell-") && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/cdn-cgi/access/") ||
    url.pathname.startsWith("/auth/")
  )
    return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request, { ignoreVary: true });
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (
          response.ok &&
          !response.redirected &&
          new URL(response.url).origin === self.location.origin
        ) {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch (error) {
        if (event.request.mode === "navigate")
          return (
            (await caches.match(new URL("./", self.location).href)) ||
            Response.error()
          );
        throw error;
      }
    })(),
  );
});
