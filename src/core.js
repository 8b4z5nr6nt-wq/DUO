import { normalizeDrawing } from "./handwriting.js";

export const defaults = {
  goal: 10,
  intervals: [1, 3, 7],
  ignoreCase: true,
  ignoreSpaces: true,
  ignorePunctuation: false,
  limit: 30,
  hintStart: 10,
  hintInterval: 3,
  timer: true,
  hints: true,
  answerMode: "text",
};
export const emptyState = () => ({
  version: 1,
  items: [],
  records: {},
  sessions: [],
  settings: { ...defaults },
});
export const key = (item, direction) =>
  `${item.kind}:${item.number}:${direction}`;
export const identity = (item) => `${item.kind}:${item.number}`;
export const day = (date = new Date()) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function normalize(text, settings) {
  let value = text.trim().normalize("NFKC");
  if (settings.ignoreCase) value = value.toLowerCase();
  if (settings.ignoreSpaces) value = value.replace(/\s+/g, " ");
  if (settings.ignorePunctuation) value = value.replace(/[\p{P}]/gu, "");
  return value;
}
export function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = old;
    }
  }
  return row[b.length];
}
export function judge(answer, item, direction, settings) {
  const answers =
    direction === "en-ja"
      ? [item.ja, ...item.aliasesJa]
      : [item.en, ...item.aliasesEn];
  const exact = answers.some(
    (a) => normalize(a, settings) === normalize(answer, settings),
  );
  if (direction === "en-ja") return { status: "self", exact, answers };
  if (exact) return { status: "correct", exact, answers };
  const near = answers.some(
    (a) =>
      distance(normalize(answer, settings), normalize(a, settings)) <=
      Math.max(1, Math.floor(a.length * 0.15)),
  );
  return { status: near ? "spelling" : "self", exact: false, answers };
}
export function nextRecord(previous, rating, intervals, now = Date.now()) {
  const streak = rating === 2 ? (previous?.streak || 0) + 1 : 0;
  const days =
    rating === 0
      ? intervals[0]
      : rating === 1
        ? intervals[1]
        : intervals[2] * Math.min(streak, 8);
  return {
    rating,
    streak,
    due: now + days * 86400000,
    updated: now,
    attempts: (previous?.attempts || 0) + 1,
    mistakes: previous?.mistakes || 0,
  };
}
export function parseRange(value) {
  if (!value.trim()) return null;
  const set = new Set();
  for (const part of value.split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw Error("範囲は「1-5,8」の形式で指定してください。");
    const lo = +m[1],
      hi = +(m[2] || m[1]);
    if (lo < 1 || hi < lo || hi - lo > 10000)
      throw Error("範囲は1以上、昇順で10000件以内にしてください。");
    for (let n = lo; n <= hi; n++) set.add(n);
  }
  return set;
}
function selectionSet(ids) {
  if (ids === undefined || ids === null) return null;
  if (
    !Array.isArray(ids) ||
    ids.length > 10000 ||
    ids.some(
      (id) =>
        typeof id !== "string" ||
        !/^(sentence|word):[1-9]\d*$/.test(id) ||
        !Number.isSafeInteger(Number(id.split(":")[1])),
    )
  )
    throw Error("選択した学習範囲の形式が不正です。");
  const selected = new Set(ids);
  if (selected.size !== ids.length)
    throw Error("選択した学習範囲に重複があります。");
  return selected;
}
export function selectItems(state, options) {
  const sections = parseRange(options.sections || ""),
    sentences = parseRange(options.sentences || ""),
    words = parseRange(options.words || ""),
    selected = selectionSet(options.selectedIds);
  return state.items
    .filter((item) => {
      if (selected && !selected.has(identity(item))) return false;
      if (options.kind !== "all" && item.kind !== options.kind) return false;
      if (sections && !sections.has(item.section)) return false;
      const range = item.kind === "sentence" ? sentences : words;
      if (range && !range.has(item.number)) return false;
      const record = state.records[key(item, options.direction)];
      if (options.filter === "weak" && (!record || record.rating === 2))
        return false;
      if (options.filter === "due" && (!record || record.due > Date.now()))
        return false;
      if (options.filter === "favorite" && !item.favorite) return false;
      if (options.filter === "review" && !item.review) return false;
      return true;
    })
    .sort(
      (a, b) =>
        a.number - b.number ||
        a.kind.localeCompare(b.kind) ||
        a.section - b.section,
    );
}
export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
export function parseCSV(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted) {
        quoted = false;
        if (text[i + 1] && !["\r", "\n", ","].includes(text[i + 1]))
          throw Error("CSVの引用符の後に不正な文字があります。");
      } else if (!field) {
        quoted = true;
      } else throw Error("CSVの引用符が不正です。");
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw Error("CSVの引用符が閉じていません。");
  row.push(field);
  if (row.some((v) => v !== "")) rows.push(row);
  const header = rows.shift();
  if (!header) throw Error("CSVが空です。");
  if (new Set(header).size !== header.length)
    throw Error("CSVの列名が重複しています。");
  return rows.map((r, i) => {
    if (r.length !== header.length)
      throw Error(`CSV ${i + 2}行目の列数が一致しません。`);
    return Object.fromEntries(header.map((h, j) => [h.trim(), r[j]]));
  });
}
export function validateItems(raw, existing = [], allowUpdate = false) {
  if (!Array.isArray(raw)) throw Error("問題データは配列にしてください。");
  if (raw.length > 10000) throw Error("一度の取り込みは10000件までです。");
  const errors = [],
    seen = new Set(),
    known = new Set(existing.map(identity)),
    items = [];
  raw.forEach((r, i) => {
    try {
      if (!r || typeof r !== "object") throw Error("オブジェクトが必要です");
      if (!["sentence", "word"].includes(r.kind))
        throw Error("kind は sentence または word");
      for (const field of ["number", "section"])
        if (!Number.isSafeInteger(Number(r[field])) || Number(r[field]) < 1)
          throw Error(`${field} は1以上の整数`);
      for (const field of ["en", "ja"])
        if (typeof r[field] !== "string" || !r[field].trim())
          throw Error(`${field} が必要です`);
      const item = {
        kind: r.kind,
        number: Number(r.number),
        section: Number(r.section),
        en: r.en.trim(),
        ja: r.ja.trim(),
        favorite: r.favorite === true,
        review: r.review === true,
      };
      if (r.sentenceNumber !== undefined) {
        if (
          r.kind !== "word" ||
          !Number.isSafeInteger(r.sentenceNumber) ||
          r.sentenceNumber < 1
        )
          throw Error("対応する例文番号が不正です");
        item.sentenceNumber = r.sentenceNumber;
      }
      if (r.relatedWords !== undefined) {
        if (
          r.kind !== "word" ||
          !Array.isArray(r.relatedWords) ||
          r.relatedWords.length > 10000
        )
          throw Error("関連語の形式が不正です");
        const seenRelated = new Set();
        item.relatedWords = r.relatedWords.map((v) => {
          if (
            !v ||
            typeof v.en !== "string" ||
            !v.en.trim() ||
            typeof v.ja !== "string" ||
            !v.ja.trim()
          )
            throw Error("関連語には英語と日本語が必要です");
          if (seenRelated.has(v.en.trim()))
            throw Error("関連語が重複しています");
          seenRelated.add(v.en.trim());
          return { en: v.en.trim(), ja: v.ja.trim() };
        });
      }
      for (const f of ["sentenceForm", "sentenceTranslation"]) {
        if (r[f] !== undefined) {
          if (
            r.kind !== "word" ||
            !Number.isSafeInteger(r.sentenceNumber) ||
            typeof r[f] !== "string" ||
            !r[f].trim()
          )
            throw Error(
              "例文内の表記・訳には対応例文番号と空でない文字列が必要です",
            );
          item[f] = r[f].trim();
        }
      }
      for (const f of ["aliasesEn", "aliasesJa", "related"]) {
        const v = r[f] ?? [];
        if (Array.isArray(v) && v.every((x) => typeof x === "string"))
          item[f] = v;
        else if (typeof v === "string")
          item[f] = v
            .split("|")
            .map((x) => x.trim())
            .filter(Boolean);
        else throw Error(`${f} は文字列配列`);
      }
      for (const f of ["partOfSpeech", "otherMeanings", "notes", "synonyms"]) {
        if (r[f] != null && typeof r[f] !== "string")
          throw Error(`${f} は文字列`);
        item[f] = r[f] || "";
      }
      if (
        seen.has(identity(item)) ||
        (!allowUpdate && known.has(identity(item)))
      )
        throw Error("番号重複（種類ごとに一意）");
      seen.add(identity(item));
      items.push(item);
    } catch (e) {
      errors.push(`${i + 1}件目: ${e.message}`);
    }
  });
  return { items, errors };
}
export function validateBackup(raw) {
  if (
    !raw ||
    raw.version !== 1 ||
    !Array.isArray(raw.sessions) ||
    !raw.records ||
    typeof raw.records !== "object" ||
    Array.isArray(raw.records) ||
    !raw.settings
  )
    throw Error("対応するDUOバックアップ（version: 1）ではありません。");
  const parsed = validateItems(raw.items);
  if (parsed.errors.length) throw Error(parsed.errors.join("\n"));
  const settings = { ...defaults, ...raw.settings };
  validateSettings(settings);
  for (const [k, r] of Object.entries(raw.records)) {
    if (
      !/^(sentence|word):[1-9]\d*:(en-ja|ja-en)$/.test(k) ||
      !r ||
      ![0, 1, 2].includes(r.rating) ||
      !Number.isFinite(r.due) ||
      !Number.isFinite(r.updated) ||
      !Number.isSafeInteger(r.attempts) ||
      r.attempts < 1 ||
      !Number.isSafeInteger(r.streak) ||
      r.streak < 0 ||
      !Number.isSafeInteger(r.mistakes) ||
      r.mistakes < 0
    )
      throw Error("復習記録の形式が不正です。");
  }
  const ids = new Set(),
    sessions = [];
  for (const s of raw.sessions) {
    if (
      !s ||
      typeof s.id !== "string" ||
      ids.has(s.id) ||
      !Number.isFinite(s.started) ||
      !["en-ja", "ja-en"].includes(s.direction) ||
      !Array.isArray(s.attempts)
    )
      throw Error("学習履歴の形式が不正です。");
    ids.add(s.id);
    const attempts = [];
    for (const a of s.attempts) {
      if (
        !a ||
        !["sentence", "word"].includes(a.kind) ||
        !Number.isSafeInteger(a.number) ||
        a.number < 1 ||
        !Number.isSafeInteger(a.section) ||
        a.section < 1 ||
        typeof a.answer !== "string" ||
        typeof a.correctAnswer !== "string" ||
        typeof a.prompt !== "string" ||
        ![0, 1, 2].includes(a.rating) ||
        !["correct", "incorrect", "unknown", "skip", "timeout"].includes(
          a.correctness,
        ) ||
        !Number.isFinite(a.at) ||
        !Number.isSafeInteger(a.hints) ||
        a.hints < 0
      )
        throw Error("回答履歴の形式が不正です。");
      if (
        a.inputMode !== undefined &&
        !["text", "handwriting", "scribble", "choice", "card"].includes(
          a.inputMode,
        )
      )
        throw Error("回答方法の形式が不正です。");
      if (a.inputMode === "handwriting") {
        let drawing;
        try {
          drawing = normalizeDrawing(a.drawing);
        } catch {
          throw Error("手書き回答の形式が不正です。");
        }
        attempts.push({ ...a, drawing });
      } else {
        if (a.drawing !== undefined)
          throw Error("手書き回答の回答方法が指定されていません。");
        attempts.push(a);
      }
    }
    sessions.push({ ...s, attempts });
  }
  return {
    version: 1,
    items: parsed.items,
    records: structuredClone(raw.records),
    sessions: structuredClone(sessions),
    settings,
  };
}
export function validateSettings(s) {
  selectionSet(s.studyOptions?.selectedIds);
  if (
    s.answerMode !== undefined &&
    !["text", "handwriting", "scribble", "choice", "card"].includes(
      s.answerMode,
    )
  )
    throw Error("回答方法は文字入力または手書きを選んでください。");
  for (const [f, min, max] of [
    ["goal", 1, 1000],
    ["limit", 1, 3600],
    ["hintStart", 0, 3600],
    ["hintInterval", 1, 300],
  ])
    if (!Number.isFinite(s[f]) || s[f] < min || s[f] > max)
      throw Error("設定の時間・目標が範囲外です。");
  if (
    !Array.isArray(s.intervals) ||
    s.intervals.length !== 3 ||
    s.intervals.some((x) => !Number.isFinite(x) || x < 1 || x > 365)
  )
    throw Error("復習間隔は1〜365日で指定してください。");
  for (const f of [
    "ignoreCase",
    "ignoreSpaces",
    "ignorePunctuation",
    "timer",
    "hints",
  ])
    if (typeof s[f] !== "boolean") throw Error("設定の形式が不正です。");
}
export function mergeBackup(state, backup) {
  const items = new Map(state.items.map((i) => [identity(i), i]));
  for (const i of backup.items)
    if (!items.has(identity(i))) items.set(identity(i), i);
  const records = { ...state.records };
  for (const [k, r] of Object.entries(backup.records))
    if (!records[k] || r.updated > records[k].updated) records[k] = r;
  const sessions = new Map(state.sessions.map((s) => [s.id, s]));
  for (const s of backup.sessions)
    if (!sessions.has(s.id)) sessions.set(s.id, s);
  return {
    ...state,
    items: [...items.values()],
    records,
    sessions: [...sessions.values()].sort((a, b) => a.started - b.started),
  };
}
export const demoItems = [
  {
    kind: "sentence",
    number: 1,
    section: 1,
    en: "My robot grows blue tomatoes.",
    ja: "私のロボットは青いトマトを育てます。",
    notes: "開発用の架空例文。DUO教材の内容ではありません。",
  },
  {
    kind: "sentence",
    number: 2,
    section: 2,
    en: "A tiny dragon opened the window.",
    ja: "小さなドラゴンが窓を開けました。",
  },
  {
    kind: "word",
    number: 1,
    section: 1,
    en: "moon garden",
    ja: "月の庭",
    aliasesJa: ["月面の庭"],
    partOfSpeech: "名詞（架空の表現）",
    otherMeanings: "宇宙の庭（補足例）",
    synonyms: "lunar garden",
    related: ["moon gardener（番号なし・表示のみ）"],
  },
  {
    kind: "word",
    number: 2,
    section: 2,
    en: "sparkle",
    ja: "きらめく",
    aliasesJa: ["輝く"],
    partOfSpeech: "動詞",
  },
].map((i) => validateItems([i]).items[0]);

