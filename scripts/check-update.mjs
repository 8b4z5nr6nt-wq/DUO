// Browser regression for upgrades from the formerly cache-first app shell.
// The HTTP fixture simulates session expiry and login; access.test.js tests real Worker auth.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../dist", import.meta.url));
const legacyWorker = (
  await readFile(
    new URL("../tests/fixtures/legacy-sw.js", import.meta.url),
    "utf8",
  )
).replace('"duo-shell-v1"', '"duo-shell-legacy-upgrade-test"');
const worker = await readFile(resolve(root, "sw.js"), "utf8");
const currentCache = worker.match(/const CACHE = "([^"]+)"/)?.[1];
assert.ok(
  currentCache && currentCache !== "duo-shell-v1",
  "Build the app before running this check.",
);
assert.ok(
  !worker.includes(
    "const cached = await caches.match(event.request, { ignoreVary: true });\n      if (cached) return cached;\n      try",
  ),
  "This check requires the updated navigation policy.",
);
const html = await readFile(resolve(root, "index.html"), "utf8");
const { version } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};
let release = "legacy",
  authenticated = true,
  unavailable = false,
  incompleteUpdate = false;
const counts = { rejectedWorker: 0, refresh: 0, login: 0, document: 0 };
const loginHTML =
  '<!doctype html><title>DUO test login</title><a href="/auth/callback">Complete fictional login</a>';
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const reply = (status, body, type = "text/html", headers = {}) => {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "private, no-store",
      ...headers,
    });
    res.end(body);
  };
  const redirect = (location) =>
    reply(303, "", "text/plain", { Location: location });
  if (url.pathname === "/auth/refresh") {
    counts.refresh++;
    return redirect(
      authenticated ? "/?duo-update=fixture-refresh" : "/auth/login",
    );
  }
  if (url.pathname === "/auth/login") {
    counts.login++;
    return reply(200, loginHTML);
  }
  if (url.pathname === "/auth/callback") {
    authenticated = true;
    return redirect("/?duo-update=fixture-login");
  }
  if (!authenticated) {
    if (url.pathname === "/sw.js") counts.rejectedWorker++;
    return reply(
      401,
      url.pathname === "/" ? loginHTML : "Sign in first",
      url.pathname === "/" ? "text/html" : "text/plain",
    );
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    counts.document++;
    if (unavailable) return reply(503, "Temporarily unavailable", "text/plain");
    return reply(
      200,
      (release === "legacy"
        ? html.replaceAll('href="/auth/refresh"', 'href="#settings"')
        : html
      ).replace("<html ", `<html data-test-release="${release}" `),
    );
  }
  if (url.pathname === "/sw.js")
    return reply(
      200,
      release === "legacy"
        ? legacyWorker
        : incompleteUpdate
          ? worker.replace(currentCache, currentCache + "-incomplete")
          : worker,
      "text/javascript",
    );
  try {
    if (
      incompleteUpdate &&
      url.pathname.startsWith("/assets/") &&
      url.pathname.endsWith(".js")
    )
      return reply(503, "Asset temporarily unavailable", "text/plain");
    const path = resolve(root, decodeURIComponent(url.pathname).slice(1));
    if (!path.startsWith(root + "/")) throw Error("outside build");
    return reply(
      200,
      await readFile(path),
      mime[extname(path)] || "application/octet-stream",
    );
  } catch {
    return reply(404, "Not found", "text/plain");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  const executablePath =
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  browser = await chromium.launch({ executablePath });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const marker = () => page.locator("html").getAttribute("data-test-release");
  const stored = () =>
    page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("duo-personal", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const value = await new Promise((resolve, reject) => {
        const request = db
          .transaction("state")
          .objectStore("state")
          .get("current");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return value;
    });

  await page.goto(origin + "/#data");
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await page.getByText("4 件登録済み").waitFor();
  await page.getByRole("link", { name: "学習", exact: true }).click();
  await page.getByText("タイマー・ヒント", { exact: true }).click();
  await page.getByLabel("時間制限を使う").uncheck();
  await page.getByLabel("ヒントを使う").uncheck();
  await page.getByLabel("問題数（空欄は全問）").fill("1");
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
  await page.getByRole("button", { name: "スキップ", exact: true }).click();
  await page.getByRole("heading", { name: "学習結果" }).waitFor();
  const before = await stored();
  assert.equal(before.items.length, 4);
  assert.equal(
    before.sessions.flatMap((session) => session.attempts).length,
    1,
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
  assert.equal(await marker(), "legacy");

  // Reproduce the real deadlock: stale shell is returned even though auth has expired.
  release = "updated";
  authenticated = false;
  const rejected = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    try {
      await registration.update();
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(
    rejected,
    true,
    "Expired auth must reject the legacy worker's update.",
  );
  assert.ok(counts.rejectedWorker > 0);
  const documentsBeforeReload = counts.document;
  await page.goto(origin + "/#data");
  await page.reload();
  await page.getByText("4 件登録済み").waitFor();
  assert.equal(
    await marker(),
    "legacy",
    "The legacy cache-first page must reproduce stale UI.",
  );
  assert.equal(
    counts.document,
    documentsBeforeReload,
    "Legacy navigation bypasses server auth.",
  );
  assert.deepEqual(await stored(), before);

  // /auth/* is excluded by every shipped worker, so the recovery route reaches the server.
  await page.goto(origin + "/auth/refresh");
  assert.equal(await page.title(), "DUO test login");
  assert.equal(counts.refresh, 1);
  assert.equal(counts.login, 1);
  await page.getByRole("link", { name: "Complete fictional login" }).click();
  await page.getByRole("heading", { name: "今日の一歩を。" }).waitFor();
  assert.equal(await marker(), "updated");
  assert.deepEqual(await stored(), before);
  const deadline = Date.now() + 15000;
  let installed = false;
  while (Date.now() < deadline) {
    installed = await page.evaluate(async (expected) => {
      const keys = await caches.keys();
      const reg = await navigator.serviceWorker.getRegistration();
      return (
        keys.includes(expected) &&
        !keys.includes("duo-shell-legacy-upgrade-test") &&
        reg?.active?.state === "activated"
      );
    }, currentCache);
    if (installed) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    installed,
    "The new worker must finish activation before the next navigation.",
  );
  await page
    .locator("#app-update")
    .getByText("更新の準備ができました。", { exact: false })
    .waitFor();
  await page.locator(".version-badge").click();
  assert.equal(
    await page.locator(".version-number").textContent(),
    `v${version}`,
  );
  await page
    .locator(".version-card")
    .getByRole("link", { name: "最新版を開く" })
    .click();
  await page.getByRole("heading", { name: "今日の一歩を。" }).waitFor();
  assert.equal(counts.refresh, 1); // Static hosting updates without an auth endpoint.
  assert.equal(await marker(), "updated");
  assert.deepEqual(await stored(), before);

  // An incomplete later release must not replace the last working offline copy.
  incompleteUpdate = true;
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const failed = new Promise((resolve) => {
      reg.addEventListener(
        "updatefound",
        () => {
          const candidate = reg.installing;
          candidate.addEventListener("statechange", () => {
            if (candidate.state === "redundant") resolve();
          });
        },
        { once: true },
      );
    });
    await reg.update();
    await Promise.race([
      failed,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Error("Incomplete update did not fail installation")),
          15000,
        ),
      ),
    ]);
  });
  const retainedCaches = await page.evaluate(() => caches.keys());
  assert.ok(retainedCaches.includes(currentCache));
  assert.ok(!retainedCaches.includes(currentCache + "-incomplete"));
  incompleteUpdate = false;
  // A later deployment is visible on one ordinary reload with the new worker.
  release = "future";
  await page.goto(origin + "/#data");
  await page.getByText("4 件登録済み").waitFor();
  assert.equal(
    await marker(),
    "future",
    "Online document navigation must fetch the current shell.",
  );
  assert.deepEqual(await stored(), before);

  // Server outages and offline use retain the last usable shell, without deleting data.
  unavailable = true;
  await page.reload();
  await page.getByText("4 件登録済み").waitFor();
  assert.equal(await marker(), "updated");
  unavailable = false;
  await context.setOffline(true);
  await page.reload();
  await page.getByText("4 件登録済み").waitFor();
  assert.equal(await marker(), "updated");
  assert.deepEqual(await stored(), before);
  await context.setOffline(false);

  // With the fixed worker, a later expired login is surfaced instead of hidden by cache.
  authenticated = false;
  const loginResponse = await page.reload();
  assert.equal(loginResponse.status(), 401);
  assert.equal(await page.title(), "DUO test login");
  assert.deepEqual(await stored(), before);
  const cachedAuthURLs = await page.evaluate(async () => {
    const urls = [];
    for (const key of await caches.keys())
      for (const request of await (await caches.open(key)).keys())
        if (new URL(request.url).pathname.startsWith("/auth/"))
          urls.push(request.url);
    return urls;
  });
  assert.deepEqual(
    cachedAuthURLs,
    [],
    "Authentication pages must never enter the offline cache.",
  );
  await context.setOffline(true);
  await page.reload();
  await page.getByText("4 件登録済み").waitFor();
  assert.equal(
    await marker(),
    "updated",
    "An expired-login page must not replace the offline shell.",
  );
  assert.deepEqual(await stored(), before);
  console.log(
    "PASS: reproduced legacy auth/cache deadlock; recovered via uncached auth route; current worker reloads new HTML, handles expiry/outage/offline, and preserves all IndexedDB data.",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
