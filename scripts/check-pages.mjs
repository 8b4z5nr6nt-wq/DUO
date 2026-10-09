import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { chromium } from "@playwright/test";

// Serve only the build, under the repository path used by GitHub Pages.
const root = resolve("dist");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (!pathname.startsWith("/DUO/")) throw Error("outside repository path");
    const path = resolve(root, pathname.slice("/DUO/".length) || "index.html");
    if (!path.startsWith(root + "/")) throw Error("outside build");
    const content = await readFile(path);
    res.writeHead(200, {
      "Content-Type": mime[extname(path)] || "application/octet-stream",
    });
    res.end(content);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  const executablePath =
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  browser = await chromium.launch({ executablePath });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/DUO/#data`);
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await page.getByText("4 件登録済み").waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector("#connection")
      .textContent.includes("オフライン準備完了"),
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
  const manifest = await page.evaluate(async () => {
    const url = document.querySelector('link[rel="manifest"]').href;
    const data = await (await fetch(url)).json();
    return {
      start: new URL(data.start_url, url).pathname,
      scope: new URL(data.scope, url).pathname,
    };
  });
  assert.deepEqual(manifest, { start: "/DUO/", scope: "/DUO/" });
  assert.equal(
    await page.evaluate(
      () => new URL(navigator.serviceWorker.controller.scriptURL).pathname,
    ),
    "/DUO/sw.js",
  );
  await context.setOffline(true);
  await page.reload();
  await page.getByText("4 件登録済み").waitFor();
  await page.getByRole("link", { name: "検索", exact: true }).click();
  await page.getByLabel("番号・英語・日本語").fill("moon");
  assert.match(await page.locator("#list").textContent(), /月の庭/);
  await page.getByRole("link", { name: "学習", exact: true }).click();
  await page.getByLabel("時間制限を使う").uncheck();
  await page.getByLabel("ヒントを使う").uncheck();
  await page.getByLabel("問題数（空欄は全問）").fill("1");
  await page.getByRole("button", { name: "学習を開始" }).click();
  await page
    .getByLabel("あなたの回答")
    .fill("私のロボットは青いトマトを育てます。");
  await page.getByRole("button", { name: "回答を確認" }).click();
  await page.getByRole("button", { name: "覚えた", exact: true }).click();
  await page.getByRole("heading", { name: "学習結果" }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "学習結果" }).waitFor();
  assert.match(await page.locator("main").textContent(), /正解 1/);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: /DUO/ assets, manifest scope, Service Worker, offline reload/search/study/history persistence",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
