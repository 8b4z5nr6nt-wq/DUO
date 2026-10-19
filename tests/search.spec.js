import { test, expect } from "@playwright/test";

async function demo(page) {
  await page.goto("/#data");
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await expect(page.getByText("4 件登録済み")).toBeVisible();
  await page.getByRole("link", { name: "検索", exact: true }).click();
}

function group(page, kind) {
  return page.locator(`.library-group[data-kind="${kind}"]`);
}

test("例文と単語を別々の一覧にし、番号・訳・品詞を表示する", async ({
  page,
}) => {
  await demo(page);
  const sentences = group(page, "sentence");
  const words = group(page, "word");
  await expect(
    sentences.getByRole("heading", { name: "例文", exact: true }),
  ).toBeVisible();
  await expect(
    words.getByRole("heading", { name: "単語・熟語", exact: true }),
  ).toBeVisible();
  await expect(sentences.locator(".library-count")).toHaveText("2 / 2 件");
  await expect(words.locator(".library-count")).toHaveText("2 / 2 件");
  await expect(sentences.locator(".item-number")).toHaveText([
    "例文001",
    "例文002",
  ]);
  await expect(words.locator(".item-number")).toHaveText([
    "単語001",
    "単語002",
  ]);
  await expect(sentences.locator("a.list-item")).toHaveCount(2);
  await expect(words.locator("a.list-item")).toHaveCount(2);
  await expect(sentences.locator(".item-en").first()).toHaveText(
    "My robot grows blue tomatoes.",
  );
  await expect(words.locator(".item-en").first()).toHaveText("moon garden");
  await expect(words.locator(".item-ja").first()).toHaveText("月の庭");
  await expect(words.locator(".item-meta").first()).toContainText(
    "名詞（架空の表現）",
  );
  await expect(page.locator(".search-summary")).toHaveText(
    "検索結果 4 件 / 登録済み 4 件",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await words.locator("a.list-item").first().click();
  await expect(
    page.getByRole("heading", { name: "単語 1", exact: true }),
  ).toBeVisible();
});

test("英語・日本語・番号で検索し、種類で絞り込み、該当なしを伝える", async ({
  page,
}) => {
  await demo(page);
  const query = page.getByLabel("番号・英語・日本語");
  await query.fill("ROBOT");
  await expect(group(page, "sentence").locator("a.list-item")).toHaveCount(1);
  await expect(group(page, "word").locator("a.list-item")).toHaveCount(0);
  await expect(group(page, "sentence").locator(".library-count")).toHaveText(
    "1 / 2 件",
  );
  await query.fill("月");
  await expect(group(page, "sentence").locator("a.list-item")).toHaveCount(0);
  await expect(group(page, "word").locator("a.list-item")).toHaveCount(1);
  await query.fill("001");
  await expect(group(page, "sentence").locator(".item-number")).toHaveText([
    "例文001",
  ]);
  await expect(group(page, "word").locator(".item-number")).toHaveText([
    "単語001",
  ]);
  await page.locator("#search-kind").selectOption("word");
  await expect(group(page, "sentence")).toHaveCount(0);
  await expect(group(page, "word").locator("a.list-item")).toHaveCount(1);
  await expect(page.locator(".search-summary")).toHaveText(
    "検索結果 1 件 / 登録済み 2 件",
  );
  await query.fill("fictional-no-match");
  await expect(group(page, "word").locator("a.list-item")).toHaveCount(0);
  await expect(
    group(page, "word").getByText("条件に合う単語・熟語がありません。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".search-summary")).toHaveText(
    "検索結果 0 件 / 登録済み 2 件",
  );
  await query.fill("");
  await page.locator("#search-kind").selectOption("sentence");
  await expect(group(page, "word")).toHaveCount(0);
  await expect(group(page, "sentence").locator("a.list-item")).toHaveCount(2);
});

test("セクションの件数と詳細も例文・単語を分け、未登録を空表示にする", async ({
  page,
}) => {
  await page.goto("/#search");
  await expect(
    group(page, "sentence").getByText("例文はまだ登録されていません。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    group(page, "word").getByText("単語・熟語はまだ登録されていません。", {
      exact: true,
    }),
  ).toBeVisible();
  await demo(page);
  await page.locator("#search-kind").selectOption("sections");
  await expect(page.locator(".section-card")).toHaveCount(2);
  await expect(page.locator(".section-card").first()).toContainText(
    "例文 1 件",
  );
  await expect(page.locator(".section-card").first()).toContainText(
    "単語・熟語 1 件",
  );
  await expect(page.locator(".search-summary")).toHaveText(
    "セクション 2 件 / 登録済み 2 件",
  );
  await page.getByLabel("番号・英語・日本語").fill("2");
  await expect(page.locator(".section-card")).toHaveCount(1);
  await page.locator(".section-card").click();
  await expect(
    page.getByRole("heading", { name: "セクション 2", exact: true }),
  ).toBeVisible();
  await expect(group(page, "sentence").locator(".item-number")).toHaveText([
    "例文002",
  ]);
  await expect(group(page, "word").locator(".item-number")).toHaveText([
    "単語002",
  ]);
  await expect(group(page, "sentence").locator(".library-count")).toHaveText(
    "1 / 1 件",
  );
  await expect(group(page, "word").locator(".library-count")).toHaveText(
    "1 / 1 件",
  );
  await page.goto("/#section/999");
  await expect(group(page, "sentence").locator("a.list-item")).toHaveCount(0);
  await expect(group(page, "word").locator("a.list-item")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "一覧へ", exact: true }),
  ).toBeVisible();
});
