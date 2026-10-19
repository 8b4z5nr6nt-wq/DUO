import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, Response, convertV4MiniflareOptions } from "miniflare";

// Exercise the deployed runtime's fetch implementation. All identities and
// credentials below are fictional; every outbound request stays in this process.
const origin = "https://duo.runtime.invalid";
const tokenEndpoint = "https://github.com/login/oauth/access_token";
const profileEndpoint = "https://api.github.com/user";
const redirectTarget = "https://unexpected-redirect.runtime.invalid/";
const sessionName = "__Host-duo_session";
const stateName = "__Host-duo_oauth";
const bindings = {
  APP_ORIGIN: origin,
  GITHUB_OWNER_ID: "123",
  GITHUB_CLIENT_ID: "fictional-runtime-client",
  GITHUB_CLIENT_SECRET: "fictional-runtime-secret-never-a-real-credential",
};
const accessToken = "fictional-runtime-access-token";
const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../worker/index.js", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
  logLevel: "silent",
});
assert.equal(bundled.outputFiles.length, 1);

let scenario;
const failures = [];
function selectedCookie(response, name) {
  return response.headers
    .getSetCookie()
    .find((value) => value.startsWith(name + "="))
    ?.split(";")[0];
}
async function outbound(request) {
  try {
    assert.ok(scenario, "unexpected outbound request before a scenario");
    scenario.requests.push(request.url);
    if (request.url === tokenEndpoint) {
      assert.equal(request.method, "POST");
      assert.match(
        request.headers.get("Content-Type"),
        /application\/x-www-form-urlencoded/i,
      );
      assert.equal(request.headers.get("Accept"), "application/json");
      const fields = new URLSearchParams(await request.text());
      assert.deepEqual([...fields.keys()].sort(), [
        "client_id",
        "client_secret",
        "code",
        "code_verifier",
        "redirect_uri",
      ]);
      assert.equal(fields.get("client_id"), bindings.GITHUB_CLIENT_ID);
      assert.equal(fields.get("client_secret"), bindings.GITHUB_CLIENT_SECRET);
      assert.equal(fields.get("code"), scenario.code);
      assert.equal(fields.get("redirect_uri"), origin + "/auth/callback");
      const verifier = fields.get("code_verifier");
      assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(
        createHash("sha256").update(verifier).digest("base64url"),
        scenario.challenge,
      );
      if (scenario.kind === "token-redirect")
        return new Response(null, {
          status: 302,
          headers: { Location: redirectTarget },
        });
      if (scenario.kind === "token-error")
        return Response.json(
          {
            error: "incorrect_client_credentials",
            error_description: "fictional-sensitive-provider-description",
          },
          { status: 400 },
        );
      return Response.json({
        access_token: accessToken,
        token_type: "bearer",
        scope: "",
      });
    }
    if (request.url === profileEndpoint) {
      assert.equal(request.method, "GET");
      assert.equal(
        request.headers.get("Authorization"),
        `Bearer ${accessToken}`,
      );
      assert.equal(request.headers.get("User-Agent"), "DUO-private");
      assert.equal(request.headers.get("X-GitHub-Api-Version"), "2022-11-28");
      if (scenario.kind === "profile-redirect")
        return new Response(null, {
          status: 302,
          headers: { Location: redirectTarget },
        });
      return Response.json({
        id: scenario.kind === "other-owner" ? 999 : 123,
        login: "fictional-name-not-used-for-authorization",
      });
    }
    assert.fail(
      "runtime attempted an unapproved outbound URL or followed a redirect",
    );
  } catch (error) {
    failures.push(error);
    return new Response("fictional local probe rejected the request", {
      status: 500,
    });
  }
}

