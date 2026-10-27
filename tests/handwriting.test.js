import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyDrawing,
  hasInk,
  mountHandwriting,
  normalizeDrawing,
  MAX_POINTS,
  MAX_STROKES,
} from "../src/handwriting.js";

function surface(options = {}) {
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.defaultView = win;
  const frames = new Map();
  let nextFrame = 0;
  win.devicePixelRatio = 2;
  win.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  win.cancelAnimationFrame = (id) => frames.delete(id);
  let resized;
  let disconnected = false;
  win.ResizeObserver = class {
    constructor(callback) {
      resized = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  };
  const calls = [];
  const context = {};
  for (const method of [
    "setTransform",
    "clearRect",
    "beginPath",
    "moveTo",
    "lineTo",
    "stroke",
    "arc",
    "fill",
  ])
    context[method] = (...args) => calls.push([method, ...args]);
  const rect = { left: 10, top: 20, width: 600, height: 300 };
  const captures = new Set();
  const canvas = Object.assign(new EventTarget(), {
    ownerDocument: doc,
    style: { touchAction: "pan-y", aspectRatio: "" },
    getContext: () => context,
    getBoundingClientRect: () => ({ ...rect }),
    setPointerCapture: (id) => captures.add(id),
    releasePointerCapture: (id) => captures.delete(id),
    hasPointerCapture: (id) => captures.has(id),
  });
  const changes = [];
  const limits = [];
  const controller = mountHandwriting(canvas, {
    onChange: (drawing) => changes.push(drawing),
    onLimit: (limit) => limits.push(limit),
    ...options,
  });
  function pointer(type, details = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      button: 0,
      pointerId: 1,
      pointerType: "pen",
      isPrimary: true,
      clientX: 160,
      clientY: 95,
      pressure: 0.4,
      ...details,
    });
    (type === "pointerdown" || type === "lostpointercapture"
      ? canvas
      : win
    ).dispatchEvent(event);
    return event;
  }
  function flush() {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  }
  return {
    win,
    doc,
    canvas,
    rect,
    changes,
    limits,
    controller,
    pointer,
    flush,
    calls,
    resize: () => resized(),
    disconnected: () => disconnected,
    pendingFrames: () => frames.size,
  };
}

test("drawing backup accepts only bounded numeric vectors and returns a safe clone", () => {
  const raw = {
    ...emptyDrawing(),
    unsafe: "ignored",
    strokes: [[{ x: 0, y: 1, p: 0.5, html: "ignored" }]],
  };
  const copy = normalizeDrawing(raw);
  assert.deepEqual(copy, {
    ...emptyDrawing(),
    strokes: [[{ x: 0, y: 1, p: 0.5 }]],
  });
  raw.strokes[0][0].x = 1;
  assert.equal(copy.strokes[0][0].x, 0);
  assert.equal(hasInk(copy), true);
  assert.equal(hasInk(emptyDrawing()), false);
  for (const x of [Infinity, NaN, -0.1, 1.1, "0.5"])
    assert.throws(() =>
      normalizeDrawing({ ...copy, strokes: [[{ x, y: 0, p: 0.5 }]] }),
    );
  assert.throws(() => normalizeDrawing({ ...copy, version: 2 }));
  assert.throws(() => normalizeDrawing({ ...copy, width: 1 }));
  assert.throws(() => normalizeDrawing({ ...copy, strokes: [[]] }));
  assert.throws(() =>
    normalizeDrawing({
      ...copy,
      strokes: Array.from({ length: MAX_STROKES + 1 }, () => [
        { x: 0, y: 0, p: 0.5 },
      ]),
    }),
  );
  assert.throws(() =>
    normalizeDrawing({
      ...copy,
      strokes: [
        Array.from({ length: MAX_POINTS + 1 }, () => ({ x: 0, y: 0, p: 0.5 })),
      ],
    }),
  );
  assert.equal(hasInk({ ...copy, strokes: "invalid" }), false);
});

test("pen writes normalized pressure samples, dot taps work, and snapshots stay independent", () => {
  const s = surface();
  s.pointer("pointerdown");
  assert.deepEqual(s.controller.getDrawing().strokes[0][0], {
    x: 0.25,
    y: 0.25,
    p: 0.4,
  });
  s.pointer("pointermove", { clientX: 310, clientY: 170, pressure: 0.8 });
  s.pointer("pointerup", { clientX: 310, clientY: 170, pressure: 0 });
  assert.equal(s.changes.length, 2);
  assert.equal(s.changes[0].strokes[0].length, 1);
  assert.deepEqual(s.controller.getDrawing().strokes[0][1], {
    x: 0.5,
    y: 0.5,
    p: 0.8,
  });
  s.pointer("pointerdown", { pointerId: 2 });
  s.pointer("pointerup", { pointerId: 2 });
  assert.equal(s.controller.getDrawing().strokes[1].length, 1);
  s.flush();
  assert.equal(s.canvas.width, 1200);
  assert.equal(s.canvas.height, 600);
  assert.ok(s.calls.some(([method]) => method === "arc"));
  s.controller.destroy();
});

