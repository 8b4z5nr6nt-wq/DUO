import test from "node:test";
import assert from "node:assert/strict";
import {
  answerScaffold,
  scaffoldAnswer,
  dailyWords,
  cardWordSegments,
} from "../src/study-tools.js";
import { emptyState, validateBackup } from "../src/core.js";
import { prepareImport } from "../src/materials.js";
test("記号の補助は答えを出さず、全文貼付け・空欄・引用符と通貨を扱う", () => {
  const parts = answerScaffold("“Hello” costs $25.");
  assert.equal(parts.filter((p) => p.slot !== undefined).length, 3);
  assert.equal(
    parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join(""),
    "“”  $.",
  );
  assert.equal(scaffoldAnswer(parts, ["Hi", "is", "30"]), "“Hi” is $30.");
  assert.equal(scaffoldAnswer(parts, []), "");
  assert.equal(scaffoldAnswer(parts, ["“Hi” is $30."]), "“Hi” is $30.");
  assert.equal(answerScaffold("plain text"), null);
});
test("今日の10問は直近の文字入力評価と現在の記憶を使い、同日で安定し最大10語", () => {
  const s = emptyState();
  s.items = Array.from({ length: 14 }, (_, i) => ({
    kind: "word",
    number: i + 1,
  }));
  s.items.push({ kind: "sentence", number: 1 });
  s.sessions = [
    {
      attempts: s.items.map((i) => ({
        ...i,
        inputMode: "text",
        rating: 2,
        at: 1,
      })),
    },
  ];
  assert.equal(dailyWords(s, "2026-11-10").length, 10);
  assert.deepEqual(dailyWords(s, "2026-11-10"), dailyWords(s, "2026-11-10"));
  s.sessions.push({
    attempts: [
      { kind: "word", number: 1, inputMode: "card", rating: 0, at: 2 },
      { kind: "word", number: 2, inputMode: "text", rating: 1, at: 2 },
    ],
  });
  assert.ok(
    dailyWords(s, "2026-11-10").every((i) => i.number !== 1 && i.number !== 2),
  );
  assert.equal(
    dailyWords({ ...s, items: [], sessions: [] }, "2026-11-10").length,
    0,
  );
});
test("例文中の使用形と日本語の対応箇所を保持し推測せず単語タップに使う", () => {
  const raw = {
    format: "duo-materials",
    version: 1,
    sections: [
      {
        number: 1,
        sentences: [
          {
            number: 1,
            en: "The robot painted a moon.",
            ja: "ロボットが月を描いた。",
            words: [
              {
                number: 1,
                en: "paint",
                ja: "描く",
                sentenceForm: "painted",
                sentenceTranslation: "描いた",
              },
            ],
          },
        ],
      },
    ],
  };
  const items = prepareImport(raw).items;
  const parts = cardWordSegments(items[0], items);
  assert.equal(parts.find((p) => p.translation)?.text, "painted");
  assert.equal(parts.find((p) => p.translation)?.translation, "描いた");
  assert.equal(items[1].en, "paint");
  const state = emptyState();
  state.items = items;
  assert.equal(validateBackup(state).items[1].sentenceTranslation, "描いた");
  raw.sections[0].sentences[0].words[0].sentenceTranslation = "別の訳";
  assert.throws(() => prepareImport(raw), /日本語訳/);
});

test("単語の一致は部分文字列を避け、日本語の対応がない場合は推測しない", () => {
  const sentence = {
    kind: "sentence",
    number: 1,
    section: 1,
    en: "The hero sees heather.",
    ja: "英雄が花を見る。",
  };
  assert.ok(
    !cardWordSegments(sentence, [
      {
        kind: "word",
        number: 1,
        section: 1,
        sentenceNumber: 1,
        en: "he",
        ja: "彼",
        sentenceTranslation: "英雄",
      },
    ]).some((p) => p.translation),
  );
  assert.ok(
    !cardWordSegments(sentence, [
      {
        kind: "word",
        number: 2,
        section: 1,
        sentenceNumber: 1,
        en: "hero",
        ja: "英雄",
      },
    ]).some((p) => p.translation),
  );
});
