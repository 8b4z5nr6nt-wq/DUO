const CACHE = "duo-shell-v1";
const BASE = new URL("./", self.location).href;
function appResponse(response, type) {
  return (
    response.ok &&
    !response.redirected &&
    new URL(response.url).origin === self.location.origin &&
    type.test(response.headers.get("Content-Type") || "")
  );
}
function assetType(url) {
  const path = new URL(url).pathname;
  if (path.endsWith(".js")) return /javascript/i;
  if (path.endsWith(".css")) return /text\/css/i;
  if (path.endsWith(".png")) return /image\/png/i;
  if (path.endsWith(".webmanifest"))
    return /application\/(manifest\+json|json)/i;
  return null;
}
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      // Fetch and validate the complete release before publishing its offline shell.
      const response = await fetch(BASE, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!appResponse(response, /text\/html/i))
        throw Error("shell fetch failed");
      const html = await response.clone().text();
      if (
        !/<meta\s+name="app-shell"\s+content="personal-study-v1"/.test(html) ||
        !/<main\s+id="app"/.test(html)
      )
        throw Error("not a DUO shell");
      const urls = new Set([
        new URL("manifest.webmanifest", BASE).href,
        new URL("icon-192.png", BASE).href,
        new URL("icon-512.png", BASE).href,
        ...[...html.matchAll(/(?:src|href)="([^"]+)"/g)]
          .map((m) => new URL(m[1], BASE))
          .filter(
            (u) =>
              u.origin === self.location.origin &&
              !u.hash &&
              !u.pathname.startsWith("/auth/") &&
              assetType(u.href),
          )
          .map((u) => u.href),
      ]);
      const assets = [];
      for (const url of urls) {
        const asset = await fetch(url, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!appResponse(asset, assetType(url)))
          throw Error("asset authentication or type check failed");
        // Drain each response before requesting the next asset. Keeping unread
        // bodies can exhaust the browser's connection pool during installation.
        const body = await asset.blob();
        assets.push([url, new Response(body, { headers: asset.headers })]);
      }
      try {
        const cache = await caches.open(CACHE);
        for (const [url, asset] of assets) await cache.put(url, asset);
        await cache.put(BASE, response.clone());
        await cache.put(new URL("index.html", BASE).href, response);
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("duo-shell-") && name !== CACHE)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);
async function navigate(request) {
  const cache = await caches.open(CACHE);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(request, {
      cache: "no-store",
      signal: controller.signal,
    });
    // Online authentication failures must reach the visitor; never hide them with old HTML.
    if (response.status < 500) return response;
    return (await cache.match(BASE)) || response;
  } catch {
    return (await cache.match(BASE)) || Response.error();
  } finally {
    clearTimeout(timeout);
  }
}
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/cdn-cgi/access/") ||
    url.pathname.endsWith("/sw.js")
  )
    return;
  if (event.request.mode === "navigate") {
    // Keep the last complete install as the offline fallback. New navigation HTML
    // is not cached on its own, because its assets might still be unavailable.
    event.respondWith(navigate(event.request));
    return;
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(event.request, { ignoreVary: true });
      if (cached) return cached;
      const response = await fetch(event.request);
      const type = assetType(event.request.url);
      if (type && appResponse(response, type))
        await cache.put(event.request, response.clone());
      return response;
    })(),
  );
});
