import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

async function demo(page) {
  await page.goto("/#data");
  await page.getByRole("button", { name: "開発用の架空データを追加" }).click();
  await expect(page.getByText("4 件登録済み")).toBeVisible();
}

async function setup(page, { mode = "handwriting", count = "1", limit } = {}) {
  await page.getByRole("link", { name: "学習", exact: true }).click();
  await page
    .getByRole("combobox", { name: "種類", exact: true })
    .selectOption("word");
  await page.getByLabel("出題方向").selectOption("ja-en");
  await page
    .getByRole("combobox", { name: "回答方法", exact: true })
    .selectOption(mode);
  await page.getByLabel("問題数（空欄は全問）").fill(count);
  await page.getByText("タイマー・ヒント", { exact: true }).click();
  await page.getByLabel("ヒントを使う").uncheck();
  await page.getByLabel("時間制限を使う").setChecked(limit !== undefined);
  if (limit !== undefined)
    await page.getByLabel("制限時間（秒）").fill(String(limit));
  await page.getByRole("button", { name: "学習を開始", exact: true }).click();
}

const answerCanvas = (page) => page.locator("#handwriting-answer");
const modeButton = (page, mode) => page.locator(`[data-answer-mode="${mode}"]`);
async function raster(canvas) {
  await settleCanvas(canvas);
  const data = await canvas.evaluate(
    (el) =>
      new Promise((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(el.toDataURL())),
        );
      }),
  );
  return createHash("sha256").update(data).digest("hex");
}

async function settleCanvas(canvas) {
  await canvas.scrollIntoViewIfNeeded();
  await canvas.evaluate(() =>
    Promise.allSettled(
      document.getAnimations().map((animation) => animation.finished),
    ),
  );
}

// Exercise the same Pointer Events interface used by Apple Pencil, with pressure.
// The shape is deliberately not an expected word: handwriting must stay manual.
async function penStroke(page, variant = 0) {
  const canvas = answerCanvas(page);
  await settleCanvas(canvas);
  await canvas.evaluate((el, offset) => {
    const rect = el.getBoundingClientRect();
    const points = [
      [0.22 + offset * 0.06, 0.49, 0.35],
      [0.35 + offset * 0.06, 0.53, 0.7],
      [0.48 + offset * 0.06, 0.47, 0.6],
      [0.61 + offset * 0.06, 0.51, 0.4],
    ];
    const send = (name, [x, y, pressure], buttons) =>
      el.dispatchEvent(
        new PointerEvent(name, {
          bubbles: true,
          cancelable: true,
          pointerId: 41,
          pointerType: "pen",
          isPrimary: true,
          button: name === "pointermove" ? -1 : 0,
          buttons,
          clientX: rect.left + rect.width * x,
          clientY: rect.top + rect.height * y,
          pressure,
        }),
      );
    send("pointerdown", points[0], 1);
    for (const point of points.slice(1)) send("pointermove", point, 1);
    send("pointerup", [...points.at(-1).slice(0, 2), 0], 0);
  }, variant);
}

async function touchStroke(page, context, browserName) {
  const canvas = answerCanvas(page);
  await settleCanvas(canvas);
  const initialScroll = await page.evaluate(() => scrollY);
  if (browserName !== "chromium") {
    await canvas.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      for (const [type, x, buttons] of [
        ["pointerdown", 0.25, 1],
        ["pointermove", 0.4, 1],
        ["pointermove", 0.6, 1],
        ["pointerup", 0.6, 0],
      ]) {
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 12,
            pointerType: "touch",
            isPrimary: true,
            button: 0,
            buttons,
            clientX: rect.left + rect.width * x,
            clientY: rect.top + rect.height * 0.5,
            pressure: buttons ? 0.5 : 0,
          }),
        );
      }
    });
  } else {
    const box = await canvas.boundingBox();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 2,
    });
    const point = (fraction) => ({
      x: box.x + box.width * fraction,
      y: box.y + box.height * 0.5,
      id: 0,
      radiusX: 1,
      radiusY: 1,
      force: 0.5,
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(0.25)],
    });
    for (const fraction of [0.35, 0.45, 0.55, 0.65]) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point(fraction)],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  }
  expect(await page.evaluate(() => scrollY)).toBe(initialScroll);
}

