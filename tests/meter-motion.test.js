import test from "node:test";
import assert from "node:assert/strict";
import { advanceMeterMotion } from "../src/glass-meter.js";
function run(fps, motion, seconds = 1.5) {
  for (let i = 0; i < seconds * fps; i++) advanceMeterMotion(motion, 1 / fps);
  return motion;
}
test("放した後は速度に応じて進み、減速して有限の距離で止まる", () => {
  const initial = { position: 0.4, target: 0.4, velocity: 0, momentum: 1.2 };
  const slow = run(120, { ...initial, momentum: 0.3 });
  const fast = run(120, { ...initial });
  assert.ok(slow.position > 0.4 && fast.position > slow.position);
  assert.ok(Math.abs(fast.position - 0.5) < 0.002);
  assert.ok(Math.abs(fast.velocity) < 0.004 && Math.abs(fast.momentum) < 0.004);
});
test("30/60/120fpsで停止位置が揃い、画面負荷で移動量が大きく変わらない", () => {
  const initial = { position: 0.3, target: 0.35, velocity: 0.1, momentum: 1.4 };
  const results = [30, 60, 120].map((fps) => run(fps, { ...initial }).position);
  assert.ok(Math.max(...results) - Math.min(...results) < 0.002);
});
test("両端から飛び出さず、速度ゼロなら放しても勝手に進まない", () => {
  for (const momentum of [-2.4, 2.4]) {
    const m = { position: 0.5, target: 0.5, velocity: 0, momentum };
    for (let i = 0; i < 300; i++) {
      advanceMeterMotion(m, 1 / 60);
      assert.ok(m.position >= 0 && m.position <= 1);
    }
  }
  for (const position of [0, 1]) {
    const m = run(60, {
      position,
      target: position,
      velocity: 0,
      momentum: position ? 2.4 : -2.4,
    });
    assert.equal(m.position, position);
    assert.equal(m.momentum, 0);
  }
  const still = run(60, {
    position: 0.4,
    target: 0.4,
    velocity: 0,
    momentum: 0,
  });
  assert.equal(still.position, 0.4);
});
