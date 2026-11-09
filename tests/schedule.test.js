import test from "node:test";
import assert from "node:assert/strict";
import {
  quizSchedule,
  examSchedule,
  schedulePresets,
  applyScheduleRange,
  schedulePresetId,
} from "../src/schedule.js";
import { emptyState, selectItems, validateBackup } from "../src/core.js";
test("予定表23回と6つの考査・実力テストを保持し追加範囲も含む", () => {
  assert.equal(quizSchedule.length, 23);
  assert.equal(examSchedule.length, 6);
  assert.deepEqual(
    quizSchedule.map((p) => [p.start, p.end]),
    [
      [1, 22],
      [23, 44],
      [45, 66],
      [67, 88],
      [89, 110],
      [111, 132],
      [133, 154],
      [155, 176],
      [177, 198],
      [199, 220],
      [251, 272],
      [273, 294],
      [295, 316],
      [317, 338],
      [339, 360],
      [361, 382],
      [383, 404],
      [405, 426],
      [427, 448],
      [479, 500],
      [501, 520],
      [521, 540],
      [541, 560],
    ],
  );
  assert.deepEqual(
    examSchedule.map((p) => p.end - p.start + 1),
    [66, 88, 96, 88, 140, 82],
  );
  assert.equal(quizSchedule[15].label, "第16回（11/9）");
  const state = emptyState();
  state.items = Array.from({ length: 560 }, (_, i) => ({
    kind: "sentence",
    number: i + 1,
    section: 1,
  }));
  const second = applyScheduleRange(
    { filter: "all", direction: "en-ja" },
    "exam-proficiency-2",
  );
  assert.equal(selectItems(state, second).length, 96);
  assert.ok(selectItems(state, second).some((i) => i.number === 250));
  const third = applyScheduleRange(second, "exam-proficiency-3");
  assert.equal(selectItems(state, third).length, 140);
  assert.ok(selectItems(state, third).some((i) => i.number === 478));
  assert.equal(new Set(schedulePresets.map((p) => p.id)).size, 29);
});
test("予定表を選ぶと以前の一覧・番号範囲を解除し例文だけを対象にする", () => {
  const original = {
    kind: "all",
    sections: "9",
    sentences: "1",
    words: "2",
    selectedIds: ["word:361"],
    direction: "ja-en",
    filter: "all",
    order: "random",
    count: "2",
  };
  const next = applyScheduleRange(original, "quiz-16");
  assert.equal(next.kind, "sentence");
  assert.equal(next.sentences, "361-382");
  assert.equal(next.sections, "");
  assert.equal(next.words, "");
  assert.equal(next.selectedIds, null);
  assert.equal(next.direction, "ja-en");
  assert.equal(next.order, "random");
  assert.equal(original.sections, "9");
  const state = emptyState();
  state.items = [
    { kind: "sentence", number: 360, section: 1 },
    { kind: "sentence", number: 361, section: 9 },
    { kind: "sentence", number: 382, section: 10 },
    { kind: "sentence", number: 383, section: 1 },
    { kind: "word", number: 361, section: 9 },
  ];
  assert.deepEqual(
    selectItems(state, next).map((i) => i.number),
    [361, 382],
  );
  state.settings.studyOptions = next;
  state.items = [];
  assert.equal(
    schedulePresetId(validateBackup(state).settings.studyOptions),
    "quiz-16",
  );
  assert.equal(
    schedulePresetId({ ...next, selectedIds: ["sentence:361"] }),
    "",
  );
  assert.equal(schedulePresetId({ ...next, sentences: "361" }), "");
  assert.equal(schedulePresetId(applyScheduleRange(next, "")), "");
  assert.throws(() => applyScheduleRange(next, "unknown"), /選び直し/);
});
