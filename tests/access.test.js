import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
import { createHandler } from "../worker/index.js";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey);
const handler = createHandler(() =>
  createLocalJWKSet({
    keys: [{ ...jwk, kid: "test", alg: "RS256", use: "sig" }],
  }),
);
const settings = {
  ACCESS_TEAM_URL: "https://fictional-team.cloudflareaccess.com",
  ACCESS_AUD: "test-audience",
  ACCESS_OWNER_EMAIL: "owner@example.invalid",
};
async function token(changes = {}, signingKey = privateKey) {
  return new SignJWT({
    email: "owner@example.invalid",
    type: "app",
    ...changes,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(changes.iss || settings.ACCESS_TEAM_URL)
    .setAudience(changes.aud || settings.ACCESS_AUD)
    .setSubject("fictional-owner")
    .setIssuedAt()
    .setExpirationTime(changes.exp || "1h")
    .sign(signingKey);
}
async function request(jwt, env = settings, path = "/") {
  let fetched = 0;
  const response = await handler.fetch(
    new Request(`https://duo.example.invalid${path}`, {
      headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {},
    }),
    {
      ...env,
      ASSETS: {
        fetch: () => {
          fetched++;
          return new Response("fictional asset");
        },
      },
    },
  );
  return { response, fetched };
}
test("認証設定が未完了なら全ファイルを返さない", async () => {
  for (const env of [
    {},
    { ...settings, ACCESS_AUD: "" },
    { ...settings, ACCESS_TEAM_URL: "https://attacker.invalid" },
  ]) {
    const { response, fetched } = await request(await token(), env);
    assert.equal(response.status, 503);
    assert.equal(fetched, 0);
  }
});
test("未認証・偽造トークンはHTML/JS/SW/アイコンを返さない", async () => {
  for (const path of [
    "/",
    "/index.html",
    "/assets/app.js",
    "/sw.js",
    "/icon-192.png",
  ]) {
    for (const jwt of [undefined, "forged-token"]) {
      const { response, fetched } = await request(jwt, settings, path);
      assert.equal(response.status, 403);
      assert.equal(fetched, 0);
    }
  }
});
test("署名・発行者・対象アプリ・期限・許可メールを検証する", async () => {
  const alien = await generateKeyPair("RS256");
  const tokens = [
    await token({}, alien.privateKey),
    await token({ iss: "https://other.cloudflareaccess.com" }),
    await token({ aud: "another-app" }),
    await token({ exp: Math.floor(Date.now() / 1000) - 60 }),
    await token({ email: "stranger@example.invalid" }),
    await token({ type: "service" }),
    await new SignJWT({ email: settings.ACCESS_OWNER_EMAIL, type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(settings.ACCESS_TEAM_URL)
      .setAudience(settings.ACCESS_AUD)
      .setSubject("fictional-owner")
      .setIssuedAt()
      .sign(privateKey),
  ];
  for (const jwt of tokens) {
    const { response, fetched } = await request(jwt);
    assert.equal(response.status, 403);
    assert.equal(fetched, 0);
  }
});
test("本人の検証済みトークンだけに静的ファイルを返す", async () => {
  const { response, fetched } = await request(await token());
  assert.equal(response.status, 200);
  assert.equal(fetched, 1);
  assert.equal(await response.text(), "fictional asset");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
