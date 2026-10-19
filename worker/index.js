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
const loginErrors = {
  "DUO-A01": [
    "ログインを始めたときのCookieが見つかりません。",
    "Safariの同じタブで、下のボタンからログインを始めてください。途中で別のアプリやブラウザへ切り替えずに進めてください。",
  ],
  "DUO-A02": [
    "ログインを始めたときの情報を確認できませんでした。時間切れや、別のログイン操作との重複が考えられます。",
    "下のボタンからやり直し、同じタブでログインを完了してください。",
  ],
  "DUO-A03": [
    "GitHubのアプリ設定と、Cloudflareに登録したログイン設定が一致していません。",
    "Client IDとClient Secretが、同じGitHubアプリのものか設定画面で確認してください。Secretの値をチャットへ送る必要はありません。",
  ],
  "DUO-A04": [
    "GitHubに登録したログイン後の戻り先URLと、DUOの設定が一致していません。",
    "GitHubのアプリ設定にあるコールバックURLを確認してください。",
  ],
  "DUO-A05": [
    "GitHubの認証コードが無効か、期限切れです。",
    "戻るボタンや再読み込みで認証結果を再利用せず、下のボタンからログインを始めてください。",
  ],
  "DUO-A06": [
    "GitHubアカウントのメールアドレス確認が完了していません。",
    "GitHubの設定でメールアドレスの確認を完了し、下のボタンからやり直してください。DUOへメールアドレスを登録する必要はありません。",
  ],
  "DUO-A07": [
    "GitHubとの認証情報の交換を完了できませんでした。",
    "通信状況を確認し、少し待ってから下のボタンでやり直してください。繰り返す場合は、この画面の確認コードを知らせてください。",
  ],
  "DUO-A08": [
    "GitHubからの認証結果が、DUOで使用する権限や形式と一致していません。",
    "DUO専用のOAuthアプリを使っているか確認してください。原因確認のため、下の確認コードを知らせてください。",
  ],
  "DUO-A09": [
    "GitHubからアカウントの本人情報を取得できませんでした。",
    "少し待ってから下のボタンでやり直してください。繰り返す場合は、この画面の確認コードを知らせてください。",
  ],
  "DUO-A10": [
    "GitHubから確認できたアカウントは、このDUOの利用者として許可されていません。",
    "同じSafariのタブで、GitHubにログインしているアカウントを確認してからやり直してください。",
  ],
  "DUO-A11": [
    "GitHubからのログイン結果が完了していないか、必要な情報が不足しています。",
    "下のボタンからログインを始め、GitHubの承認画面が出たら承認してください。",
  ],
  "DUO-A12": [
    "DUOのログイン処理を完了できませんでした。",
    "下のボタンでやり直してください。繰り返す場合は、この画面の確認コードを知らせてください。",
  ],
};
function authPage(title, content, action, status) {
  // Every argument is fixed application text, never an identity-provider value.
  return reply(
    `<!doctype html><html lang="ja"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DUO ログイン</title><style>body{font-family:system-ui;background:#101113;color:#eee;max-width:32rem;margin:15vh auto;padding:24px;line-height:1.8}a{display:inline-block;color:#17210e;background:#bded99;border-radius:12px;padding:12px 20px;text-decoration:none;font-weight:bold}p{color:#bbc0c8}</style><h1>${title}</h1>${content}<a href="/auth/login">${action}</a><p>学習データはこの端末内に保存されます。</p></html>`,
    status,
    {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    },
  );
}
function loginPage() {
  return authPage(
    "DUO",
    "<p>ご本人だけが使える英語学習アプリです。</p>",
    "GitHubでログイン",
    401,
  );
}
function loginErrorPage(code) {
  const [reason, help] = loginErrors[code];
  return authPage(
    "本人確認ができませんでした",
    `<p>${reason}</p><p>${help}</p><p>確認コード：${code}</p>`,
    "もう一度GitHubでログイン",
    403,
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
        let failure = "DUO-A11";
        try {
          if (request.method !== "GET") throw Error("method");
          const code = url.searchParams.get("code"),
            state = url.searchParams.get("state"),
            stored = getCookie(request, STATE);
          if (
            url.searchParams.has("error") ||
            !code ||
            !state ||
            code.length > 2048 ||
            url.searchParams.getAll("state").length !== 1 ||
            url.searchParams.getAll("code").length !== 1
          )
            throw Error("missing callback");
          failure = "DUO-A01";
          if (!stored) throw Error("missing cookie");
          failure = "DUO-A02";
          const claims = await verify(config, "oauth", stored);
          if (claims.state !== state || typeof claims.verifier !== "string")
            throw Error("state mismatch");
          failure = "DUO-A07";
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
          const token = await exchange.json();
          // Allowlist GitHub's error identifiers. Never display raw provider data.
          if (token.error) {
            switch (token.error) {
              case "incorrect_client_credentials":
                failure = "DUO-A03";
                break;
              case "redirect_uri_mismatch":
                failure = "DUO-A04";
                break;
              case "bad_verification_code":
              case "pkce_verification_failed":
                failure = "DUO-A05";
                break;
              case "unverified_user_email":
                failure = "DUO-A06";
                break;
            }
            throw Error("token exchange rejected");
          }
          if (!exchange.ok) throw Error("exchange failed");
          failure = "DUO-A08";
          if (
            typeof token.access_token !== "string" ||
            !token.access_token ||
            token.token_type !== "bearer" ||
            typeof token.scope !== "string" ||
            token.scope.trim()
          )
            throw Error("unexpected token permissions");
          failure = "DUO-A09";
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
          if (!owner || !Number.isSafeInteger(owner.id) || owner.id <= 0)
            throw Error("invalid identity response");
          failure = "DUO-A10";
          if (String(owner.id) !== config.id) throw Error("not owner");
          failure = "DUO-A12";
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
          response = loginErrorPage(failure);
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
