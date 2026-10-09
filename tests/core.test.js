import test from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  emptyState,
  validateItems,
  demoItems,
  judge,
  nextRecord,
  parseRange,
  selectItems,
  shuffle,
  parseCSV,
  validateBackup,
  mergeBackup,
  key,
} from "../src/core.js";
test("4種類の方向: 英語一致・表記ゆれ・日本語自己判定・別解", () => {
  const item = demoItems[3];
  assert.equal(judge("SPARKLE ", item, "ja-en", defaults).status, "correct");
  assert.equal(judge("輝く", item, "en-ja", defaults).status, "self");
  assert.equal(judge("輝く", item, "en-ja", defaults).exact, true);
  assert.equal(judge("sparkl", item, "ja-en", defaults).status, "spelling");
  assert.equal(judge("shine", item, "ja-en", defaults).status, "self");
  assert.equal(
    judge("SPARKLE", item, "ja-en", { ...defaults, ignoreCase: false }).exact,
    false,
  );
  assert.equal(
    judge("sparkle!", item, "ja-en", { ...defaults, ignorePunctuation: true })
      .exact,
    true,
  );
  assert.equal(
    judge("My  robot grows blue tomatoes.", demoItems[0], "ja-en", defaults)
      .exact,
    true,
  );
  assert.equal(
    judge("My  robot grows blue tomatoes.", demoItems[0], "ja-en", {
      ...defaults,
      ignoreSpaces: false,
    }).exact,
    false,
  );
});
test("番号範囲・部分登録・種類と方向別絞り込み", () => {
  const s = emptyState();
  s.items = structuredClone(demoItems);
  assert.deepEqual([...parseRange("1-3,5")], [1, 2, 3, 5]);
  assert.throws(() => parseRange("3-1"));
  assert.throws(() => parseRange("abc"));
  const o = {
    kind: "sentence",
    direction: "en-ja",
    sections: "1-9",
    sentences: "1-100",
  };
  assert.equal(selectItems(s, o).length, 2);
  assert.equal(selectItems(s, { ...o, sections: "9" }).length, 0);
  s.records[key(s.items[0], "en-ja")] = nextRecord(
    null,
    0,
    defaults.intervals,
    1,
  );
  assert.equal(selectItems(s, { ...o, filter: "weak" }).length, 1);
  assert.equal(
    selectItems(s, { ...o, direction: "ja-en", filter: "weak" }).length,
    0,
  );
  assert.equal(selectItems(s, { ...o, filter: "due" }).length, 1);
  s.items[0].favorite = true;
  assert.equal(selectItems(s, { ...o, filter: "favorite" }).length, 1);
  assert.equal(selectItems(s, { ...o, filter: "review" }).length, 0);
  assert.equal(shuffle(s.items, () => 0).length, 4);
  assert.notDeepEqual(
    shuffle(s.items, () => 0),
    s.items,
  );
});
test("復習間隔・連続評価・間違い保持", () => {
  const r = { ...nextRecord(null, 0, [1, 3, 7], 100), mistakes: 1 };
  const good = nextRecord(r, 2, [1, 3, 7], 100);
  assert.equal(good.mistakes, 1);
  assert.equal(good.due, 100 + 7 * 86400000);
  assert.equal(nextRecord(good, 2, [1, 3, 7], 100).due, 100 + 14 * 86400000);
  assert.equal(nextRecord(good, 1, [1, 3, 7], 100).streak, 0);
});
test("CSV 引用符・改行・別解、番号重複・必須項目", () => {
  const csv =
    'kind,number,section,en,ja,aliasesJa\r\nword,1,1,"moon, garden","月の\n庭",月面|月の庭';
  const rows = parseCSV(csv);
  assert.equal(rows[0].en, "moon, garden");
  assert.equal(validateItems(rows).errors.length, 0);
  assert.throws(() => parseCSV('a,b\n"broken'));
  assert.throws(() => parseCSV("a,b\n1,2,3"));
  assert.equal(validateItems([demoItems[0], demoItems[0]]).errors.length, 1);
  assert.equal(validateItems([demoItems[0]], demoItems).errors.length, 1);
  assert.equal(validateItems([demoItems[0]], demoItems, true).errors.length, 0);
  assert.equal(validateItems([{ kind: "word", number: 0 }]).errors.length, 1);
  assert.equal(validateItems([demoItems[0], demoItems[2]]).errors.length, 0);
});
test("バックアップ完全復元・統合・不正形式・履歴重複", () => {
  const s = emptyState();
  s.items = structuredClone(demoItems);
  s.records[key(s.items[0], "en-ja")] = nextRecord(
    null,
    2,
    defaults.intervals,
    1,
  );
  s.sessions = [
    {
      id: "a",
      started: 1,
      direction: "en-ja",
      attempts: [
        {
          kind: "sentence",
          number: 1,
          section: 1,
          prompt: "test",
          correctAnswer: "test",
          answer: "test",
          rating: 2,
          correctness: "correct",
          at: 1,
          hints: 0,
        },
      ],
    },
  ];
  const b = validateBackup(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(b, s);
  const current = structuredClone(s);
  current.items[0].en = "keep me";
  assert.equal(mergeBackup(current, b).items[0].en, "keep me");
  assert.equal(mergeBackup(current, b).sessions.length, 1);
  assert.throws(() => validateBackup({ ...s, version: 99 }));
  assert.throws(() => validateBackup({ ...s, records: { bad: {} } }));
  assert.throws(() =>
    validateBackup({ ...s, settings: { ...defaults, hintInterval: 0 } }),
  );
  assert.throws(() => validateBackup({ ...s, sessions: [{ id: "broken" }] }));
});
test("相違範囲を表示し、挿入・削除・Unicodeを区別する", async () => {
  const { difference } = await import("../src/core.js");
  assert.deepEqual(difference("sparkl", "sparkle").expected, {
    prefix: "sparkl",
    changed: "e",
    suffix: "",
  });
  assert.equal(difference("cat", "cart").answer.changed, "");
  assert.equal(difference("月の畑", "月の庭").expected.changed, "庭");
  assert.equal(difference("🦋a", "🦋b").answer.prefix, "🦋");
});
