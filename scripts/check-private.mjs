// Real local Workers runtime + Chromium. All credentials and TLS keys below are test-only.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { request as httpsRequest } from "node:https";
import { createHash, X509Certificate } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { SignJWT } from "jose";
import { chromium } from "@playwright/test";
const dir = await mkdtemp(join(tmpdir(), "duo-private-test-"));
let server, browser;
try {
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const origin = `https://127.0.0.1:${port}`;
  const cert = join(dir, "local-cert.pem"),
    keyFile = join(dir, "local-key.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyFile,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  const ca = await readFile(cert);
  const pin = createHash("sha256")
    .update(
      new X509Certificate(ca).publicKey.export({ type: "spki", format: "der" }),
    )
    .digest("base64");
  const secret = "fictional-local-test-secret-not-a-real-oauth-secret";
  const configPath = join(dir, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "duo-private-local-test",
      main: resolve("worker/index.js"),
      compatibility_date: "2026-10-09",
      workers_dev: false,
      preview_urls: false,
      assets: {
        directory: resolve("dist"),
        binding: "ASSETS",
        run_worker_first: true,
      },
      vars: {
        APP_ORIGIN: origin,
        GITHUB_OWNER_ID: "123",
        GITHUB_CLIENT_ID: "fictional-test-client",
        GITHUB_CLIENT_SECRET: secret,
      },
    }),
  );
  let logs = "";
  server = spawn(
    process.execPath,
    [
      resolve("node_modules/wrangler/bin/wrangler.js"),
      "dev",
      "--local",
      "--config",
      configPath,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--local-protocol",
      "https",
      "--https-cert-path",
      cert,
      "--https-key-path",
      keyFile,
    ],
    {
      detached: true,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: dir,
        WRANGLER_SEND_METRICS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (b) => (logs = (logs + b).slice(-6000)));
  server.stderr.on("data", (b) => (logs = (logs + b).slice(-6000)));
  const health = (path = "/") =>
    new Promise((done, reject) => {
      const req = httpsRequest(origin + path, { ca, timeout: 1000 }, (res) => {
        res.resume();
        done(res.statusCode);
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(Error("timeout")));
      req.end();
    });
  const deadline = Date.now() + 45000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      if ((await health()) === 401) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) break;
    await setTimeout(250);
  }
  if (!ready) throw Error("Local private Worker did not start: " + logs);
  const executablePath =
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  // Trust only this generated local certificate's public key, rather than disabling TLS checks globally.
  browser = await chromium.launch({
    executablePath,
    args: [`--ignore-certificate-errors-spki-list=${pin}`],
  });
  const visitor = await browser.newContext();
  const unauth = await visitor.newPage();
  for (const path of [
    "/",
    "/index.html",
    "/sw.js",
    "/manifest.webmanifest",
    "/icon-192.png",
  ]) {
    const response = await unauth.goto(origin + path);
    assert.equal(response.status(), 401, path);
  }
  await unauth.goto(origin + "/");
  await unauth.getByRole("link", { name: "GitHubでログイン" }).waitFor();
  assert.equal(await unauth.locator("script[src]").count(), 0);
  const failure = await unauth.goto(
    origin +
      "/auth/callback?code=fictional-local-code&state=fictional-local-state",
  );
  assert.equal(failure.status(), 403);
  await unauth
    .getByRole("heading", { name: "本人確認ができませんでした" })
    .waitFor();
  await unauth.getByText("確認コード：DUO-A01").waitFor();
  assert.equal(
    await unauth
      .getByRole("link", { name: "もう一度GitHubでログイン" })
      .getAttribute("href"),
    "/auth/login",
  );
  assert.equal(await unauth.locator("script[src]").count(), 0);
  const owner = await browser.newContext();
  const signing = createHash("sha256")
    .update("duo:session:v1:" + secret)
    .digest();
  const jwt = await new SignJWT({ type: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("duo-private")
    .setAudience(origin)
    .setSubject("123")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(signing);
  await owner.addCookies([
    {
      name: "__Host-duo_session",
      value: jwt,
      url: origin + "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  const page = await owner.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const refreshed = await page.goto(origin + "/auth/refresh");
  assert.equal(refreshed.status(), 200);
  assert.equal(new URL(page.url()).origin, origin);
  assert.ok(new URL(page.url()).searchParams.get("duo-update"));
  await page.getByRole("heading", { name: "今日の一歩を。" }).waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector("#connection")
      .textContent.includes("オフライン準備完了"),
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener("controllerchange", r, {
          once: true,
        }),
      );
  });
  await page.goto(origin + "/#data");
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await page.getByText("4 件登録済み").waitFor();
  await owner.setOffline(true);
  await page.reload();
  await page.getByText("4 件登録済み").waitFor();
  await page.getByRole("link", { name: "検索", exact: true }).click();
  await page.getByRole("button", { name: "単語モード", exact: true }).click();
  await page.getByLabel("番号・英語・日本語").fill("moon");
  assert.match(await page.locator("#list").textContent(), /月の庭/);
  await page.getByRole("link", { name: "学習", exact: true }).click();
  await page.getByText("タイマー・ヒント", { exact: true }).click();
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
  // OAuth endpoints must always reach the network, never fall back to a cached app shell.
  assert.equal(
    await page.evaluate(() =>
      fetch("/auth/login").then(
        () => false,
        () => true,
      ),
    ),
    true,
  );
  await owner.setOffline(false);
  await owner.clearCookies();
  const expired = await page.reload();
  assert.equal(expired.status(), 401);
  await page
    .getByRole("link", { name: "GitHubでログイン", exact: true })
    .waitFor();
  assert.equal(await page.locator("script[src]").count(), 0);
  // The login document intentionally disallows fetch via CSP; verify its route
  // directly with the trusted local certificate without following GitHub's URL.
  assert.equal(await health("/auth/login"), 303);
  await owner.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name: "学習結果" }).waitFor();
  assert.match(await page.locator("main").textContent(), /正解 1/);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: local Worker rejects anonymous assets, refreshes owner sessions, surfaces expired auth online, preserves offline study/history, keeps OAuth network-only",
  );
} finally {
  await browser?.close();
  if (server) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
  }
  await rm(dir, { recursive: true, force: true });
}