// Mark the changed span while retaining the shared prefix/suffix.
export function difference(answer, expected) {
  const a = Array.from(answer),
    b = Array.from(expected);
  let start = 0,
    end = 0;
  while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
  while (
    end < Math.min(a.length, b.length) - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const split = (chars) => ({
    prefix: chars.slice(0, start).join(""),
    changed: chars.slice(start, chars.length - end).join(""),
    suffix: end ? chars.slice(-end).join("") : "",
  });
  return { answer: split(a), expected: split(b) };
}

// Surface-form similarity only; no network or semantic inference.
export function matchScore(answer, answers, settings) {
  const a = normalize(answer, settings);
  if (!a) return 0;
  return Math.max(
    ...answers.map((value) => {
      const b = normalize(value, settings);
      return Math.max(0, 1 - distance(a, b) / Math.max(a.length, b.length, 1));
    }),
  );
}
export const memoryRating = (score) =>
  score >= 0.9 ? 2 : score >= 0.6 ? 1 : 0;
export function hintWords(text, language) {
  if (language === "en") return text.trim().split(/\s+/u).filter(Boolean);
  return Array.from(
    new Intl.Segmenter("ja", { granularity: "word" }).segment(text),
  )
    .filter((x) => x.isWordLike)
    .map((x) => x.segment);
}
export function choiceAnswers(item, items, direction, settings) {
  const field = direction === "en-ja" ? "ja" : "en";
  const accepted = [
    item[field],
    ...(direction === "en-ja" ? item.aliasesJa : item.aliasesEn),
  ];
  const distractors = [
    ...new Map(
      items
        .filter((x) => x.kind === item.kind)
        .map((x) => [normalize(x[field], settings), x[field]]),
    ).values(),
  ].filter(
    (x) =>
      !accepted.some((a) => normalize(a, settings) === normalize(x, settings)),
  );
  return distractors.length < 3
    ? []
    : shuffle([item[field], ...shuffle(distractors).slice(0, 3)]);
}
