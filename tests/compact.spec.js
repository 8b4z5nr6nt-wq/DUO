import { test, expect } from "@playwright/test";
import { navigate } from "../scripts/browser-navigation.mjs";
async function state(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const req = indexedDB.open("duo-personal", 1);
      req.onsuccess = () => resolve(req.result);
    });
    const data = await new Promise((resolve) => {
      const req = db.transaction("state").objectStore("state").get("current");
      req.onsuccess = () => resolve(req.result);
    });
    db.close();
    return data;
  });
}
async function prepare(page) {
  await page.goto("/#data");
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await page.getByText("4 件登録済み", { exact: true }).waitFor();
  await navigate(page, "学習");
  await page
    .getByRole("combobox", { name: "種類", exact: true })
    .selectOption("word");
  await page
    .getByRole("combobox", { name: "出題方向", exact: true })
    .selectOption("ja-en");
  await page.getByLabel("問題数（空欄は全問）").fill("1");
  await page.getByText("タイマー・ヒント", { exact: true }).click();
  await page.getByLabel("時間制限を使う").uncheck();
  await page.getByLabel("ヒントを使う").uncheck();
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
}
test("前回設定から直接開始し、方向・問題数・教材・過去の履歴と評価を保持する", async ({
  page,
}) => {
  await prepare(page);
  await page.getByLabel("あなたの回答", { exact: true }).fill("moon garden");
  await page.getByRole("button", { name: "回答を確認", exact: true }).click();
  await page.locator("#auto-next").click();
  await expect(
    page.getByRole("heading", { name: "学習結果", exact: true }),
  ).toBeVisible();
  const before = await state(page);
  await navigate(page, "ホーム");
  await expect(
    page.getByRole("img", { name: /今日 1問 \/ 目標 \d+問/, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "前回の設定で開始", exact: true })
    .click();
  await expect(page.locator(".prompt")).toHaveText("月の庭");
  const after = await state(page);
  expect(after.items).toEqual(before.items);
  expect(after.records).toEqual(before.records);
  expect(after.settings).toEqual(before.settings);
  expect(after.sessions.slice(0, -1)).toEqual(before.sessions);
  expect(after.sessions.at(-1).direction).toBe("ja-en");
  await expect(page.locator("#timer")).toHaveText("時間制限なし");
  await page.getByRole("button", { name: "スキップ", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "学習結果", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "スキップ 1", exact: true }),
  ).toBeVisible();
});
test("途中の学習は新規開始より優先し、再開時に下書きと同じ履歴を保持する", async ({
  page,
}) => {
  await prepare(page);
  await page.getByLabel("あなたの回答", { exact: true }).fill("draft answer");
  const before = await state(page);
  await navigate(page, "ホーム");
  await expect(
    page.getByRole("button", { name: "前回の設定で開始", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "途中の学習を再開", exact: true })
    .click();
  await expect(page.locator("#answer")).toHaveValue("draft answer");
  await expect(page.locator("#answer")).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "一時停止", exact: true }),
  ).toBeVisible();
  const after = await state(page);
  expect(after.sessions).toEqual(before.sessions);
  expect(after.items).toEqual(before.items);
});
