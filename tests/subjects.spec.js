import { test, expect } from "@playwright/test";
import { navigate } from "../scripts/browser-navigation.mjs";

function material(subject, cards) {
  return { format: "subject-cards", version: 1, subject, cards };
}
const modern = {
  deck: "modern",
  number: 1,
  question: "現代文の見出し語",
  answer: "現代文の答え",
};
const classical = {
  deck: "classical",
  number: 1,
  question: "古文の見出し語",
  answer: "古文の答え",
};
const history = {
  number: 1,
  question: "年代を尋ねる問題",
  answer: "歴史総合の答え",
};

async function upload(page, value) {
  await page.getByLabel("JSONファイル").setInputFiles({
    name: "cards.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await page.getByRole("button", { name: "取り込み前に確認" }).click();
}
async function confirm(page) {
  await page.getByRole("button", { name: "この内容を登録" }).click();
}

test("起動時の科目選択から英語の既存ホーム・教材に戻れる", async ({ page }) => {
  await page.goto("/#data");
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await expect(page.getByText("4 件登録済み", { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "科目を選ぶ" })).toBeVisible();
  for (const subject of ["英", "国", "時", "歴"])
    await expect(
      page.getByRole("link", { name: new RegExp(`^${subject} `) }),
    ).toBeVisible();
  await page.getByRole("link", { name: "英 英語", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "ホーム", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("4 件登録済み", { exact: true })).toBeVisible();
  await navigate(page, "科目を選ぶ");
  await expect(page.getByRole("heading", { name: "科目を選ぶ" })).toBeVisible();
});

test("国語と歴史総合は別々に取り込み、評価を残してオフラインでカードを学べる", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: /^国 / }).click();
  await page.getByRole("link", { name: "JSONを取り込む" }).click();
  await upload(page, material("history", [history]));
  await expect(
    page.getByText("選択中の科目とJSONの科目が一致しません。"),
  ).toBeVisible();
  await upload(page, material("ja", [modern, modern]));
  await expect(
    page.getByText("現代文単語の番号1が重複しています。"),
  ).toBeVisible();
  await upload(page, material("ja", [modern, classical]));
  await expect(page.getByText("追加 2件 · 更新 0件")).toBeVisible();
  await confirm(page);
  await page.getByLabel("学習範囲").selectOption("classical");
  await expect(page.getByText("1枚 · 覚えた 0枚")).toBeVisible();
  await page.getByRole("button", { name: "カード学習を開始" }).click();
  await expect(page.locator(".prompt")).toHaveText(classical.question);
  await expect(page.getByText(classical.answer, { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "カードをめくる" }).click();
  await expect(page.getByText(classical.answer, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "覚えた →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "学習結果" })).toBeVisible();
  await navigate(page, "科目を選ぶ");
  await page.getByRole("link", { name: /^歴 / }).click();
  await expect(page.getByText("0枚 · 覚えた 0枚")).toBeVisible();
  await page.getByRole("link", { name: "JSONを取り込む" }).click();
  await page
    .getByLabel("またはJSONを貼り付け")
    .fill(JSON.stringify(material("history", [history])));
  await page.getByRole("button", { name: "取り込み前に確認" }).click();
  await confirm(page);

  await expect(page.locator("#connection")).toContainText("オフライン準備完了");
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "カード学習を開始" }).click();
  await expect(page.locator(".prompt")).toHaveText(history.question);
  await page.getByRole("button", { name: "カードをめくる" }).click();
  await expect(page.getByText(history.answer, { exact: true })).toBeVisible();
  await navigate(page, "科目を選ぶ");
  await page.getByRole("link", { name: /^国 / }).click();
  await expect(page.getByText("2枚 · 覚えた 1枚")).toBeVisible();
});
