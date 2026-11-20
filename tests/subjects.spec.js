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
  await page.locator(".swipe-card").click();
  await expect(page.getByText(classical.answer, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "覚えた →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "学習結果" })).toBeVisible();
  await navigate(page, "科目を選ぶ");
  await page.getByRole("link", { name: /^歴 / }).click();
  await expect(page.getByText("0枚 · 覚えた 0枚")).toBeVisible();
  await page.getByRole("link", { name: "JSONを取り込む" }).click();
  await page
    .getByLabel("またはJSONを貼り付け")
    .fill(
      ["```json", JSON.stringify(material("history", [history])), "```"].join(
        "\n",
      ),
    );
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

test("歴史総合の検索、学習条件、既存評価、履歴とバックアップがつながる", async ({
  page,
  browser,
}) => {
  const cards = [
    { ...history, number: 1 },
    { number: 2, question: "制度を尋ねる問題", answer: "検索用の答え" },
  ];
  await page.goto("/#subject/history");
  await expect(page.getByText("0枚 · 覚えた 0枚")).toBeVisible();
  await page.evaluate(
    (cards) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("duo-personal", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("state", "readwrite");
          tx.objectStore("state").put(
            {
              cards: cards.map((card) => ({ ...card, deck: "general" })),
              ratings: { "general:1": 2 },
              _revision: 1,
            },
            "subject:history",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    cards,
  );
  await page.reload();
  await expect(page.getByText("2枚 · 覚えた 1枚")).toBeVisible();

  await navigate(page, "検索");
  await page.getByLabel("番号・問題・答え").fill("検索用の答え");
  await expect(page.locator("#history-matches")).toHaveText("1 件");
  await page.getByRole("link", { name: /制度を尋ねる問題/ }).click();
  await expect(page.getByRole("heading", { name: "カード 2" })).toBeVisible();
  await page.getByRole("link", { name: "検索へ戻る" }).click();
  await expect(page.getByLabel("番号・問題・答え")).toHaveValue("検索用の答え");

  await page.locator(".version-badge").click();
  await expect(
    page.getByRole("heading", { name: "設定", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "最新版を開く", exact: true }),
  ).toBeVisible();
  await page.getByLabel("1日の学習目標（回答数）").fill("5");
  await page.getByRole("button", { name: "設定を保存", exact: true }).click();
  await expect(page.getByText("設定を保存しました。")).toBeVisible();
  await navigate(page, "学習");
  await page.getByLabel("開始番号").fill("2");
  await page.getByLabel("問題数").fill("1");
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
  await expect(page.locator(".prompt")).toHaveText(cards[1].question);
  await page.getByRole("button", { name: "カードをめくる" }).click();
  await page.getByRole("button", { name: "覚えた →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "学習結果" })).toBeVisible();

  await navigate(page, "記録");
  await expect(page.getByRole("heading", { name: "履歴・進捗" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: cards[1].question, exact: true }),
  ).toBeVisible();
  await navigate(page, "データ");
  await expect(page.getByRole("heading", { name: "データ管理" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "バックアップを保存" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const fresh = await browser.newPage({ baseURL: new URL(page.url()).origin });
  try {
    await fresh.goto("/#subject/history/data");
    await fresh.getByLabel("JSONファイル").setInputFiles(path);
    await fresh.getByRole("button", { name: "バックアップを追加統合" }).click();
    await expect(fresh.getByText("2枚 · 覚えた 2枚")).toBeVisible();
    await expect(
      fresh.getByRole("progressbar", { name: "今日の学習" }),
    ).toHaveAttribute("max", "5");
    await navigate(fresh, "学習");
    await expect(fresh.getByLabel("開始番号")).toHaveValue("2");
    await expect(fresh.getByLabel("問題数")).toHaveValue("1");
  } finally {
    await fresh.close();
  }
});

test("歴の分類を検索と出題に使い、ページ操作を一覧の上から行える", async ({
  page,
}) => {
  const cards = Array.from({ length: 41 }, (_, i) => ({
    number: i + 1,
    question: `架空のカード ${i + 1}`,
    answer: i === 0 ? "人物カードの答え" : "練習用の答え",
    ...(i === 0 ? { category: "person" } : i === 1 ? { category: "era" } : {}),
  }));
  await page.goto("/#subject/history/data");
  await upload(page, material("history", cards));
  await confirm(page);
  await navigate(page, "検索");
  const pages = page.getByRole("group", { name: "検索結果のページ" });
  await expect(pages).toBeVisible();
  expect(
    await pages.evaluate(
      (node) =>
        !!(
          node.compareDocumentPosition(
            document.querySelector("#history-list"),
          ) & Node.DOCUMENT_POSITION_FOLLOWING
        ),
    ),
  ).toBe(true);
  await pages.getByRole("button", { name: /次へ/ }).click();
  await expect(page.locator("#history-page")).toHaveText("2 / 2");
  await expect(
    page.getByRole("link", { name: /架空のカード 41/ }),
  ).toBeVisible();
  await pages.getByRole("button", { name: /前へ/ }).click();
  await expect(page.locator("#history-page")).toHaveText("1 / 2");

  const person = page.getByRole("radio", { name: "人物 1", exact: true });
  await person.check();
  await expect(page.locator("#history-matches")).toHaveText("1 件");
  await expect(pages).toBeHidden();
  await page.getByLabel("番号・問題・答え").fill("人物カードの答え");
  await expect(page.locator("#history-matches")).toHaveText("1 件");

  await page.getByRole("radio", { name: "未分類 0", exact: true }).check();
  await expect(page.locator("#history-matches")).toHaveText("0 件");
  await page.getByLabel("番号・問題・答え").fill("４１");
  await page.getByRole("link", { name: /架空のカード 41/ }).click();
  await page
    .getByRole("combobox", { name: "分類", exact: true })
    .selectOption("term");
  await page.getByRole("button", { name: "分類を保存" }).click();
  await expect(page.getByText("分類を保存しました。")).toBeVisible();

  await navigate(page, "データ");
  await upload(
    page,
    material("history", [{ ...cards[40], answer: "更新した答え" }]),
  );
  await expect(
    page.getByRole("list", { name: "取り込むカードの分類" }),
  ).toHaveText("用語 1件");
  await confirm(page);
  await navigate(page, "検索");
  await page.getByRole("radio", { name: "用語 1", exact: true }).check();
  await expect(page.getByRole("link", { name: /更新した答え/ })).toBeVisible();

  await navigate(page, "学習");
  await page
    .getByRole("combobox", { name: "分類", exact: true })
    .selectOption("term");
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
  await expect(page.locator(".prompt")).toHaveText("架空のカード 41");
  await page.locator(".swipe-card").click();
  await expect(page.getByText("更新した答え", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "覚えた →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "学習結果" })).toBeVisible();
  await page.goto("/#subject/history/setup");
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "分類", exact: true }),
  ).toHaveValue("term");
});

test("TXTの歴史教材を未分類として登録でき、再開や画面移動で古い案内が残らない", async ({
  page,
}) => {
  await page.goto("/#subject/history/data");
  const file = page.locator("#subject-file");
  await file.setInputFiles({
    name: "invalid.txt",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("JSONではないデータ"),
  });
  await expect(page.getByText(/JSONを読み取れません/)).toBeVisible();
  await expect(page.locator("#subject-import")).toHaveCount(0);
  await file.setInputFiles({
    name: "cards.txt",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(JSON.stringify(material("history", [history]))),
  });
  await expect(
    page.getByText("新規 1 件は「未分類」に入ります。", { exact: true }),
  ).toBeVisible();
  await confirm(page);
  await expect(page.getByText("1枚 · 覚えた 0枚")).toBeVisible();

  await navigate(page, "学習");
  const notice = page.locator("#notice");
  const start = page.getByRole("button", { name: "学習を開始", exact: true });
  await page.getByLabel("開始番号").fill("2");
  await start.click();
  await expect(notice).toContainText(
    "この条件で出題できるカードがありません。",
  );
  await page.getByRole("button", { name: "案内を閉じる", exact: true }).click();
  await expect(notice).toBeHidden();
  await start.click();
  await expect(notice).toBeVisible();
  await navigate(page, "検索");
  await expect(notice).toBeHidden();

  await navigate(page, "学習");
  await start.click();
  await expect(page.locator(".prompt")).toHaveText(history.question);
  await navigate(page, "学習");
  await expect(start).toHaveCount(0);
  await page
    .getByRole("link", { name: "途中の学習を再開", exact: true })
    .click();
  await expect(page.locator(".prompt")).toHaveText(history.question);
  await expect(notice).toBeHidden();
  await page.getByRole("button", { name: "学習を終える", exact: true }).click();
  await navigate(page, "学習");
  await expect(start).toBeVisible();
  await expect(notice).toBeHidden();
});
