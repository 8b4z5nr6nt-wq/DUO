import { test, expect } from "@playwright/test";
import { navigate } from "../scripts/browser-navigation.mjs";
async function prepare(page) {
  await page.goto("/#data");
  const items = Array.from({ length: 80 }, (_, i) => ({
    kind: "sentence",
    number: i + 1,
    section: Math.floor(i / 20) + 1,
    en: `Robot ${i + 1} paints a moon.`,
    ja: `ロボット${i + 1}が月を描く。`,
  }));
  await page.locator("#import-text").fill(JSON.stringify(items));
  await page
    .getByRole("button", { name: "取り込み前に確認", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容を登録", exact: true })
    .click();
  await page.getByText("80 件登録済み", { exact: true }).waitFor();
  await navigate(page, "検索");
  await page.locator("#browse-position").fill("12");
}
async function position(page) {
  return Number(
    await page.locator(".glass-meter").getAttribute("data-visual-position"),
  );
}
async function stroke(page, { hold = 0, release = true } = {}) {
  const input = page.locator("#browse-position");
  const box = await input.boundingBox(),
    span = box.width - 80;
  const x = box.x + 40 + span * (await position(page)),
    y = box.y + box.height / 2;
  const dx = span * 0.24;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  // Keep the physical gesture's timestamps independent of trace/CI IPC load.
  const startedAt = Date.now() / 1000;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    timestamp: startedAt,
    touchPoints: [{ x, y, id: 7 }],
  });
  for (let i = 1; i <= 5; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      timestamp: startedAt + i * 0.02,
      touchPoints: [{ x: x + (dx * i) / 5, y, id: 7 }],
    });
    await page.waitForTimeout(20);
  }
  if (hold) await page.waitForTimeout(hold);
  if (release)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      timestamp: startedAt + 0.105 + hold / 1000,
      touchPoints: [],
    });
  await cdp.detach();
  return 12 / 79 + 0.24;
}
test("速く払った後は離した場所より先へ減速して進み、停止後は番号と位置が一致する", async ({
  page,
}) => {
  await prepare(page);
  const releasedAt = await stroke(page);
  await expect.poll(() => position(page)).toBeGreaterThan(releasedAt + 0.02);
  await expect(page.locator(".glass-meter")).not.toHaveClass(/is-moving/);
  const value = Number(await page.locator("#browse-position").inputValue());
  expect(await position(page)).toBeCloseTo(value / 79, 4);
  const settled = await position(page);
  await page.waitForTimeout(200);
  expect(await position(page)).toBe(settled);
});
test("指を止めてから離すと余分に流れず、動きを減らす設定では慣性を使わない", async ({
  page,
}) => {
  await prepare(page);
  let releasedAt = await stroke(page, { hold: 220 });
  await expect(page.locator(".glass-meter")).not.toHaveClass(/is-moving/);
  expect(Math.abs((await position(page)) - releasedAt)).toBeLessThan(0.015);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#browse-position").fill("12");
  releasedAt = await stroke(page);
  await expect(page.locator(".glass-meter")).not.toHaveClass(/is-moving/);
  expect(Math.abs((await position(page)) - releasedAt)).toBeLessThan(0.015);
});
test("慣性中に触り直すと止まり、検索や画面移動後に古い慣性が残らない", async ({
  page,
}) => {
  await prepare(page);
  await stroke(page);
  const box = await page.locator("#browse-position").boundingBox();
  const x = box.x + 40 + (box.width - 80) * (await position(page)),
    y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 8 }],
  });
  // A press outside the moving thumb can first ease to the pressed point.
  // Once held there, the previous fling must no longer move the control.
  await expect(page.locator(".glass-meter")).not.toHaveClass(/is-moving/);
  const held = await position(page);
  await page.waitForTimeout(180);
  expect(Math.abs((await position(page)) - held)).toBeLessThan(0.015);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  await page.getByLabel("番号・英語・日本語").fill("Robot 80");
  await expect(page.locator("#browse-position")).toHaveAttribute("max", "0");
  await expect.poll(() => position(page)).toBe(0);
  await navigate(page, "ホーム");
  await page.waitForTimeout(150);
  await navigate(page, "検索");
  await expect(page.locator(".meter-surface")).toHaveCount(1);
  await expect(page.locator(".glass-meter")).not.toHaveClass(/is-moving/);
  await page.locator("#browse-position").focus();
  await page.keyboard.press("Home");
  await expect(page.locator("#browse-position")).toHaveValue("0");
});
