import { SignJWT, jwtVerify, base64url } from "jose";

const SESSION = "__Host-duo_session";
const STATE = "__Host-duo_oauth";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const STATE_SECONDS = 10 * 60;
const encoder = new TextEncoder();

function configuration(env) {
  const issues = [];
  let origin;
  try {
    origin = new URL(env.APP_ORIGIN);
    if (
      origin.protocol !== "https:" ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    )
      issues.push("APP_ORIGIN（配信URLの形式を確認）");
  } catch {
    issues.push("APP_ORIGIN（未登録、またはURLの形式が不正）");
  }
  const id = String(env.GITHUB_OWNER_ID || "");
  const client = String(env.GITHUB_CLIENT_ID || "");
  const secret = String(env.GITHUB_CLIENT_SECRET || "");
  if (!/^[1-9]\d*$/.test(id))
    issues.push("GITHUB_OWNER_ID（未登録、または数値IDの形式が不正）");
  if (!client.trim()) issues.push("GITHUB_CLIENT_ID（未登録）");
  if (!secret) issues.push("GITHUB_CLIENT_SECRET（未登録）");
  else if (secret.length < 32)
    issues.push("GITHUB_CLIENT_SECRET（Client Secretの形式を確認）");
  return {
    config: issues.length
      ? null
      : { origin: origin.origin, id, client, secret },
    issues,
  };
}
function reply(text, status, headers = {}) {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      ...headers,
    },
  });
}
function redirect(location) {
  return reply(null, 303, { Location: location });
}
function cookie(name, value, seconds) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}
function getCookie(request, name) {
  const matches = (request.headers.get("Cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.startsWith(name + "="));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}
async function signingKey(config, purpose) {
  return new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(`duo:${purpose}:v1:${config.secret}`),
    ),
  );
}
async function sign(config, purpose, claims, seconds) {
  return new SignJWT({ ...claims, type: purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("duo-private")
    .setAudience(config.origin)
    .setSubject(config.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + seconds)
    .sign(await signingKey(config, purpose));
}
async function verify(config, purpose, token) {
  const { payload } = await jwtVerify(
    token,
    await signingKey(config, purpose),
    {
      algorithms: ["HS256"],
      issuer: "duo-private",
      audience: config.origin,
      subject: config.id,
      requiredClaims: ["exp", "iat", "type"],
      clockTolerance: 5,
    },
  );
  if (payload.type !== purpose) throw Error("wrong token type");
  return payload;
}
function loginPage() {
  return reply(
    `<!doctype html><html lang="ja"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DUO ログイン</title><style>body{font-family:system-ui;background:#101113;color:#eee;max-width:32rem;margin:15vh auto;padding:24px;line-height:1.8}a{display:inline-block;color:#17210e;background:#bded99;border-radius:12px;padding:12px 20px;text-decoration:none;font-weight:bold}p{color:#bbc0c8}</style><h1>DUO</h1><p>ご本人だけが使える英語学習アプリです。</p><a href="/auth/login">GitHubでログイン</a><p>学習データはこの端末内に保存されます。</p></html>`,
    401,
    {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    },
  );
}

export function createHandler(fetchGithub = fetch) {
  return {
    async fetch(request, env) {
      const { config, issues } = configuration(env);
      if (!config)
        return reply(
          "DUOの本人限定ログイン設定が未完了です。\n\n確認が必要な設定：\n" +
            issues.map((name) => "・" + name).join("\n") +
            "\n\nCloudflareのduo-private → Settings → Variables and Secretsを確認し、保存してデプロイしてください。\nBuild variables（ビルド用変数）への登録だけでは反映されません。",
          503,
        );
      const url = new URL(request.url);
      if (url.origin !== config.origin)
        return reply("設定されたURLからDUOを開いてください。", 403);
      const callback = `${config.origin}/auth/callback`;
      if (url.pathname === "/auth/login") {
        if (request.method !== "GET")
          return reply("この操作はGETで行ってください。", 405, {
            Allow: "GET",
          });
        const state = base64url.encode(
          crypto.getRandomValues(new Uint8Array(32)),
        );
        const verifier = base64url.encode(
          crypto.getRandomValues(new Uint8Array(32)),
        );
        const challenge = base64url.encode(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
          ),
        );
        const destination = new URL("https://github.com/login/oauth/authorize");
        destination.search = new URLSearchParams({
          client_id: config.client,
          redirect_uri: callback,
          state,
          scope: "",
          code_challenge: challenge,
          code_challenge_method: "S256",
        });
        const response = redirect(destination.href);
        response.headers.append(
          "Set-Cookie",
          cookie(
            STATE,
            await sign(config, "oauth", { state, verifier }, STATE_SECONDS),
            STATE_SECONDS,
          ),
        );
        return response;
      }
      if (url.pathname === "/auth/callback") {
        let response;
        try {
          if (request.method !== "GET") throw Error("method");
          const code = url.searchParams.get("code"),
            state = url.searchParams.get("state"),
            stored = getCookie(request, STATE);
          if (
            url.searchParams.has("error") ||
            !code ||
            !state ||
            !stored ||
            code.length > 2048 ||
            url.searchParams.getAll("state").length !== 1 ||
            url.searchParams.getAll("code").length !== 1
          )
            throw Error("missing callback");
          const claims = await verify(config, "oauth", stored);
          if (claims.state !== state || typeof claims.verifier !== "string")
            throw Error("state mismatch");
          // Do not forward identity-provider secrets across redirects or put them in URLs/logs.
          const exchange = await fetchGithub(
            "https://github.com/login/oauth/access_token",
            {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.timeout(10000),
              headers: {
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                client_id: config.client,
                client_secret: config.secret,
                code,
                redirect_uri: callback,
                code_verifier: claims.verifier,
              }),
            },
          );
          if (!exchange.ok) throw Error("exchange failed");
          const token = await exchange.json();
          if (
            typeof token.access_token !== "string" ||
            !token.access_token ||
            token.token_type !== "bearer" ||
            typeof token.scope !== "string" ||
            token.scope.trim()
          )
            throw Error("unexpected token permissions");
          const profile = await fetchGithub("https://api.github.com/user", {
            redirect: "error",
            signal: AbortSignal.timeout(10000),
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${token.access_token}`,
              "User-Agent": "DUO-private",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          });
          if (!profile.ok) throw Error("identity failed");
          const owner = await profile.json();
          if (!Number.isSafeInteger(owner.id) || String(owner.id) !== config.id)
            throw Error("not owner");
          // The GitHub token is used only above; neither browser cookies nor storage retain it.
          response = redirect(config.origin + "/");
          response.headers.append(
            "Set-Cookie",
            cookie(
              SESSION,
              await sign(config, "session", {}, SESSION_SECONDS),
              SESSION_SECONDS,
            ),
          );
        } catch {
          response = reply(
            "本人確認ができませんでした。許可されたGitHubアカウントで /auth/login からやり直してください。",
            403,
          );
        }
        response.headers.append("Set-Cookie", cookie(STATE, "", 0));
        return response;
      }
      if (url.pathname === "/auth/logout") {
        if (request.method !== "POST")
          return reply("ログアウトはPOSTで行ってください。", 405, {
            Allow: "POST",
          });
        if (request.headers.get("Origin") !== config.origin)
          return reply("この操作は許可されていません。", 403);
        const response = redirect(config.origin + "/");
        response.headers.append("Set-Cookie", cookie(SESSION, "", 0));
        response.headers.append("Set-Cookie", cookie(STATE, "", 0));
        return response;
      }
      if (url.pathname.startsWith("/auth/"))
        return reply("ページがありません。", 404);
      if (!["GET", "HEAD"].includes(request.method))
        return reply("この操作は許可されていません。", 405, {
          Allow: "GET, HEAD",
        });
      try {
        const session = getCookie(request, SESSION);
        if (!session) throw Error("no session");
        await verify(config, "session", session);
      } catch {
        return url.pathname === "/"
          ? loginPage()
          : reply("GitHubで本人確認してからDUOを開いてください。", 401);
      }
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}
export default createHandler();
