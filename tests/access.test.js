import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SignJWT, decodeJwt } from "jose";
import { createHandler } from "../worker/index.js";
const config = {
  APP_ORIGIN: "https://duo.example.invalid",
  GITHUB_OWNER_ID: "123",
  GITHUB_CLIENT_ID: "fictional-client",
  GITHUB_CLIENT_SECRET: "fictional-example-secret-long-enough-only-for-tests",
};
const sessionName = "__Host-duo_session",
  stateName = "__Host-duo_oauth";
function cookie(response, name) {
  return response.headers
    .getSetCookie()
    .find((c) => c.startsWith(name + "="))
    ?.split(";")[0];
}
function request(path, headers = {}, method = "GET") {
  return new Request(config.APP_ORIGIN + path, { method, headers });
}
function setup({
  owner = 123,
  scope = "",
  tokenError = false,
  profileError = false,
  networkError = false,
} = {}) {
  const calls = [];
  let fetched = 0;
  const handler = createHandler(async (url, options) => {
    calls.push({ url, options });
    if (networkError) throw Error("simulated network failure");
    if (url.endsWith("/access_token"))
      return Response.json(
        tokenError
          ? { error: "bad_code" }
          : {
              access_token: "fictional-github-token",
              token_type: "bearer",
              scope,
            },
      );
    if (profileError) return new Response("", { status: 401 });
    return Response.json({ id: owner, login: "mutable-name-not-used" });
  });
  const env = {
    ...config,
    ASSETS: {
      fetch: () => {
        fetched++;
        return new Response("fictional asset", {
          headers: { "Content-Type": "application/javascript" },
        });
      },
    },
  };
  return {
    handler,
    env,
    calls,
    get fetched() {
      return fetched;
    },
  };
}
async function begin(s) {
  const response = await s.handler.fetch(request("/auth/login"), s.env);
  return {
    response,
    url: new URL(response.headers.get("Location")),
    cookie: cookie(response, stateName),
  };
}
async function finish(s, start, code = "fictional-code") {
  return s.handler.fetch(
    request(
      "/auth/callback?" +
        new URLSearchParams({
          code,
          state: start.url.searchParams.get("state"),
        }),
      { Cookie: start.cookie },
    ),
    s.env,
  );
}
async function signedCookie(purpose, changes = {}) {
  const key = createHash("sha256")
    .update(`duo:${purpose}:v1:${config.GITHUB_CLIENT_SECRET}`)
    .digest();
  const claims = {
    iss: "duo-private",
    aud: config.APP_ORIGIN,
    sub: config.GITHUB_OWNER_ID,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    type: purpose,
    ...changes,
  };
  for (const k of Object.keys(claims))
    if (claims[k] === undefined) delete claims[k];
  const jwt = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .sign(key);
  return `${purpose === "session" ? sessionName : stateName}=${jwt}`;
}
test("認証未設定と別ホストでは静的ファイルを返さない", async () => {
  const s = setup();
  for (const env of [
    {},
    { ...s.env, APP_ORIGIN: "http://not-secure.invalid" },
    { ...s.env, GITHUB_CLIENT_SECRET: "" },
  ]) {
    assert.equal((await s.handler.fetch(request("/"), env)).status, 503);
  }
  assert.equal(
    (
      await s.handler.fetch(
        new Request("https://another.example.invalid/"),
        s.env,
      )
    ).status,
    403,
  );
  assert.equal(s.fetched, 0);
});
test("設定エラーは不足している名前だけを表示し、設定値やSecretを漏らさない", async () => {
  const s = setup();
  for (const name of [
    "APP_ORIGIN",
    "GITHUB_OWNER_ID",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
  ]) {
    const env = { ...s.env, [name]: "" };
    const response = await s.handler.fetch(request("/"), env);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, new RegExp(name));
    assert.match(body, /Variables and Secrets/);
    assert.match(body, /保存してデプロイ/);
    for (const other of [
      "APP_ORIGIN",
      "GITHUB_OWNER_ID",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
    ]) {
      if (other !== name) assert.equal(body.includes(other), false);
    }
    assert.equal(body.includes(config.GITHUB_CLIENT_SECRET), false);
    assert.equal(body.includes(config.GITHUB_CLIENT_ID), false);
    assert.equal(body.includes(config.APP_ORIGIN), false);
  }
  const shortSecret = "fictional-short";
  const response = await s.handler.fetch(request("/"), {
    ...s.env,
    GITHUB_CLIENT_SECRET: shortSecret,
  });
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.match(body, /GITHUB_CLIENT_SECRET/);
  assert.equal(body.includes(shortSecret), false);
  assert.equal(s.fetched, 0);
  assert.equal(s.calls.length, 0);
});
test("未認証のHTML/JS/SW/manifest/アイコンを配信しない", async () => {
  const s = setup();
  for (const path of [
    "/",
    "/index.html",
    "/assets/app.js",
    "/sw.js",
    "/manifest.webmanifest",
    "/icon-192.png",
  ]) {
    const response = await s.handler.fetch(request(path), s.env);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(s.fetched, 0);
  assert.equal(s.calls.length, 0);
});
test("GitHub認証は最小権限・ランダムstate・PKCE・安全なCookieを使う", async () => {
  const s = setup(),
    a = await begin(s),
    b = await begin(s);
  assert.equal(a.url.origin, "https://github.com");
  assert.equal(a.url.pathname, "/login/oauth/authorize");
  assert.equal(a.url.searchParams.get("scope"), "");
  assert.equal(
    a.url.searchParams.get("redirect_uri"),
    config.APP_ORIGIN + "/auth/callback",
  );
  assert.equal(a.url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(a.url.searchParams.get("code_challenge").length, 43);
  assert.notEqual(
    a.url.searchParams.get("state"),
    b.url.searchParams.get("state"),
  );
  assert.match(
    a.response.headers.get("set-cookie"),
    /HttpOnly; Secure; SameSite=Lax; Max-Age=600/,
  );
  assert.equal(a.response.status, 303);
});
test("本人確認成功後だけセッションを発行し、GitHubトークンを保存しない", async () => {
  const s = setup(),
    start = await begin(s),
    response = await finish(s, start);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), config.APP_ORIGIN + "/");
  const session = cookie(response, sessionName);
  assert.ok(session);
  assert.match(response.headers.get("set-cookie"), /Max-Age=604800/);
  const body = s.calls[0].options.body;
  assert.equal(body.get("redirect_uri"), config.APP_ORIGIN + "/auth/callback");
  assert.equal(body.get("code"), "fictional-code");
  assert.equal(
    createHash("sha256").update(body.get("code_verifier")).digest("base64url"),
    start.url.searchParams.get("code_challenge"),
  );
  assert.equal(s.calls[0].options.redirect, "error");
  assert.equal(s.calls[1].url, "https://api.github.com/user");
  assert.equal(
    s.calls[1].options.headers.Authorization,
    "Bearer fictional-github-token",
  );
  const claims = decodeJwt(session.slice(session.indexOf("=") + 1));
  assert.equal(claims.sub, "123");
  assert.equal(claims.type, "session");
  assert.equal(
    JSON.stringify(claims).includes("fictional-github-token"),
    false,
  );
  const asset = await s.handler.fetch(
    request("/assets/app.js", { Cookie: session }),
    s.env,
  );
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "application/javascript");
  assert.equal(s.fetched, 1);
});
test("他人のアカウント・余分な権限・認証サーバー障害でセッションを発行しない", async () => {
  for (const option of [
    { owner: 999 },
    { scope: "repo" },
    { tokenError: true },
    { profileError: true },
    { networkError: true },
  ]) {
    const s = setup(option),
      start = await begin(s),
      response = await finish(s, start);
    assert.equal(response.status, 403);
    assert.equal(cookie(response, sessionName), undefined);
    assert.equal(s.fetched, 0);
  }
});
test("state不足・改ざん・別ブラウザ・期限切れを外部通信前に拒否する", async () => {
  const s = setup(),
    start = await begin(s),
    validState = start.url.searchParams.get("state");
  const invalid = [
    request("/auth/callback?code=x&state=" + validState),
    request("/auth/callback?code=x&state=forged", { Cookie: start.cookie }),
    request("/auth/callback?code=x&state=" + validState, {
      Cookie: stateName + "=forged",
    }),
    request("/auth/callback?code=x&state=" + validState, {
      Cookie: await signedCookie("oauth", {
        state: validState,
        verifier: "v",
        exp: 1,
      }),
    }),
  ];
  for (const r of invalid) {
    assert.equal((await s.handler.fetch(r, s.env)).status, 403);
  }
  assert.equal(s.calls.length, 0);
  assert.equal(s.fetched, 0);
});
test("偽造・期限切れ・別対象・必須期限なしのCookieを拒否する", async () => {
  const s = setup();
  const cookies = [
    sessionName + "=forged",
    await signedCookie("session", { exp: 1 }),
    await signedCookie("session", { aud: "https://other.invalid" }),
    await signedCookie("session", { sub: "999" }),
    await signedCookie("session", { exp: undefined }),
    await signedCookie("oauth"),
  ];
  for (const c of cookies)
    assert.equal(
      (await s.handler.fetch(request("/sw.js", { Cookie: c }), s.env)).status,
      401,
    );
  assert.equal(s.fetched, 0);
});
test("認証用Cookieを用途別に分離し、同名Cookieの重複も拒否する", async () => {
  const s = setup(),
    state = await signedCookie("oauth");
  assert.equal(
    (
      await s.handler.fetch(
        request("/sw.js", { Cookie: state.replace(stateName, sessionName) }),
        s.env,
      )
    ).status,
    401,
  );
  const session = await signedCookie("session");
  assert.equal(
    (
      await s.handler.fetch(
        request("/sw.js", { Cookie: session + "; " + session }),
        s.env,
      )
    ).status,
    401,
  );
  assert.equal(s.fetched, 0);
});
test("ログアウトは同一サイトからのPOSTだけを許可する", async () => {
  const s = setup();
  assert.equal(
    (await s.handler.fetch(request("/auth/logout"), s.env)).status,
    405,
  );
  assert.equal(
    (
      await s.handler.fetch(
        request("/auth/logout", { Origin: "https://other.invalid" }, "POST"),
        s.env,
      )
    ).status,
    403,
  );
  const response = await s.handler.fetch(
    request("/auth/logout", { Origin: config.APP_ORIGIN }, "POST"),
    s.env,
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.ok(
    response.headers.getSetCookie().every((c) => c.includes("Max-Age=0")),
  );
});