async function backup(page) {
  await page.getByRole("link", { name: "データ", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップを保存", exact: true })
    .click();
  const download = await downloading;
  return JSON.parse(await readFile(await download.path(), "utf8"));
}

async function openSavedInk(page) {
  await page.getByRole("link", { name: "記録", exact: true }).click();
  const detail = page
    .locator("details")
    .filter({
      has: page.locator('canvas[aria-label="保存した手書き回答"]'),
    })
    .first();
  await detail.locator("summary").click();
  const canvas = detail.locator('canvas[aria-label="保存した手書き回答"]');
  await expect(canvas).toBeVisible();
  await settleCanvas(canvas);
  return canvas;
}

test("ペンで書き、戻す・消す・一時停止・画面サイズ変更をしても回答が保たれる", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await demo(page);
  await setup(page);
  const canvas = answerCanvas(page);
  await settleCanvas(canvas);
  const blank = await raster(canvas);
  await expect(page.locator("#ink-undo")).toBeDisabled();
  await penStroke(page);
  await expect(page.locator("#ink-undo")).toBeEnabled();
  const first = await raster(canvas);
  expect(first).not.toBe(blank);
  await penStroke(page, 1);
  await page.getByRole("button", { name: "ひとつ戻す", exact: true }).click();
  expect(await raster(canvas)).toBe(first);
  await page.getByRole("button", { name: "すべて消す", exact: true }).click();
  await expect(page.locator("#ink-undo")).toBeDisabled();
  expect(await raster(canvas)).toBe(blank);
  await penStroke(page, 2);
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  await expect(canvas).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#ink-undo")).toBeDisabled();
  await expect(page.locator("#ink-clear")).toBeDisabled();
  await penStroke(page);
  await page.getByRole("button", { name: "再開", exact: true }).click();
  const viewport = page.viewportSize();
  await page.setViewportSize({
    width: viewport.width + 90,
    height: viewport.height + 40,
  });
  await expect(page.locator("#ink-undo")).toBeEnabled();
  await page.getByRole("button", { name: "回答を確認", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "手書きの回答を見比べましょう",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("#handwriting-review")).toBeVisible();
  await expect(page.locator("#correctness")).toHaveValue("unknown");
  await page.getByRole("button", { name: "覚えた", exact: true }).click();
  const saved = await backup(page);
  const attempt = saved.sessions.flatMap((session) => session.attempts)[0];
  expect(attempt.inputMode).toBe("handwriting");
  expect(attempt.drawing.strokes).toHaveLength(1);
  expect(attempt.correctness).toBe("unknown");
  expect(errors).toEqual([]);
});

test("回答方法を切り替えても下書きを保持し、記録と次問には選択中の回答だけを使う", async ({
  page,
}) => {
  await demo(page);
  await setup(page, { mode: "text", count: "2" });
  await page
    .getByRole("textbox", { name: "あなたの回答", exact: true })
    .fill("moon garden");
  await modeButton(page, "handwriting").click();
  await penStroke(page);
  const draft = await raster(answerCanvas(page));
  await modeButton(page, "text").click();
  await expect(
    page.getByRole("textbox", { name: "あなたの回答", exact: true }),
  ).toHaveValue("moon garden");
  await modeButton(page, "handwriting").click();
  expect(await raster(answerCanvas(page))).toBe(draft);
  await modeButton(page, "text").click();
  await page.getByRole("button", { name: "回答を確認", exact: true }).click();
  await expect(
    page.getByText("登録された正解と一致しました", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#handwriting-review")).toHaveCount(0);
  await page.getByRole("button", { name: "覚えた", exact: true }).click();
  await modeButton(page, "handwriting").click();
  await expect(page.locator("#ink-undo")).toBeDisabled();
  await modeButton(page, "text").click();
  await expect(
    page.getByRole("textbox", { name: "あなたの回答", exact: true }),
  ).toHaveValue("");
  await modeButton(page, "handwriting").click();
  await penStroke(page, 2);
  await page.getByRole("button", { name: "回答を確認", exact: true }).click();
  await expect(page.locator("#correctness")).toHaveValue("unknown");
  await page.getByRole("button", { name: "微妙", exact: true }).click();
  const saved = await backup(page);
  const attempts = saved.sessions.flatMap((session) => session.attempts);
  expect(attempts).toHaveLength(2);
  expect(attempts[0].answer).toBe("moon garden");
  expect(attempts[0].drawing).toBeUndefined();
  expect(attempts[1].inputMode).toBe("handwriting");
  expect(attempts[1].answer).toBe("");
  expect(attempts[1].drawing.strokes).toHaveLength(1);
  expect(attempts[1].correctness).toBe("unknown");
});

test("指の筆跡をオフラインで記録し、履歴・再読み込み・バックアップ復元で保持する", async ({
  page,
  context,
  browserName,
}) => {
  await demo(page);
  await expect(page.locator("#connection")).toContainText("オフライン準備完了");
  await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() =>
      navigator.serviceWorker.controller
        ? undefined
        : new Promise((resolve) =>
            navigator.serviceWorker.addEventListener(
              "controllerchange",
              resolve,
              { once: true },
            ),
          ),
    ),
  );
  await context.setOffline(true);
  await setup(page);
  await touchStroke(page, context, browserName);
  await expect(page.locator("#ink-undo")).toBeEnabled();
  await page.getByRole("button", { name: "回答を確認", exact: true }).click();
  await page.locator("#correctness").selectOption("correct");
  await page.getByRole("button", { name: "微妙", exact: true }).click();
  const saved = await backup(page);
  const drawing = saved.sessions[0].attempts[0].drawing;
  expect(drawing.strokes).toHaveLength(1);
  expect(saved.sessions[0].attempts[0].correctness).toBe("correct");
  await page.reload();
  const previous = await openSavedInk(page);
  const previousRaster = await raster(previous);
  expect(
    await previous.evaluate((el) => {
      const pixels = el
        .getContext("2d")
        .getImageData(0, 0, el.width, el.height).data;
      return pixels.some((value, index) => index % 4 === 3 && value > 0);
    }),
  ).toBe(true);
  await page.getByRole("link", { name: "学習", exact: true }).click();
  await page
    .getByRole("combobox", { name: "回答方法", exact: true })
    .selectOption("text");
  await page.getByRole("link", { name: "データ", exact: true }).click();
  await page.locator("#restore-mode").selectOption("replace");
  await page.locator("#backup-text").fill(JSON.stringify(saved));
  await page.getByRole("button", { name: "復元前に確認", exact: true }).click();
  await page.getByLabel("既存データを消すことを確認しました").check();
  await page
    .getByRole("button", { name: "この内容で復元", exact: true })
    .click();
  await expect(page.getByText("4 件登録済み")).toBeVisible();
  await page.getByRole("link", { name: "学習", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "回答方法", exact: true }),
  ).toHaveValue("handwriting");
  await page.getByRole("link", { name: "データ", exact: true }).click();
  await page.reload();
  const restored = await openSavedInk(page);
  expect(await raster(restored)).toBe(previousRaster);
  const exportedAgain = await backup(page);
  expect(exportedAgain.sessions[0].attempts[0].drawing).toEqual(drawing);
  await page.getByRole("link", { name: "学習", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "回答方法", exact: true }),
  ).toHaveValue("handwriting");
});

