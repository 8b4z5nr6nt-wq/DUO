import { test, expect } from "@playwright/test";
async function demo(page) {
  await page.goto("/#data");
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await expect(page.getByText("4 件登録済み")).toBeVisible();
}
async function setup(page, kind = "word", direction = "ja-en", count = "1") {
  await page.getByRole("link", { name: "学習", exact: true }).click();
  await page
    .getByRole("combobox", { name: "種類", exact: true })
    .selectOption(kind);
  await page.getByLabel("出題方向").selectOption(direction);
  await page.getByLabel("問題数（空欄は全問）").fill(count);
  await page.getByLabel("時間制限を使う").uncheck();
  await page.getByLabel("ヒントを使う").uncheck();
  await page.getByRole("button", { name: "学習を開始" }).click();
}
test("オフラインで再読み込み・検索・4方向学習・履歴保存・再挑戦・バックアップ", async ({
  page,
  context,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await demo(page);
  await expect(page.locator("#connection")).toContainText("オフライン準備完了");
  await page.evaluate(() =>
    navigator.serviceWorker.ready.then(
      () =>
        new Promise((resolve) =>
          navigator.serviceWorker.controller
            ? resolve()
            : navigator.serviceWorker.addEventListener(
                "controllerchange",
                resolve,
                { once: true },
              ),
        ),
    ),
  );
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("4 件登録済み")).toBeVisible();
  await page.getByRole("link", { name: "検索", exact: true }).click();
  await page.getByRole("button", { name: "単語モード", exact: true }).click();
  await page.getByLabel("番号・英語・日本語").fill("moon");
  await expect(page.locator("#list")).toContainText("月の庭");
  await page.locator("#list a").click();
  await expect(
    page.getByText("moon gardener（番号なし・表示のみ）"),
  ).toBeVisible();
  await page.getByRole("button", { name: "☆ お気に入り" }).click();
  await expect(
    page.getByRole("button", { name: "★ お気に入り解除" }),
  ).toBeVisible();
  await setup(page);
  await page.getByLabel("あなたの回答").fill("wrong answer");
  await page.getByRole("button", { name: "回答を確認" }).click();
  await page.locator("#correctness").selectOption("incorrect");
  await page
    .getByRole("button", { name: "覚えてないとして記録し、その場で再挑戦" })
    .click();
  await expect(
    page.getByText("再挑戦中：前の間違いの記録は残ります。"),
  ).toBeVisible();
  await page.getByLabel("あなたの回答").fill("MOON  GARDEN");
  await page.getByLabel("あなたの回答").press("Enter");
  await expect(page.getByText("登録された正解と一致しました")).toBeVisible();
  await page.getByRole("button", { name: "覚えた", exact: true }).click();
  await expect(page.getByRole("heading", { name: "学習結果" })).toBeVisible();
  await expect(page.getByText("2 回答", { exact: false })).toBeVisible();
  await expect(
    page.getByText("正解 1 / 不正解 1", { exact: false }),
  ).toBeVisible();
  for (const [kind, direction, answer] of [
    ["word", "en-ja", "月の庭"],
    ["sentence", "en-ja", "私のロボットは青いトマトを育てます。"],
    ["sentence", "ja-en", "My robot grows blue tomatoes."],
  ]) {
    await setup(page, kind, direction);
    await page.getByLabel("あなたの回答").fill(answer);
    await page.getByRole("button", { name: "回答を確認" }).click();
    await page.getByRole("button", { name: "覚えた", exact: true }).click();
    await expect(page.getByRole("heading", { name: "学習結果" })).toBeVisible();
  }
  await page.reload();
  await page.getByRole("link", { name: "記録", exact: true }).click();
  await expect(page.getByRole("heading", { name: "学習履歴" })).toBeVisible();
  await expect(
    page.getByText("正解 1 / 不正解 1", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "データ", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSONバックアップを保存" }).click();
  expect((await downloaded).suggestedFilename()).toContain("duo-backup");
  expect(errors).toEqual([]);
});
test("タイマー・ヒント・一時停止・時間切れ後の再挑戦", async ({ page }) => {
  await demo(page);
  await page.getByRole("link", { name: "学習", exact: true }).click();
  await page.getByLabel("問題数（空欄は全問）").fill("1");
  await page.getByLabel("制限時間（秒）").fill("3");
  await page.getByLabel("ヒント開始（秒）").fill("0");
  await page.getByLabel("ヒント間隔（秒）").fill("1");
  await page.getByRole("button", { name: "学習を開始" }).click();
  await expect(page.locator("#hint")).toContainText("ヒント");
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  const before = await page.locator("#timer").textContent();
  await page.waitForTimeout(1200);
  expect(await page.locator("#timer").textContent()).toBe(before);
  await expect(page.getByLabel("あなたの回答")).toBeDisabled();
  await page.getByRole("button", { name: "再開", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "時間切れ", exact: true }),
  ).toBeVisible({ timeout: 6000 });
  await page
    .getByRole("button", { name: "覚えてないとして記録し、その場で再挑戦" })
    .click();
  await page
    .getByLabel("あなたの回答")
    .fill("私のロボットは青いトマトを育てます。");
  await page.getByRole("button", { name: "回答を確認" }).click();
  await expect(
    page.getByRole("heading", { name: "時間切れ", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "覚えた", exact: true }).click();
  await expect(page.getByText("時間切れ 1", { exact: false })).toBeVisible();
});
test("取込検証・CSV登録・編集・追加統合と置換復元", async ({ page }) => {
  await page.goto("/#data");
  await page.locator("#import-text").fill(
    JSON.stringify([
      {
        kind: "word",
        number: 3,
        section: 9,
        en: "safe <script>",
        ja: "安全",
        notes: "<img src=x onerror=alert(1)>",
      },
    ]),
  );
  await page.getByRole("button", { name: "取り込み前に確認" }).click();
  await expect(page.locator("#preview")).toContainText("safe <script>");
  await page.getByRole("button", { name: "この内容を登録" }).click();
  await expect(page.getByText("1 件登録済み")).toBeVisible();
  await page
    .locator("#import-text")
    .fill(
      JSON.stringify([
        { kind: "word", number: 3, section: 9, en: "duplicate", ja: "重複" },
      ]),
    );
  await page.getByRole("button", { name: "取り込み前に確認" }).click();
  await expect(page.locator("#preview")).toContainText("番号重複");
  await expect(
    page.getByRole("button", { name: "この内容を登録" }),
  ).toBeDisabled();
  await page.locator("#import-format").selectOption("csv");
  await page
    .locator("#import-text")
    .fill("kind,number,section,en,ja\nword,4,9,test,テスト");
  await page.getByRole("button", { name: "取り込み前に確認" }).click();
  await page.getByRole("button", { name: "この内容を登録" }).click();
  await expect(page.getByText("2 件登録済み")).toBeVisible();
  await page.getByRole("link", { name: "検索", exact: true }).click();
  await page.getByRole("button", { name: "単語モード", exact: true }).click();
  await page.getByLabel("番号・英語・日本語").fill("test");
  await page.locator("#list a").click();
  await page.getByRole("link", { name: "編集", exact: true }).click();
  await page.getByLabel("主要な日本語の意味・訳").fill("編集済み");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("編集済み", { exact: true })).toBeVisible();
  const backup = {
    version: 1,
    items: [
      {
        kind: "sentence",
        number: 1,
        section: 1,
        en: "Restore me.",
        ja: "復元する。",
      },
    ],
    records: {},
    sessions: [],
    settings: {
      goal: 12,
      intervals: [1, 3, 7],
      ignoreCase: true,
      ignoreSpaces: true,
      ignorePunctuation: false,
      limit: 30,
      hintStart: 10,
      hintInterval: 3,
      timer: true,
      hints: true,
    },
  };
  await page.getByRole("link", { name: "データ", exact: true }).click();
  await page.locator("#backup-text").fill(JSON.stringify(backup));
  await page.getByRole("button", { name: "復元前に確認" }).click();
  await page.getByRole("button", { name: "この内容で復元" }).click();
  await expect(page.getByText("3 件登録済み")).toBeVisible();
  await page.locator("#restore-mode").selectOption("replace");
  await page.locator("#backup-text").fill(JSON.stringify(backup));
  await page.getByRole("button", { name: "復元前に確認" }).click();
  await page.getByRole("button", { name: "この内容で復元" }).click();
  await expect(page.locator("#notice")).toContainText("確認チェック");
  await page.getByLabel("既存データを消すことを確認しました").check();
  await page.getByRole("button", { name: "この内容で復元" }).click();
  await expect(page.getByText("1 件登録済み")).toBeVisible();
  await page.reload();
  await expect(page.getByText("1 件登録済み")).toBeVisible();
});
test("IME確定中のEnterを送信せず、画面離脱時に停止する", async ({ page }) => {
  await demo(page);
  await setup(page);
  const input = page.getByLabel("あなたの回答");
  await input.fill("変換中");
  await input.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart"));
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        isComposing: true,
      }),
    );
  });
  await expect(page.getByRole("button", { name: "回答を確認" })).toBeVisible();
  await input.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionend"));
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  await expect(page.getByRole("button", { name: "回答を確認" })).toBeVisible();
  await page.getByRole("link", { name: "ホーム", exact: true }).click();
  await page.getByRole("link", { name: "途中の学習を再開" }).click();
  await expect(
    page.getByText("一時停止中です。タイマーは進みません。"),
  ).toBeVisible();
});
test("容量不足は日本語で表示し、未保存データを登録済みにしない", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (window.failSave) throw new DOMException("full", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await page.goto("/#data");
  await page.evaluate(() => (window.failSave = true));
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await expect(page.locator("#notice")).toContainText("端末の保存容量が不足");
  await expect(page.getByText("0 件登録済み")).toBeVisible();
  await page.evaluate(() => (window.failSave = false));
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await expect(page.getByText("4 件登録済み")).toBeVisible();
});
test("複数画面で古いデータを上書きしない", async ({ page, context }) => {
  await page.goto("/#data");
  const other = await context.newPage();
  await other.goto("/#data");
  await expect(other.getByText("0 件登録済み")).toBeVisible();
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await expect(page.getByText("4 件登録済み")).toBeVisible();
  await other.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await expect(other.locator("#notice")).toContainText(
    "別のDUO画面でデータが更新",
  );
  await other.reload();
  await expect(other.getByText("4 件登録済み")).toBeVisible();
});