test("empty phone surface uses its full height; resizing existing ink keeps its original shape", () => {
  const s = surface();
  Object.assign(s.rect, { width: 300, height: 280 });
  s.pointer("pointerdown", { clientX: 160, clientY: 160 });
  s.pointer("pointerup", { clientX: 160, clientY: 160 });
  const original = s.controller.getDrawing();
  assert.equal(original.width, 1000);
  assert.equal(original.height, 933);
  assert.ok(Math.abs(original.strokes[0][0].y - 0.5) < 0.001);
  Object.assign(s.rect, { width: 700, height: 280 });
  s.resize();
  s.flush();
  assert.deepEqual(s.controller.getDrawing(), original);
  s.controller.destroy();
});

test("pause and cancellation finish a stroke and do not accept stray pointer moves", () => {
  const s = surface();
  s.pointer("pointerdown");
  s.controller.setDisabled(true);
  s.pointer("pointermove", { clientX: 400 });
  assert.equal(s.controller.getDrawing().strokes[0].length, 1);
  s.controller.setDisabled(false);
  s.pointer("pointermove", { clientX: 400 });
  assert.equal(s.controller.getDrawing().strokes[0].length, 1);
  s.pointer("pointerdown", { pointerId: 2 });
  s.pointer("pointercancel", { pointerId: 2 });
  s.pointer("pointermove", { pointerId: 2, clientX: 400 });
  assert.equal(s.controller.getDrawing().strokes[1].length, 1);
  s.controller.destroy();
});

test("pencil takes priority over an accidental touch; other contacts cannot alter its stroke", () => {
  const s = surface();
  s.pointer("pointerdown", { pointerType: "touch", pointerId: 1 });
  s.pointer("pointerdown", { pointerType: "pen", pointerId: 2, clientX: 310 });
  s.pointer("pointermove", {
    pointerType: "touch",
    pointerId: 1,
    clientX: 500,
  });
  assert.equal(s.controller.getDrawing().strokes.length, 1);
  assert.equal(s.controller.getDrawing().strokes[0][0].x, 0.5);
  s.pointer("pointermove", { pointerType: "pen", pointerId: 2, clientX: 460 });
  assert.equal(s.controller.getDrawing().strokes[0].length, 2);
  s.controller.destroy();
});

test("undo/clear preserve a valid empty drawing and read-only previews cannot be edited", () => {
  const s = surface();
  s.pointer("pointerdown");
  s.pointer("pointerup");
  s.controller.undo();
  assert.equal(hasInk(s.controller.getDrawing()), false);
  s.pointer("pointerdown");
  s.controller.clear();
  assert.equal(hasInk(s.controller.getDrawing()), false);
  s.controller.destroy();
  const drawing = {
    ...emptyDrawing(),
    height: 800,
    strokes: [[{ x: 0.5, y: 0.5, p: 1 }]],
  };
  const preview = surface({ readOnly: true, drawing });
  preview.pointer("pointerdown");
  preview.controller.undo();
  preview.controller.clear();
  assert.deepEqual(preview.controller.getDrawing(), drawing);
  assert.equal(preview.canvas.style.aspectRatio, "1000 / 800");
  assert.equal(preview.changes.length, 0);
  preview.controller.destroy();
});

test("stroke/point bounds stop new ink with a limit notification rather than dropping existing ink", () => {
  const strokes = Array.from({ length: MAX_STROKES }, () => [
    { x: 0, y: 0, p: 0.5 },
  ]);
  const s = surface({ drawing: { ...emptyDrawing(), strokes } });
  s.pointer("pointerdown");
  assert.equal(s.controller.getDrawing().strokes.length, MAX_STROKES);
  assert.deepEqual(s.limits, [{ kind: "strokes", maximum: MAX_STROKES }]);
  const full = [
    Array.from({ length: MAX_POINTS }, () => ({ x: 0, y: 0, p: 0.5 })),
  ];
  s.controller.setDrawing({ ...emptyDrawing(), strokes: full });
  s.pointer("pointerdown");
  assert.equal(s.controller.getDrawing().strokes[0].length, MAX_POINTS);
  assert.equal(s.limits.at(-1).kind, "points");
  s.controller.destroy();
});

test("destroy releases observers/listeners and never emits stale onChange callbacks", () => {
  const s = surface();
  s.pointer("pointerdown");
  const count = s.changes.length;
  s.controller.destroy();
  assert.equal(s.disconnected(), true);
  assert.equal(s.pendingFrames(), 0);
  assert.equal(s.canvas.style.touchAction, "pan-y");
  s.pointer("pointermove", { clientX: 400 });
  s.pointer("pointerdown", { pointerId: 2 });
  s.controller.setDrawing(emptyDrawing());
  assert.equal(s.changes.length, count);
});
