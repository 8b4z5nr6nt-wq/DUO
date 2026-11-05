import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareImport, applyImport } from "../src/materials.js";
import { emptyState, validateBackup, selectItems } from "../src/core.js";
const sample = () =>
  JSON.parse(
    readFileSync(
      new URL("../examples/materials-fictional.json", import.meta.url),
    ),
  );
test("階層と印刷番号・見出し・関連語を保持し通常問題に関連語を含めない", () => {
  const { items } = prepareImport(sample());
  assert.equal(items.length, 2);
  assert.equal(items[1].en, "paint");
  assert.equal(items[1].sentenceNumber, 1);
  assert.equal(items[1].section, 1);
  assert.deepEqual(items[1].relatedWords, [
    { en: "moon painter", ja: "月の絵描き" },
  ]);
  const state = emptyState();
  state.items = items;
  assert.deepEqual(validateBackup(state).items, items);
});
test("追加時の重複と新形式の不正値を拒否する", () => {
  const s = sample();
  const items = prepareImport(s).items;
  assert.throws(() => prepareImport(s, items), /番号重複/);
  for (const mutate of [
    (x) => (x.version = 2),
    (x) => (x.sections[0].sentences[0].words[0].number = "1"),
    (x) => (x.sections[0].sentences[0].en = " "),
    (x) => (x.extra = true),
    (x) => x.sections.push(x.sections[0]),
  ]) {
    const x = sample();
    mutate(x);
    assert.throws(() => prepareImport(x));
  }
  const d = sample();
  d.sections[0].sentences[0].words.push(d.sections[0].sentences[0].words[0]);
  assert.throws(() => prepareImport(d), /番号重複/);
});
test("更新は履歴・設定・お気に入り・既存補足を保持し失敗時は変更しない", () => {
  const state = emptyState();
  applyImport(state, prepareImport(sample()).items, "add");
  state.items[1].favorite = true;
  state.items[1].notes = "旧補足";
  state.records = { sentinel: 1 };
  state.sessions = [{ sentinel: 2 }];
  const s = sample();
  s.sections[0].sentences[0].words[0].ja = "色を塗る";
  applyImport(state, prepareImport(s, state.items, "update").items, "update");
  assert.equal(state.items[1].ja, "色を塗る");
  assert.equal(state.items[1].favorite, true);
  assert.equal(state.items[1].notes, "旧補足");
  assert.deepEqual(state.records, { sentinel: 1 });
  assert.deepEqual(state.sessions, [{ sentinel: 2 }]);
  const before = structuredClone(state);
  assert.throws(() =>
    applyImport(
      state,
      [
        {
          kind: "word",
          number: 1,
          section: 2,
          en: "paint",
          ja: "描く",
          sentenceNumber: 999,
        },
      ],
      "update",
    ),
  );
  assert.deepEqual(state, before);
});
test("旧形式を移行なしで扱い同じ英語を異なる番号で登録できる", () => {
  assert.equal(
    prepareImport([
      { kind: "word", number: 9, section: 1, en: "paint", ja: "描く" },
    ]).items.length,
    1,
  );
  const s = sample();
  const w = s.sections[0].sentences[0].words;
  w.push({ ...w[0], number: 2, related: [] });
  assert.equal(prepareImport(s).items.length, 3);
});
