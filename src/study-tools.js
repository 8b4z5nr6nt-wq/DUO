const special = /[“”"「」『』＄$€£¥￥!?！？:;。、,.…（）()]/u;
export function answerScaffold(expected) {
  if (!special.test(expected)) return null;
  let slot = 0;
  return expected
    .split(/([“”"「」『』＄$€£¥￥!?！？:;。、,.…（）()])/u)
    .filter(Boolean)
    .flatMap((text) => {
      if (special.test(text) || !text.trim()) return [{ text }];
      const m = text.match(/^(\s*)([\s\S]*?\S)(\s*)$/);
      return [
        ...(m[1] ? [{ text: m[1] }] : []),
        { slot: slot++ },
        ...(m[3] ? [{ text: m[3] }] : []),
      ];
    });
}
export function scaffoldAnswer(parts, values) {
  const filled = values.filter((v) => v?.trim());
  // Full pasted answers remain usable, including their own punctuation.
  if (filled.length === 1 && values[0]?.trim() && special.test(values[0]))
    return values[0];
  if (!filled.length) return "";
  return parts
    .map((p) => (p.slot === undefined ? p.text : values[p.slot] || ""))
    .join("");
}
export function dailyWords(state, date) {
  const typed = new Map(),
    latest = new Map();
  for (const session of state.sessions)
    for (const attempt of session.attempts) {
      if (attempt.kind !== "word") continue;
      const previous = latest.get(attempt.number);
      if (!previous || attempt.at >= previous.at)
        latest.set(attempt.number, attempt);
      if (attempt.inputMode === undefined || attempt.inputMode === "text") {
        const old = typed.get(attempt.number);
        if (!old || attempt.at >= old.at) typed.set(attempt.number, attempt);
      }
    }
  const hash = (number) => {
    let h = 2166136261;
    for (const c of `${date}:${number}`)
      h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  return state.items
    .filter(
      (i) =>
        i.kind === "word" &&
        typed.get(i.number)?.rating === 2 &&
        latest.get(i.number)?.rating === 2,
    )
    .sort((a, b) => hash(a.number) - hash(b.number) || a.number - b.number)
    .slice(0, 10);
}
export function cardWordSegments(sentence, items) {
  const candidates = [];
  for (const word of items) {
    if (
      word.kind !== "word" ||
      word.sentenceNumber !== sentence.number ||
      word.section !== sentence.section
    )
      continue;
    const form = word.sentenceForm || word.en;
    const translation = word.sentenceTranslation;
    if (!translation || !sentence.ja.includes(translation)) continue;
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      String.raw`(^|[^\p{L}\p{N}])(${escaped})(?=$|[^\p{L}\p{N}])`,
      "giu",
    );
    for (const m of sentence.en.matchAll(re)) {
      const start = m.index + m[1].length;
      candidates.push({
        start,
        end: start + m[2].length,
        text: m[2],
        translation,
      });
    }
  }
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  let cursor = 0;
  const result = [];
  for (const c of candidates) {
    if (c.start < cursor) continue;
    if (c.start > cursor)
      result.push({ text: sentence.en.slice(cursor, c.start) });
    result.push(c);
    cursor = c.end;
  }
  if (cursor < sentence.en.length)
    result.push({ text: sentence.en.slice(cursor) });
  return result;
}
