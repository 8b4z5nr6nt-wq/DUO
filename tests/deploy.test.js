import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { deployPrivate } from "../scripts/deploy-private.mjs";

const name = "GITHUB_CLIENT_SECRET";
const secret = "fictional-test-secret-$(printf-unsafe)-'\"-only";

test("ビルドSecretをPOSIXパイプだけで渡し、子の環境・引数・ログから除く", async () => {
  const messages = [];
  let launches = 0;
  const result = await deployPrivate({
    env: { ...process.env, [name]: secret, WRANGLER_LOG_SANITIZE: "false" },
    output: (m) => messages.push(m),
    launch(command, args, options) {
      launches++;
      assert.equal(command, "/bin/sh");
      assert.equal(options.env[name], undefined);
      assert.equal(options.env.WRANGLER_LOG_SANITIZE, "true");
      assert.equal(args.includes(secret), false);
      assert.deepEqual(args.slice(-2), ["--secrets-file", "/dev/stdin"]);
      assert.deepEqual(options.stdio, ["pipe", "ignore", "ignore"]);
      // Exercise the real shell/pipe, replacing only Wrangler with a local probe.
      return spawn(
        command,
        [
          ...args.slice(0, 4),
          "-e",
          `const fs = require('node:fs');
           const data = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
           if (Object.keys(data).join() !== '${name}' ||
               typeof data.${name} !== 'string' || data.${name}.length < 32 ||
               process.env.${name}) process.exit(2);
           if (require('node:crypto').createHash('sha256').update(data.${name}).digest('hex') !==
               '${createHash("sha256").update(secret).digest("hex")}') process.exit(3);
           console.log(data.${name}); console.error(data.${name});`,
        ],
        options,
      );
    },
  });
  assert.equal(result, 0);
  assert.equal(launches, 1);
  assert.equal(messages.join().includes(secret), false);
  assert.match(messages.at(-1), /配信が完了/);
});

test("未登録・短すぎる・空白を含むSecretでは配信前に停止し値を表示しない", async () => {
  for (const value of [
    undefined,
    "fictional-short",
    secret + "\n",
    " " + secret,
  ]) {
    const messages = [];
    let launches = 0;
    assert.equal(
      await deployPrivate({
        env: { [name]: value },
        output: (m) => messages.push(m),
        launch() {
          launches++;
          throw Error("配信を起動してはいけない");
        },
      }),
      1,
    );
    assert.equal(launches, 0);
    assert.match(messages.join(), /GITHUB_CLIENT_SECRET/);
    if (value) assert.equal(messages.join().includes(value), false);
  }
});

test("dry-runはSecretを子へ渡さず配信しない固定引数だけを使う", async () => {
  let launches = 0;
  assert.equal(
    await deployPrivate({
      dryRun: true,
      env: { ...process.env, [name]: secret },
      output() {},
      launch(command, args, options) {
        launches++;
        assert.equal(command, process.execPath);
        assert.ok(args.includes("--dry-run"));
        assert.equal(args.includes("--secrets-file"), false);
        assert.equal(options.env[name], undefined);
        assert.equal(options.stdio[0], "ignore");
        return spawn(command, ["-e", "process.exit(0)"], options);
      },
    }),
    0,
  );
  assert.equal(launches, 1);
});

test("配信プロセス失敗・起動失敗では値を漏らさず失敗として終了する", async () => {
  for (const launch of [
    () => {
      throw Error(secret);
    },
    (_command, _args, options) =>
      spawn(process.execPath, ["-e", "process.exit(7)"], options),
    (_command, _args, options) =>
      spawn("/duo-nonexistent-executable", [], options),
  ]) {
    const messages = [];
    assert.equal(
      await deployPrivate({
        env: { ...process.env, [name]: secret },
        launch,
        output: (m) => messages.push(m),
      }),
      1,
    );
    assert.equal(messages.join().includes(secret), false);
    assert.match(messages.at(-1), /失敗/);
  }
});

test("CLIは任意の配信先・追加引数を受け付けない", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../scripts/deploy-private.mjs", import.meta.url)),
      "--name",
      "other",
    ],
    { encoding: "utf8", env: { ...process.env, [name]: secret } },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /使用方法/);
  assert.equal((result.stdout + result.stderr).includes(secret), false);
});
