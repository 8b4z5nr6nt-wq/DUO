import { navigate } from "../scripts/browser-navigation.mjs";
import { test, expect } from "@playwright/test";
async function seed(page) {
  await page.goto("/#data");
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await expect(page.getByText("4 件登録済み")).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("duo-personal", 1);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise((resolve) => {
      const tx = db.transaction("state", "readwrite"),
        store = tx.objectStore("state"),
        r = store.get("current");
      r.onsuccess = () => {
        const s = r.result;
        const base = s.items.find((x) => x.kind === "word");
        s.items.push(
          ...[101, 102, 103].map((n) => ({
            ...base,
            number: n,
            en: `test word ${n}`,
            ja: `試験単語${n}`,
          })),
        );
        store.put(s, "current");
      };
      tx.oncomplete = resolve;
    });
    db.close();
  });
  await page.reload();
  await navigate(page, "学習");
  await page
    .getByRole("combobox", { name: "種類", exact: true })
    .selectOption("word");
  await page.getByLabel("出題方向").selectOption("ja-en");
  await page.getByLabel("問題数（空欄は全問）").fill("1");
  await page.getByText("タイマー・ヒント", { exact: true }).click();
  await page.getByLabel("時間制限を使う").uncheck();
  await page.getByLabel("ヒントを使う").uncheck();
}
test("スクリブル変換文字の自動評価と再読み込み後の設定・履歴保持、設定だけ初期化", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole("combobox", { name: "回答方法", exact: true })
    .selectOption("scribble");
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
  await expect(page.locator(".scribble-help")).toBeVisible();
  await page.getByLabel("あなたの回答").fill("moon garden");
  await page.getByRole("button", { name: "回答を確認", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "一致率 100% · 覚えた" }),
  ).toBeVisible();
  await page.locator("#auto-next").click();
  await expect(page.getByRole("heading", { name: "学習結果" })).toBeVisible();
  await page.goto("/#setup");
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "回答方法", exact: true }),
  ).toHaveValue("scribble");
  await expect(
    page.getByRole("combobox", { name: "種類", exact: true }),
  ).toHaveValue("word");
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "学習設定を初期化", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "回答方法", exact: true }),
  ).toHaveValue("text");
  expect(await snapshot(page)).toEqual(before);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "回答方法", exact: true }),
  ).toHaveValue("text");
  expect(
    await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("duo-personal", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const s = await new Promise((resolve) => {
      const r = db.transaction("state").objectStore("state").get("current");
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return { items: s.items, sessions: s.sessions, records: s.records };
  });
}
test("4択は4つの登録済み候補で自動採点し、カードは自己評価で履歴保存", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole("combobox", { name: "回答方法", exact: true })
    .selectOption("choice");
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
  await expect(page.locator("[data-choice]")).toHaveCount(4);
  await page.getByRole("button", { name: "moon garden", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "一致率 100% · 覚えた" }),
  ).toBeVisible();
  await page.locator("#auto-next").click();
  await navigate(page, "学習");
  await page
    .getByRole("combobox", { name: "回答方法", exact: true })
    .selectOption("card");
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
  await expect(page.locator(".learning-card")).not.toContainText("moon garden");
  await page
    .getByRole("button", { name: "カードをめくる", exact: true })
    .click();
  await expect(page.locator(".learning-card")).toContainText("moon garden");
  await page.getByRole("button", { name: "微妙", exact: true }).click();
  const s = await snapshot(page);
  expect(s.sessions.flatMap((x) => x.attempts).map((x) => x.rating)).toEqual([
    2, 1,
  ]);
});
