import { test, expect } from "@playwright/test";
import { navigate } from "../scripts/browser-navigation.mjs";
async function stored(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("duo-personal", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const data = await new Promise((resolve) => {
      const r = db.transaction("state").objectStore("state").get("current");
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return data;
  });
}
async function seed(page, items) {
  await page.goto("/#data");
  await page.locator("#import-text").fill(JSON.stringify(items));
  await page
    .getByRole("button", { name: "取り込み前に確認", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容を登録", exact: true })
    .click();
  await expect(
    page.getByText(`${items.length} 件登録済み`, { exact: true }),
  ).toBeVisible();
}
const data = [
  {
    kind: "sentence",
    number: 1,
    section: 1,
    en: "The robot painted a moon.",
    ja: "ロボットが月を描いた。",
  },
  {
    kind: "sentence",
    number: 2,
    section: 2,
    en: "A star shines.",
    ja: "星が光る。",
  },
  {
    kind: "word",
    number: 1,
    section: 1,
    sentenceNumber: 1,
    en: "paint",
    ja: "描く",
    sentenceForm: "painted",
    sentenceTranslation: "描いた",
  },
];
async function swipe(page, side) {
  const card = page.locator(".swipe-card");
  await card.scrollIntoViewIfNeeded();
  await card.evaluate(() =>
    Promise.allSettled(document.getAnimations().map((a) => a.finished)),
  );
  const box = await card.boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height * 0.7,
    dx = side === "right" ? 110 : -110;
  if (
    (await page.evaluate(() => navigator.maxTouchPoints > 0)) &&
    page.context().browser().browserType().name() === "chromium"
  ) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 7 }],
    });
    for (let i = 1; i <= 6; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * i) / 6, y, id: 7 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 6 });
    await page.mouse.up();
  }
}