test("手書き中の時間切れで筆跡を残し、再挑戦は白紙から始める", async ({
  page,
}) => {
  await demo(page);
  await setup(page, { limit: 3 });
  await penStroke(page);
  await expect(
    page.getByRole("heading", { name: "時間切れ", exact: true }),
  ).toBeVisible({ timeout: 6000 });
  await expect(page.locator("#handwriting-review")).toBeVisible();
  await expect(page.locator("#correctness")).toHaveValue("timeout");
  await page
    .getByRole("button", {
      name: "覚えてないとして記録し、その場で再挑戦",
      exact: true,
    })
    .click();
  await expect(page.locator("#ink-undo")).toBeDisabled();
  await penStroke(page, 2);
  await page.getByRole("button", { name: "回答を確認", exact: true }).click();
  await expect(page.locator("#correctness")).toHaveValue("unknown");
  await page.locator("#correctness").selectOption("correct");
  await page.getByRole("button", { name: "覚えた", exact: true }).click();
  const saved = await backup(page);
  const attempts = saved.sessions[0].attempts;
  expect(attempts).toHaveLength(2);
  expect(attempts[0].correctness).toBe("timeout");
  expect(attempts[0].drawing.strokes).toHaveLength(1);
  expect(attempts[1].correctness).toBe("correct");
  expect(attempts[1].retry).toBe(true);
  expect(attempts[1].drawing.strokes).toHaveLength(1);
  expect(attempts[1].drawing).not.toEqual(attempts[0].drawing);
});
