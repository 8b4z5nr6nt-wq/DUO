import { createRemoteJWKSet, jwtVerify } from "jose";

const resolvers = new Map();
const denied = (text, status) =>
  new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

function configuration(env) {
  const issuer = String(env.ACCESS_TEAM_URL || "").replace(/\/$/, "");
  const audience = String(env.ACCESS_AUD || "").trim();
  const owner = String(env.ACCESS_OWNER_EMAIL || "")
    .trim()
    .toLowerCase();
  if (
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) ||
    !audience ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)
  )
    return null;
  return { issuer, audience, owner };
}

export function createHandler(
  resolveKeys = (issuer) => {
    if (!resolvers.has(issuer))
      resolvers.set(
        issuer,
        createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
      );
    return resolvers.get(issuer);
  },
) {
  return {
    async fetch(request, env) {
      const config = configuration(env);
      if (!config)
        return denied(
          "DUOの非公開配信設定が未完了です。管理者がCloudflare Accessの設定を確認してください。",
          503,
        );
      const token = request.headers.get("Cf-Access-Jwt-Assertion");
      if (!token)
        return denied(
          "このDUOは本人専用です。Cloudflare Accessからログインしてください。",
          403,
        );
      let payload;
      try {
        ({ payload } = await jwtVerify(token, resolveKeys(config.issuer), {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ["RS256"],
          requiredClaims: ["exp", "iat", "email", "sub"],
          clockTolerance: 5,
        }));
      } catch {
        return denied(
          "本人確認ができませんでした。Cloudflare Accessからログインし直してください。",
          403,
        );
      }
      if (
        typeof payload.email !== "string" ||
        payload.email.trim().toLowerCase() !== config.owner ||
        payload.type !== "app"
      ) {
        return denied("このDUOへのアクセスは許可されていません。", 403);
      }
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      // Browsers may explicitly store the PWA locally, but shared HTTP caches must not retain it.
      headers.set("Cache-Control", "private, no-store");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "same-origin");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}

export default createHandler();
