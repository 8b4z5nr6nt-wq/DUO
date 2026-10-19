// Explicit Cloudflare Builds deployment. Secret values never enter argv, files, or logs.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
const secretName = "GITHUB_CLIENT_SECRET";

export async function deployPrivate({
  dryRun = false,
  env = process.env,
  launch = spawn,
  output = (message) => console.log(message),
} = {}) {
  const secret = env[secretName];
  if (
    !dryRun &&
    (typeof secret !== "string" ||
      secret.length < 32 ||
      /[^\x21-\x7e]/.test(secret))
  ) {
    output(
      "配信を中止しました。ビルド用のSecret GITHUB_CLIENT_SECRETの名前・登録内容を確認してください。値をチャットへ送る必要はありません。",
    );
    return 1;
  }

  const childEnv = {
    ...env,
    WRANGLER_LOG_SANITIZE: "true",
    WRANGLER_LOG: "error",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_HIDE_BANNER: "true",
  };
  delete childEnv[secretName];
  const args = [wrangler, "deploy", "--config", join(root, "wrangler.jsonc")];
  if (dryRun)
    args.push("--dry-run", "--outdir", join(tmpdir(), "duo-worker-build"));
  else args.push("--secrets-file", "/dev/stdin");

  output(
    dryRun ? "配信せずに構成を確認します。" : "本人限定サイトを配信します。",
  );
  const ok = await new Promise((done) => {
    let child;
    try {
      // Node's stdin socket cannot be opened by Wrangler's readFileSync.
      // cat creates a POSIX pipe; the shell source is fixed and contains no values.
      child = launch(
        dryRun ? process.execPath : "/bin/sh",
        dryRun
          ? args
          : ["-c", 'cat | "$@"', "duo-secret-input", process.execPath, ...args],
        {
          cwd: root,
          env: childEnv,
          stdio: [dryRun ? "ignore" : "pipe", "ignore", "ignore"],
        },
      );
    } catch {
      done(false);
      return;
    }
    let inputFailed = false;
    child.once("error", () => done(false));
    child.once("close", (code) => done(code === 0 && !inputFailed));
    if (!dryRun) {
      child.stdin.on("error", () => {
        inputFailed = true;
      });
      child.stdin.end(JSON.stringify({ [secretName]: secret }));
    }
  });
  output(
    ok
      ? dryRun
        ? "構成の確認が完了しました。配信・Secretの送信は行っていません。"
        : "配信が完了しました。DUOのURLを再読み込みしてください。"
      : "処理に失敗しました。ビルド用Secretの登録、Workerの配信権限、構成を確認してください。機密保護のため詳細ログは表示しません。",
  );
  return ok ? 0 : 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 1 && args[0] === "--dry-run")) {
    console.error("使用方法: npm run deploy:private [-- --dry-run]");
    process.exitCode = 1;
  } else {
    process.exitCode = await deployPrivate({ dryRun: args.length === 1 });
  }
}