const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: "duo-oauth-runtime-check",
        modules: true,
        compatibilityDate: "2026-10-09",
        script: bundled.outputFiles[0].text,
        bindings,
        outboundService: outbound,
        serviceBindings: {
          ASSETS: async (request) => {
            scenario.assets++;
            assert.equal(new URL(request.url).origin, origin);
            return new Response("fictional private asset", {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
          },
        },
      },
    ],
  }),
);

try {
  for (const [kind, expectedFailure, expectedRequests] of [
    ["success", null, [tokenEndpoint, profileEndpoint]],
    ["token-redirect", "DUO-A07", [tokenEndpoint]],
    ["profile-redirect", "DUO-A09", [tokenEndpoint, profileEndpoint]],
    ["token-error", "DUO-A03", [tokenEndpoint]],
    ["other-owner", "DUO-A10", [tokenEndpoint, profileEndpoint]],
  ]) {
    scenario = {
      kind,
      code: `fictional-code-${kind}`,
      requests: [],
      assets: 0,
    };
    // Prevent the host-side test client from following the login redirect too.
    const started = await mf.dispatchFetch(origin + "/auth/login", {
      redirect: "manual",
    });
    assert.equal(started.status, 303);
    const authorize = new URL(started.headers.get("Location"));
    assert.equal(authorize.origin, "https://github.com");
    assert.equal(authorize.pathname, "/login/oauth/authorize");
    assert.equal(
      authorize.searchParams.get("client_id"),
      bindings.GITHUB_CLIENT_ID,
    );
    assert.equal(authorize.searchParams.get("scope"), "");
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    assert.equal(
      authorize.searchParams.get("redirect_uri"),
      origin + "/auth/callback",
    );
    scenario.challenge = authorize.searchParams.get("code_challenge");
    const stateCookie = selectedCookie(started, stateName);
    assert.ok(stateCookie);
    assert.deepEqual(scenario.requests, []);
    const callback = await mf.dispatchFetch(
      origin +
        "/auth/callback?" +
        new URLSearchParams({
          code: scenario.code,
          state: authorize.searchParams.get("state"),
        }),
      { redirect: "manual", headers: { Cookie: stateCookie } },
    );
    assert.deepEqual(
      failures,
      [],
      "the local outbound probe rejected a request",
    );
    assert.deepEqual(scenario.requests, expectedRequests, kind);
    assert.equal(scenario.assets, 0, kind);
    assert.equal(selectedCookie(callback, stateName), stateName + "=");
    const sessionCookie = selectedCookie(callback, sessionName);
    if (expectedFailure) {
      assert.equal(callback.status, 403, kind);
      assert.equal(sessionCookie, undefined, kind);
      const html = await callback.text();
      assert.ok(html.includes("確認コード：" + expectedFailure), kind);
      for (const value of [
        bindings.GITHUB_CLIENT_SECRET,
        accessToken,
        scenario.code,
        "fictional-sensitive-provider-description",
      ])
        assert.equal(
          html.includes(value),
          false,
          "diagnostic exposed a fictional secret",
        );
      const denied = await mf.dispatchFetch(origin + "/assets/private.txt", {
        redirect: "manual",
      });
      assert.equal(denied.status, 401);
      assert.equal(scenario.assets, 0);
    } else {
      assert.equal(callback.status, 303);
      assert.equal(callback.headers.get("Location"), origin + "/");
      assert.ok(sessionCookie);
      assert.equal(sessionCookie.includes(accessToken), false);
      const asset = await mf.dispatchFetch(origin + "/assets/private.txt", {
        redirect: "manual",
        headers: { Cookie: sessionCookie },
      });
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), "fictional private asset");
      assert.equal(asset.headers.get("Cache-Control"), "private, no-store");
      assert.equal(scenario.assets, 1);
    }
    assert.deepEqual(scenario.requests, expectedRequests);
  }
  console.log(
    "PASS: workerd OAuth exchange, PKCE, owner session, redirects rejected, HTTP 400 diagnostics and other-owner denial (local fictional services only)",
  );
} finally {
  await mf.dispose();
}
