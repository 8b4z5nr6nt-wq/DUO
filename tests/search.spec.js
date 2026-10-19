import { test, expect } from "@playwright/test";

async function demo(page) {
  await page.goto("/#data");
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await expect(page.getByText("4 件登録済み")).toBeVisible();
  await page.getByRole("link", { name: "検索", exact: true }).click();
}

const stage = (page) => page.locator(".section-stage");
const mode = (page, kind) =>
  page.getByRole("button", {
    name: kind === "sentence" ? "例文モード" : "単語モード",
    exact: true,
  });
const sectionTab = (page, number) =>
  page.locator(".section-tabs").getByRole("button", {
    name: `セクション ${number}`,
    exact: true,
  });

async function expectSection(page, number, itemNumbers) {
  await expect(
    stage(page).getByRole("heading", {
      name: `セクション ${number}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(sectionTab(page, number)).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(stage(page).locator(".item-number")).toHaveText(itemNumbers);
}

async function importSparseFictionalItems(page) {
  // 架空データだけで、未登録番号・未登録セクションを飛ばす動作を確認する。
  const items = [
    {
      kind: "sentence",
      number: 1,
      section: 1,
      en: "A glass bird sings.",
      ja: "ガラスの鳥が歌う。",
    },
    {
      kind: "sentence",
      number: 7,
      section: 5,
      en: "The paper moon floats.",
      ja: "紙の月が浮かぶ。",
    },
    {
      kind: "sentence",
      number: 8,
      section: 5,
      en: "A blue castle dances.",
      ja: "青い城が踊る。",
    },
    {
      kind: "sentence",
      number: 40,
      section: 9,
      en: "My clock grows flowers.",
      ja: "私の時計に花が咲く。",
    },
    { kind: "word", number: 1, section: 1, en: "glass bird", ja: "ガラスの鳥" },
    { kind: "word", number: 20, section: 9, en: "paper moon", ja: "紙の月" },
  ];
  await page.goto("/#data");
  await page.locator("#import-text").fill(JSON.stringify(items));
  await page.getByRole("button", { name: "取り込み前に確認" }).click();
  await page.getByRole("button", { name: "この内容を登録" }).click();
  await expect(page.getByText("6 件登録済み")).toBeVisible();
  await page.getByRole("link", { name: "検索", exact: true }).click();
}

async function touchSession(page, context) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 2,
  });
  return cdp;
}

async function touchStroke(page, cdp, target, direction) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  const box = await target.boundingBox();
  if (!box) throw new Error("スワイプ対象が見つかりません。");
  const distance = Math.min(150, box.width * 0.5);
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const delta =
    direction === "up"
      ? { x: 0, y: -75 }
      : { x: direction === "left" ? -distance : distance, y: 0 };
  const start = {
    x: center.x - delta.x / 2,
    y: center.y,
  };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...start, id: 0, radiusX: 1, radiusY: 1 }],
  });
  for (let step = 1; step <= 6; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + (delta.x * step) / 6,
          y: start.y + (delta.y * step) / 6,
          id: 0,
          radiusX: 1,
          radiusY: 1,
        },
      ],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function touchTap(cdp, target) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  const box = await target.boundingBox();
  if (!box) throw new Error("タップ対象が見つかりません。");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

test("例文・単語モードを切り替え、1 セクションだけに番号・訳・品詞を縦表示する", async ({
  page,
}) => {
  await demo(page);
  await expect(mode(page, "sentence")).toHaveAttribute("aria-pressed", "true");
  await expect(mode(page, "word")).toHaveAttribute("aria-pressed", "false");
  await expectSection(page, 1, ["例文001"]);
  await expect(stage(page).locator(".library-count")).toHaveText("1 / 1 件");
  await expect(stage(page).locator(".item-en")).toHaveText(
    "My robot grows blue tomatoes.",
  );
  await expect(stage(page).locator(".item-ja")).toHaveText(
    "私のロボットは青いトマトを育てます。",
  );
  await expect(page.locator(".search-summary")).toHaveText(
    "検索結果 2 件 / 登録済み 2 件",
  );
  await expect(page.locator(".section-tabs button")).toHaveCount(2);
  await expect(page.locator(".section-position")).toHaveText("1 / 2");
  await expect(page.locator("#section-previous")).toBeDisabled();
  await page.locator("#section-next").click();
  await expectSection(page, 2, ["例文002"]);
  await expect(page.locator("#section-next")).toBeDisabled();

  await mode(page, "word").click();
  await expect(mode(page, "word")).toHaveAttribute("aria-pressed", "true");
  await expectSection(page, 2, ["単語002"]);
  await sectionTab(page, 1).click();
  await expectSection(page, 1, ["単語001"]);
  await expect(stage(page).locator(".item-en")).toHaveText("moon garden");
  await expect(stage(page).locator(".item-ja")).toHaveText("月の庭");
  await expect(stage(page).locator(".item-meta")).toContainText(
    "名詞（架空の表現）",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("選択モード内の全セクションを英語・日本語・別解・番号で検索する", async ({
  page,
}) => {
  await demo(page);
  const query = page.getByLabel("番号・英語・日本語");
  await query.fill("DRAGON");
  await expectSection(page, 2, ["例文002"]);
  await expect(page.locator(".search-summary")).toHaveText(
    "検索結果 1 件 / 登録済み 2 件",
  );
  await query.fill("ロボット");
  await expectSection(page, 1, ["例文001"]);
  await query.fill("001");
  await expectSection(page, 1, ["例文001"]);

  await mode(page, "word").click();
  await expectSection(page, 1, ["単語001"]);
  await query.fill("月面の庭");
  await expectSection(page, 1, ["単語001"]);
  await query.fill("sparkle");
  await expectSection(page, 2, ["単語002"]);
  await query.fill("fictional-no-match");
  await expect(stage(page).locator("a.list-item")).toHaveCount(0);
  await expect(
    stage(page).getByText("条件に合う単語・熟語がありません。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".search-summary")).toHaveText(
    "検索結果 0 件 / 登録済み 2 件",
  );
  await query.fill("");
  await expect(stage(page).locator("a.list-item")).toHaveCount(1);
});

test("未登録データ・未登録セクションは空表示にし、登録済みセクションを直接開く", async ({
  page,
}) => {
  await page.goto("/#search");
  await expect(
    stage(page).getByText("例文はまだ登録されていません。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".section-position")).toHaveText("0 / 0");
  await expect(page.locator("#section-previous")).toBeDisabled();
  await expect(page.locator("#section-next")).toBeDisabled();
  await mode(page, "word").click();
  await expect(
    stage(page).getByText("単語・熟語はまだ登録されていません。", {
      exact: true,
    }),
  ).toBeVisible();
  await demo(page);
  await mode(page, "sentence").click();
  await page.goto("/#section/2");
  await expectSection(page, 2, ["例文002"]);
  await page.goto("/#section/999");
  await expect(stage(page)).toHaveCount(0);
  await expect(
    page.getByText("このセクションはまだ登録されていません。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "一覧へ", exact: true }),
  ).toBeVisible();
});

test("登録番号の隙間を飛ばしてセクションを選び、各セクション内は縦に並べる", async ({
  page,
}) => {
  await importSparseFictionalItems(page);
  await expect(page.locator(".section-tabs button")).toHaveCount(3);
  expect(
    await page
      .locator(".section-tabs button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-label")),
      ),
  ).toEqual(["セクション 1", "セクション 5", "セクション 9"]);
  await page.locator("#section-next").click();
  await expectSection(page, 5, ["例文007", "例文008"]);
  // 同じフレーム内で取得し、画面全体のフェード移動中も行間だけを比較する。
  const [first, second] = await stage(page)
    .locator("a.list-item")
    .evaluateAll((rows) =>
      rows.map((row) => {
        const { x, y, height } = row.getBoundingClientRect();
        return { x, y, height };
      }),
    );
  expect(Math.abs(first.x - second.x)).toBeLessThan(2);
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
  await page.locator("#section-next").click();
  await expectSection(page, 9, ["例文040"]);
  await expect(page.locator("#section-next")).toBeDisabled();
});

test("詳細の前後移動は登録済みの同じ種類だけにし、マークと一覧の検索条件を保持する", async ({
  page,
}) => {
  await importSparseFictionalItems(page);
  await stage(page).locator("a.list-item").click();
  await expect(
    page.getByRole("heading", { name: "例文 1", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#detail-position")).toHaveText("1 / 4");
  await expect(page.locator("#detail-previous")).toBeDisabled();
  await page.locator("#detail-next").focus();
  await page.locator("#detail-next").press("Enter");
  await expect(
    page.getByRole("heading", { name: "例文 7", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#detail-next")).toBeFocused();
  await page.locator("#detail-next").click();
  await expect(
    page.getByRole("heading", { name: "例文 8", exact: true }),
  ).toBeVisible();
  await page.locator("#detail-next").click();
  await expect(
    page.getByRole("heading", { name: "例文 40", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#detail-next")).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "例文 40", exact: true }),
  ).toBeFocused();
  await page.locator("#detail-previous").click();
  await expect(
    page.getByRole("heading", { name: "例文 8", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "一覧へ", exact: true }).click();
  await expectSection(page, 5, ["例文007", "例文008"]);
  await mode(page, "word").click();
  await page.getByLabel("番号・英語・日本語").fill("001");
  await expectSection(page, 1, ["単語001"]);
  await stage(page).locator("a.list-item").click();
  await page.getByRole("button", { name: "☆ お気に入り", exact: true }).click();
  await page.getByRole("button", { name: "要復習にする", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "★ お気に入り解除", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "要復習を解除", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "一覧へ", exact: true }).click();
  await expect(mode(page, "word")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("番号・英語・日本語")).toHaveValue("001");
  await expectSection(page, 1, ["単語001"]);
  await expect(stage(page).locator(".item-meta")).toContainText("お気に入り");
  await expect(stage(page).locator(".item-meta")).toContainText("要復習");
  await page.reload();
  await mode(page, "word").click();
  await expect(stage(page).locator(".item-meta")).toContainText("お気に入り");
});

test("実際のタッチでセクションと詳細を左右移動し、縦操作や通常タップを妨げない", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP で実際のタッチイベントを送る検証");
  await demo(page);
  const cdp = await touchSession(page, context);
  await touchStroke(page, cdp, stage(page).locator("a.list-item"), "left");
  await expectSection(page, 2, ["例文002"]);
  await expect(page).toHaveURL(/#search$/);
  await touchStroke(page, cdp, stage(page).locator("a.list-item"), "up");
  await expectSection(page, 2, ["例文002"]);
  await touchStroke(page, cdp, stage(page).locator("a.list-item"), "right");
  await expectSection(page, 1, ["例文001"]);
  await expect(page).toHaveURL(/#search$/);
  // スワイプ直後でも次の意図したタップは問題の詳細を開く。
  await touchTap(cdp, stage(page).locator("a.list-item"));
  await expect(
    page.getByRole("heading", { name: "例文 1", exact: true }),
  ).toBeVisible();
  await touchStroke(page, cdp, page.locator(".focus-card .prompt"), "left");
  await expect(
    page.getByRole("heading", { name: "例文 2", exact: true }),
  ).toBeVisible();
  await touchStroke(page, cdp, page.locator(".focus-card .prompt"), "right");
  await expect(
    page.getByRole("heading", { name: "例文 1", exact: true }),
  ).toBeVisible();
  await touchStroke(page, cdp, page.locator(".focus-card .prompt"), "right");
  await expect(
    page.getByRole("heading", { name: "例文 1", exact: true }),
  ).toBeVisible();
  await cdp.detach();
});

test("矢印キー・横ホイールでも移動でき、入力中と縦ホイールでは移動しない", async ({
  page,
}) => {
  await demo(page);
  await page.getByLabel("番号・英語・日本語").focus();
  await page.keyboard.press("ArrowRight");
  await expectSection(page, 1, ["例文001"]);
  await page.getByLabel("番号・英語・日本語").evaluate((input) => input.blur());
  await page.keyboard.press("ArrowRight");
  await expectSection(page, 2, ["例文002"]);
  await page.keyboard.press("ArrowLeft");
  await expectSection(page, 1, ["例文001"]);
  await sectionTab(page, 1).focus();
  await page.keyboard.press("ArrowRight");
  await expectSection(page, 2, ["例文002"]);
  await expect(sectionTab(page, 2)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expectSection(page, 1, ["例文001"]);
  await expect(sectionTab(page, 1)).toBeFocused();
  await stage(page).locator("a.list-item").hover();
  await page.mouse.wheel(0, 70);
  await expectSection(page, 1, ["例文001"]);
  await stage(page).locator("a.list-item").hover();
  // モバイルエミュレーションでは wheel 値が端末の画素密度で割られる。
  await page.mouse.wheel(360, 0);
  await expectSection(page, 2, ["例文002"]);
});

test("画面のフェード表示は動きを減らす設定に従う", async ({ page }) => {
  await demo(page);
  const animated = await page.locator("#app > *").evaluateAll((elements) =>
    elements.some((element) => {
      const style = getComputedStyle(element);
      return (
        style.animationName !== "none" &&
        parseFloat(style.animationDuration) > 0.01
      );
    }),
  );
  expect(animated).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("link", { name: "ホーム", exact: true }).click();
  const stillAnimated = await page.locator("#app > *").evaluateAll((elements) =>
    elements.some((element) => {
      const style = getComputedStyle(element);
      return (
        style.animationName !== "none" &&
        parseFloat(style.animationDuration) > 0.01
      );
    }),
  );
  expect(stillAnimated).toBe(false);
});
