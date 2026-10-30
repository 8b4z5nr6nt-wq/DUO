import test from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  matchScore,
  memoryRating,
  hintWords,
  choiceAnswers,
  validateBackup,
  emptyState,
} from "../src/core.js";
test("一致率は別解・空回答・境界を扱い、3段階評価する", () => {
  assert.equal(matchScore("MOON  GARDEN", ["moon garden"], defaults), 1);
  assert.equal(matchScore("", ["moon garden"], defaults), 0);
  assert.equal(matchScore("別解", ["正解", "別解"], defaults), 1);
  assert.equal(memoryRating(0.9), 2);
  assert.equal(memoryRating(0.899), 1);
  assert.equal(memoryRating(0.6), 1);
  assert.equal(memoryRating(0.599), 0);
});
test("ヒントは英語と日本語を語で分割する", () => {
  assert.deepEqual(hintWords("My robot grows blue tomatoes.", "en"), [
    "My",
    "robot",
    "grows",
    "blue",
    "tomatoes.",
  ]);
  const words = hintWords("私は青いトマトを育てます。", "ja");
  assert.ok(words.includes("トマト"));
  assert.ok(!words.includes("。"));
});
test("4択は登録データだけで作り、別解・重複・異なる種類を除外する", () => {
  const item = {
    kind: "word",
    en: "one",
    ja: "一",
    aliasesEn: ["ONE"],
    aliasesJa: [],
  };
  const items = [
    item,
    ...["ONE", "two", "three", "four", "two"].map((en) => ({
      kind: "word",
      en,
    })),
    { kind: "sentence", en: "five" },
  ];
  const choices = choiceAnswers(item, items, "ja-en", defaults);
  assert.equal(choices.length, 4);
  assert.equal(new Set(choices).size, 4);
  assert.ok(choices.includes("one"));
  assert.ok(!choices.includes("ONE"));
  assert.ok(!choices.includes("five"));
  assert.deepEqual(choiceAnswers(item, [item], "ja-en", defaults), []);
});
test("旧バックアップを維持し新しい学習方法の設定も復元する", () => {
  for (const mode of ["text", "handwriting", "scribble", "choice", "card"]) {
    const state = emptyState();
    state.settings.answerMode = mode;
    assert.equal(validateBackup(state).settings.answerMode, mode);
  }
});
