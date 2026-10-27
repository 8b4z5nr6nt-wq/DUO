import test from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  emptyState,
  mergeBackup,
  validateBackup,
  validateSettings,
} from "../src/core.js";
import { emptyDrawing, MAX_POINTS, MAX_STROKES } from "../src/handwriting.js";

const drawing = () => ({
  ...emptyDrawing(),
  strokes: [
    [
      { x: 0.1, y: 0.2, p: 0.25 },
      { x: 0.3, y: 0.4, p: 0.75 },
    ],
    [{ x: 0.6, y: 0.7, p: 0.5 }],
  ],
});
const attempt = () => ({
  kind: "word",
  number: 1,
  section: 1,
  prompt: "月の庭",
  correctAnswer: "moon garden",
  answer: "",
  rating: 2,
  correctness: "correct",
  at: 100,
  hints: 0,
});
function backup(answer = attempt()) {
  return {
    ...emptyState(),
    sessions: [
      {
        id: "handwriting-session",
        started: 10,
        direction: "ja-en",
        attempts: [answer],
      },
    ],
  };
}
const first = (state) => state.sessions[0].attempts[0];

test("古いバックアップと設定は文字入力として復元できる", () => {
  const old = backup({ ...attempt(), answer: "moon garden" });
  delete old.settings.answerMode;
  const before = structuredClone(old);
  const restored = validateBackup(old);
  assert.equal(restored.settings.answerMode, "text");
  assert.equal(first(restored).answer, "moon garden");
  assert.equal(first(restored).inputMode, undefined);
  assert.equal(first(restored).drawing, undefined);
  assert.deepEqual(old, before);
  assert.doesNotThrow(() => validateSettings(old.settings));
});

test("手書き回答は筆跡・筆圧・自己判定をJSON往復と統合で保持する", () => {
  const source = backup({
    ...attempt(),
    inputMode: "handwriting",
    drawing: drawing(),
  });
  source.settings.answerMode = "handwriting";
  const exported = JSON.parse(JSON.stringify(source));
  const restored = validateBackup(exported);
  const merged = mergeBackup(emptyState(), restored);
  assert.deepEqual(first(restored), first(source));
  assert.deepEqual(first(merged), first(source));
  assert.equal(restored.settings.answerMode, "handwriting");
  assert.equal(first(restored).answer, "");
  assert.equal(first(restored).correctness, "correct");
  assert.equal(first(restored).drawing.strokes[0][1].p, 0.75);
  assert.deepEqual(exported, source);
  first(restored).drawing.strokes[0][0].x = 0.99;
  assert.equal(first(exported).drawing.strokes[0][0].x, 0.1);
});

test("未回答の手書きスキップ・時間切れも復元できる", () => {
  for (const correctness of ["skip", "timeout"]) {
    const source = backup({
      ...attempt(),
      correctness,
      rating: 0,
      inputMode: "handwriting",
      drawing: emptyDrawing(),
    });
    assert.deepEqual(first(validateBackup(source)), first(source));
  }
});

test("筆跡は安全なデータに正規化し、読み込み元を変更しない", () => {
  const ink = drawing();
  ink.unknown = "<script>unsafe()</script>";
  ink.strokes[0][0].unknown = "<img onerror=unsafe()>";
  const source = backup({
    ...attempt(),
    inputMode: "handwriting",
    drawing: ink,
  });
  const before = structuredClone(source);
  const restored = first(validateBackup(source)).drawing;
  assert.deepEqual(restored, drawing());
  assert.deepEqual(source, before);
});

test("不正な回答方法や対応しない筆跡の組み合わせは拒否する", () => {
  for (const answer of [
    { ...attempt(), inputMode: "ocr" },
    { ...attempt(), inputMode: null },
    { ...attempt(), inputMode: "handwriting" },
    { ...attempt(), inputMode: "handwriting", drawing: null },
    { ...attempt(), inputMode: "text", drawing: drawing() },
    { ...attempt(), drawing: drawing() },
  ])
    assert.throws(() => validateBackup(backup(answer)), /回答/);
  for (const answerMode of ["text", "handwriting"])
    assert.doesNotThrow(() => validateSettings({ ...defaults, answerMode }));
  for (const answerMode of ["ocr", null, 1])
    assert.throws(
      () => validateSettings({ ...defaults, answerMode }),
      /回答方法/,
    );
});

test("壊れた座標・筆圧・バージョン・過大な筆跡は復元を中止する", () => {
  const mutations = [
    (ink) => (ink.strokes[0][0].x = NaN),
    (ink) => (ink.strokes[0][0].y = Infinity),
    (ink) => (ink.strokes[0][0].x = -0.1),
    (ink) => (ink.strokes[0][0].y = 1.1),
    (ink) => (ink.strokes[0][0].p = 2),
    (ink) => (ink.version = 2),
    (ink) => (ink.width = 0),
    (ink) => (ink.height = 0),
    (ink) =>
      (ink.strokes = Array.from({ length: MAX_STROKES + 1 }, () => [
        { x: 0, y: 0, p: 0.5 },
      ])),
    (ink) =>
      (ink.strokes = [
        Array.from({ length: MAX_POINTS + 1 }, () => ({ x: 0, y: 0, p: 0.5 })),
      ]),
  ];
  for (const mutate of mutations) {
    const ink = drawing();
    mutate(ink);
    assert.throws(
      () =>
        validateBackup(
          backup({ ...attempt(), inputMode: "handwriting", drawing: ink }),
        ),
      /手書き回答/,
    );
  }
});
