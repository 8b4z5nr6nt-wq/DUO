import { navigate } from "../scripts/browser-navigation.mjs";
import { test, expect } from "@playwright/test";
async function demo(page) {
  await page.goto("/#data");
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await expect(page.getByText("4 件登録済み")).toBeVisible();
  await navigate(page, "学習");
}
const choose = (page) =>
  page.getByRole("button", { name: "範囲を選択", exact: true }).click();
const confirm = (page) =>
  page.getByRole("button", { name: "選択を確定", exact: true });
const pick = (page, label) =>
  page.getByRole("checkbox", { name: label + "を選択", exact: true });
async function stored(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("duo-personal", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const value = await new Promise((resolve) => {
      const r = db.transaction("state").objectStore("state").get("current");
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return value;
  });
}
test("例文と単語を別セクションから選び、その問題だけを学習・保存する", async ({
  page,
}) => {
  await demo(page);
  await page.getByText("タイマー・ヒント", { exact: true }).click();
  await page.getByLabel("時間制限を使う").uncheck();
  await page.getByLabel("ヒントを使う").uncheck();
  await choose(page);
  await expect(confirm(page)).toBeDisabled();
  await page.getByRole("button", { name: "セクション 2", exact: true }).click();
  await pick(page, "例文 2").check();
  await page.getByRole("button", { name: "単語モード", exact: true }).click();
  await page.getByRole("button", { name: "セクション 1", exact: true }).click();
  await pick(page, "単語 1").check();
  await expect(page.locator("#selection-count")).toHaveText("2 問を選択中");
  await confirm(page).click();
  await expect(page.locator("#target-count")).toContainText("対象 2 問");
  await expect(
    page.getByRole("combobox", { name: "種類", exact: true }),
  ).toHaveValue("all");
  await page.reload();
  await expect(page.locator("#range-summary")).toContainText(
    "一覧から 2 問選択",
  );
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
  await expect(page.locator(".prompt")).toHaveText("moon garden");
  await page.getByRole("button", { name: "スキップ", exact: true }).click();
  await expect(page.locator(".prompt")).toHaveText(
    "A tiny dragon opened the window.",
  );
  await page.getByRole("button", { name: "スキップ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "学習結果" })).toBeVisible();
  const data = await stored(page);
  expect(data.items).toHaveLength(4);
  expect(
    data.sessions
      .flatMap((s) => s.attempts)
      .map((a) => `${a.kind}:${a.number}`),
  ).toEqual(["word:1", "sentence:2"]);
  expect(new Set(data.settings.studyOptions.selectedIds)).toEqual(
    new Set(["sentence:2", "word:1"]),
  );
});
test("検索・セクション移動でも選択を保持し、表示中だけを一括選択・解除する", async ({
  page,
}) => {
  await demo(page);
  await choose(page);
  await page
    .getByRole("button", { name: "表示中を全選択", exact: true })
    .click();
  await page.getByLabel("番号・英語・日本語").fill("dragon");
  await page
    .getByRole("button", { name: "表示中を全選択", exact: true })
    .click();
  await expect(page.locator("#selection-count")).toHaveText("2 問を選択中");
  await page.getByRole("button", { name: "表示中を解除", exact: true }).click();
  await expect(page.locator("#selection-count")).toHaveText("1 問を選択中");
  await page.getByLabel("番号・英語・日本語").fill("robot");
  await expect(pick(page, "例文 1")).toBeChecked();
  await confirm(page).click();
  await choose(page);
  await expect(pick(page, "例文 1")).toBeChecked();
  await page.getByRole("button", { name: "選択を全解除", exact: true }).click();
  await expect(confirm(page)).toBeDisabled();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(page.locator("#range-summary")).toContainText(
    "一覧から 1 問選択",
  );
  await page.reload();
  await expect(page.locator("#target-count")).toContainText("対象 1 問");
  const before = await stored(page);
  await page.getByRole("button", { name: "全範囲に戻す", exact: true }).click();
  await expect(page.locator("#target-count")).toContainText("対象 2 問");
  const after = await stored(page);
  expect(after.settings.studyOptions.selectedIds).toBeNull();
  for (const key of ["items", "sessions", "records"])
    expect(after[key]).toEqual(before[key]);
});
test("番号指定と一覧選択を切り替え、通常の検索は詳細を開ける", async ({
  page,
}) => {
  await demo(page);
  await page.getByText("番号を入力して範囲指定", { exact: true }).click();
  await page.getByLabel("例文番号", { exact: true }).fill("2");
  await choose(page);
  await page.getByRole("button", { name: "セクション 2", exact: true }).click();
  await expect(pick(page, "例文 2")).toBeChecked();
  await page.getByRole("button", { name: "セクション 1", exact: true }).click();
  await pick(page, "例文 1").check();
  await confirm(page).click();
  await expect(page.locator("#target-count")).toContainText("対象 2 問");
  await page.getByText("番号を入力して範囲指定", { exact: true }).click();
  await page.getByLabel("例文番号", { exact: true }).fill("1");
  await expect(page.locator("#range-summary")).toContainText(
    "番号で指定した範囲",
  );
  await expect(page.locator("#target-count")).toContainText("対象 1 問");
  await navigate(page, "検索");
  await expect(page.locator("[data-pick-id]")).toHaveCount(0);
  await page.locator("#list a.list-item").click();
  await expect(
    page.getByRole("heading", { name: "例文 1", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.body.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
