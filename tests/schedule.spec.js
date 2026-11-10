import { navigate } from "../scripts/browser-navigation.mjs";
import { test, expect } from "@playwright/test";
async function stored(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("duo-personal", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const value = await new Promise((resolve, reject) => {
      const r = db.transaction("state").objectStore("state").get("current");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return value;
  });
}
async function seed(page) {
  const numbers = [338, 339, 358, 360, 361, 382, 383, 386, 448, 449, 478, 479];
  const items = numbers.map((number) => ({
    kind: "sentence",
    number,
    section: 1,
    en: `Fictional practice ${number}.`,
    ja: `架空の練習 ${number}。`,
  }));
  items.push({
    kind: "word",
    number: 361,
    section: 1,
    en: "fictional word",
    ja: "架空の単語",
  });
  await page.goto("/#data");
  await page.locator("#import-text").fill(JSON.stringify(items));
  await page
    .getByRole("button", { name: "取り込み前に確認", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容を登録", exact: true })
    .click();
  await expect(page.getByText("13 件登録済み", { exact: true })).toBeVisible();
  await navigate(page, "学習");
}
test("予定表の選択を保存し追加範囲を含めて学習、一覧選択・手入力・初期化とも併用できる", async ({
  page,
}) => {
  await seed(page);
  await page.getByText("タイマー・ヒント", { exact: true }).click();
  await page.getByLabel("時間制限を使う").uncheck();
  await page.getByLabel("ヒントを使う").uncheck();
  await page.getByRole("button", { name: "範囲を選択", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "例文 338を選択", exact: true })
    .check();
  await page.getByRole("button", { name: "選択を確定", exact: true }).click();
  await page.getByLabel("予定表から範囲指定").selectOption("quiz-16");
  await expect(page.locator("#target-count")).toContainText("対象 2 問");
  await expect(page.locator("#range-summary")).toContainText(
    "予定22問・登録済み2問",
  );
  await expect
    .poll(async () => (await stored(page)).settings.studyOptions.sentences)
    .toBe("361-382");
  await page.reload();
  await expect(page.getByLabel("予定表から範囲指定")).toHaveValue("quiz-16");
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
  await expect(page.locator(".prompt")).toHaveText("Fictional practice 361.");
  await page.getByRole("button", { name: "スキップ", exact: true }).click();
  await expect(page.locator(".prompt")).toHaveText("Fictional practice 382.");
  await page.getByRole("button", { name: "スキップ", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "学習結果", exact: true }),
  ).toBeVisible();
  await navigate(page, "学習");
  await page
    .getByLabel("予定表から範囲指定")
    .selectOption("exam-proficiency-3");
  await expect(page.locator("#range-summary")).toContainText(
    "例文339〜478（予定140問・登録済み10問）",
  );
  await expect(page.locator("#target-count")).toContainText("対象 10 問");
  await page.getByText("番号を入力して範囲指定", { exact: true }).click();
  await page.getByLabel("例文番号", { exact: true }).fill("361");
  await expect(page.getByLabel("予定表から範囲指定")).toHaveValue("");
  await expect(page.locator("#target-count")).toContainText("対象 1 問");
  const before = await stored(page);
  await page
    .getByRole("button", { name: "学習設定を初期化", exact: true })
    .click();
  await expect(page.getByLabel("予定表から範囲指定")).toHaveValue("");
  const after = await stored(page);
  expect(after.items).toEqual(before.items);
  expect(after.sessions).toEqual(before.sessions);
  expect(after.records).toEqual(before.records);
});
test("未登録の予定範囲は問題を補完せず開始を止める", async ({ page }) => {
  await seed(page);
  await page.getByLabel("予定表から範囲指定").selectOption("quiz-1");
  await expect(page.locator("#range-summary")).toContainText(
    "予定22問・登録済み0問",
  );
  await expect(
    page.getByRole("button", { name: "学習を開始", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "全範囲に戻す", exact: true }).click();
  await expect(page.getByLabel("予定表から範囲指定")).toHaveValue("");
  await expect(page.locator("#target-count")).toContainText("対象 12 問");
});