test("メニューは閉じている間項目を隠し、Escと選択で閉じ、今日の10問の空状態を表示", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "ホーム", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await expect(
    page.getByRole("dialog", { name: "メニュー", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "メニューを開く" }),
  ).toBeFocused();
  await navigate(page, "今日の10問");
  await expect(
    page.getByText("対象の単語がまだありません。", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "メニュー", exact: true }),
  ).toBeHidden();
});
test("カードは時間切れで下半分を表示し単語タップは対応する訳だけ、左右スワイプを一度ずつ記録", async ({
  page,
}) => {
  await seed(page, data);
  await navigate(page, "学習");
  await page
    .getByRole("combobox", { name: "回答方法", exact: true })
    .selectOption("card");
  await page.getByText("タイマー・ヒント", { exact: true }).click();
  await page.getByLabel("時間制限を使う").check();
  await page.getByLabel("制限時間（秒）", { exact: true }).fill("2");
  await page.getByLabel("ヒントを使う").uncheck();
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
  await expect(page.locator(".card-answer")).not.toContainText("ロボット");
  await page.getByRole("button", { name: "painted", exact: true }).click();
  await expect(page.locator("#card-word-meaning")).toHaveText("描いた");
  await expect(page.locator(".card-answer")).not.toContainText("ロボット");
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  await page.waitForTimeout(2100);
  await expect(page.locator(".card-answer")).not.toContainText("ロボット");
  await page.getByRole("button", { name: "再開", exact: true }).click();
  await expect(page.locator(".card-answer")).toContainText(
    "ロボットが月を描いた。",
  );
  await swipe(page, "right");
  await expect(page.locator(".prompt")).toHaveText("A star shines.");
  await expect(page.locator(".card-answer")).toContainText("星が光る。");
  await swipe(page, "left");
  await expect(
    page.getByRole("heading", { name: "学習結果", exact: true }),
  ).toBeVisible();
  const s = await stored(page);
  expect(
    s.sessions.at(-1).attempts.map((a) => [a.number, a.rating, a.correctness]),
  ).toEqual([
    [1, 2, "unknown"],
    [2, 0, "unknown"],
  ]);
});
test("検索の上部横メーターはセクションと番号の順に移動し検索で絞り込める", async ({
  page,
}) => {
  await seed(page, data);
  await navigate(page, "検索");
  const slider = page.getByRole("slider", { name: "セクション・番号へ移動" });
  await expect(slider).toHaveAttribute("max", "1");
  await slider.fill("1");
  await expect(page.locator(".section-stage")).toContainText("セクション 2");
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    "セクション 2・例文 2",
  );
  await slider.fill("0");
  await expect(page.locator(".section-stage")).toContainText("セクション 1");
  await page.getByLabel("番号・英語・日本語").fill("star");
  await expect(slider).toHaveAttribute("max", "0");
  await expect(page.locator(".section-stage")).toContainText("A star shines.");
});
test("引用符と通貨記号は入力欄に用意し、文字部分を入力して正解として記録", async ({
  page,
}) => {
  await seed(page, [
    {
      kind: "sentence",
      number: 1,
      section: 1,
      en: "“Hello” costs $25.",
      ja: "架空の出題文です。",
    },
  ]);
  await navigate(page, "学習");
  await page.getByLabel("出題方向").selectOption("ja-en");
  await page.getByText("タイマー・ヒント", { exact: true }).click();
  await page.getByLabel("時間制限を使う").uncheck();
  await page.getByLabel("ヒントを使う").uncheck();
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
  await expect(page.locator(".answer-symbol")).toContainText([
    "“",
    "”",
    " ",
    " ",
    "$",
    ".",
  ]);
  const slots = page.locator("[data-answer-slot]");
  await expect(slots).toHaveCount(3);
  await slots.nth(0).fill("Hello");
  await slots.nth(0).press("Enter");
  await expect(slots.nth(1)).toBeFocused();
  await slots.nth(1).fill("costs");
  await slots.nth(2).fill("25");
  await page.getByRole("button", { name: "回答を確認", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "一致率 100% · 覚えた" }),
  ).toBeVisible();
  await page.locator("#auto-next").click();
  await expect(
    page.getByRole("heading", { name: "学習結果", exact: true }),
  ).toBeVisible();
  expect((await stored(page)).sessions.at(-1).attempts[0].answer).toBe(
    "“Hello” costs $25.",
  );
});
test("今日の10問はキーボードで覚えた単語を日本語から英語で出し通常設定を保持", async ({
  page,
}) => {
  await seed(page, [
    { kind: "word", number: 1, section: 1, en: "moon", ja: "月" },
  ]);
  await navigate(page, "学習");
  await page
    .getByRole("combobox", { name: "種類", exact: true })
    .selectOption("word");
  await page.getByLabel("出題方向").selectOption("ja-en");
  await page.getByText("タイマー・ヒント", { exact: true }).click();
  await page.getByLabel("時間制限を使う").uncheck();
  await page.getByLabel("ヒントを使う").uncheck();
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
  await page
    .getByRole("textbox", { name: "あなたの回答", exact: true })
    .fill("moon");
  await page.getByRole("button", { name: "回答を確認", exact: true }).click();
  await page.locator("#auto-next").click();
  await expect(
    page.getByRole("heading", { name: "学習結果", exact: true }),
  ).toBeVisible();
  const before = (await stored(page)).settings;
  await navigate(page, "今日の10問");
  await expect(page.locator(".prompt")).toHaveText("月");
  await expect(page.locator("#answer")).toBeVisible();
  expect((await stored(page)).settings).toEqual(before);
  await page.getByRole("button", { name: "スキップ", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "学習結果", exact: true }),
  ).toBeVisible();
  const s = await stored(page);
  expect(s.sessions).toHaveLength(2);
  expect(s.sessions.at(-1).direction).toBe("ja-en");
  expect(s.sessions.at(-1).attempts).toHaveLength(1);
});

test("長い例文カードは先頭から読めて上下の本文を個別にスクロールできる", async ({
  page,
}) => {
  await seed(page, [
    {
      kind: "sentence",
      number: 1,
      section: 1,
      en: "A robot paints a moon. ".repeat(30).trim(),
      ja: "ロボットが月を描く。".repeat(40),
    },
  ]);
  await navigate(page, "学習");
  await page
    .getByRole("combobox", { name: "回答方法", exact: true })
    .selectOption("card");
  await page.getByText("タイマー・ヒント", { exact: true }).click();
  await page.getByLabel("時間制限を使う").uncheck();
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
  await page
    .getByRole("button", { name: "カードをめくる", exact: true })
    .click();
  for (const selector of [".card-question", ".card-answer"]) {
    const metrics = await page.locator(selector).evaluate((el) => {
      el.scrollTop = 0;
      const start = el.querySelector("p").getBoundingClientRect().top;
      const top = el.getBoundingClientRect().top;
      const height = el.clientHeight;
      const total = el.scrollHeight;
      el.scrollTop = total;
      return { start, top, height, total, scrolled: el.scrollTop };
    });
    expect(metrics.start).toBeGreaterThanOrEqual(metrics.top);
    expect(metrics.total).toBeGreaterThan(metrics.height);
    expect(metrics.scrolled).toBeGreaterThan(0);
  }
});
