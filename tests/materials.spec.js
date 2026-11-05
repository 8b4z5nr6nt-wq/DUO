import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("教材JSONをファイルで登録・更新し関連語を検索、履歴を保持する", async ({
  page,
}) => {
  await page.goto("/#data");
  const raw = JSON.parse(
    readFileSync(
      new URL("../examples/materials-fictional.json", import.meta.url),
    ),
  );
  const upload = async () => {
    await page
      .locator("#import-file")
      .setInputFiles({
        name: "fictional.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(raw)),
      });
    await page
      .getByRole("button", { name: "取り込み前に確認", exact: true })
      .click();
    await page
      .getByRole("button", { name: "この内容を登録", exact: true })
      .click();
  };
  await upload();
  await expect(page.getByText("2 件登録済み")).toBeVisible();
  await page.getByRole("link", { name: "検索", exact: true }).click();
  await page.getByRole("button", { name: "単語モード", exact: true }).click();
  await page.getByLabel("番号・英語・日本語").fill("moon painter");
  await expect(page.locator("#list")).toContainText("paint");
  await page.goto("/#detail/word/1");
  await expect(page.locator("main")).toContainText("月の絵描き");
  await page.goto("/#setup");
  await page.getByText("タイマー・ヒント", { exact: true }).click();
  await page.getByLabel("時間制限を使う").uncheck();
  await page.getByLabel("ヒントを使う").uncheck();
  await page.getByLabel("問題数（空欄は全問）").fill("1");
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
  await page.getByRole("button", { name: "スキップ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "学習結果" })).toBeVisible();
  await page.goto("/#data");
  await page.locator("#import-mode").selectOption("update");
  raw.sections[0].sentences[0].words[0].ja = "色を塗る";
  await upload();
  await expect(page.getByText("2 件登録済み")).toBeVisible();
  await page.goto("/#result");
  await expect(page.locator("main")).toContainText("スキップ 1");
  await page.reload();
  await expect(page.locator("main")).toContainText("スキップ 1");
});
