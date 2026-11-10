import Ajv from "ajv";
import schema from "../schemas/materials.schema.json" with { type: "json" };
import { validateItems, identity } from "./core.js";
const validate = new Ajv({ allErrors: true }).compile(schema);
export function parseMaterials(raw) {
  if (!validate(raw)) {
    const messages = {
      required: "必須項目がありません",
      additionalProperties: "未対応の項目です",
      type: "型が違います",
      const: "形式・バージョンが違います",
      minimum: "番号は1以上です",
      maximum: "番号が大きすぎます",
      minLength: "空文字は使えません",
      pattern: "空白だけの文字は使えません",
      maxItems: "件数が多すぎます",
    };
    throw Error(
      validate.errors
        .slice(0, 20)
        .map(
          (e) =>
            `${e.instancePath || "/"}: ${messages[e.keyword] || "形式が不正です"} ${e.params.missingProperty || e.params.additionalProperty || ""}`,
        )
        .join("\n"),
    );
  }
  const items = [],
    sections = new Set();
  for (const section of raw.sections) {
    if (sections.has(section.number))
      throw Error("セクション番号が重複しています。");
    sections.add(section.number);
    for (const sentence of section.sentences) {
      const { words = [], ...s } = sentence;
      items.push({ ...s, kind: "sentence", section: section.number });
      for (const word of words) {
        const { related = [], ...w } = word;
        items.push({
          ...w,
          kind: "word",
          section: section.number,
          sentenceNumber: s.number,
          relatedWords: related,
        });
      }
    }
  }
  return items;
}
export function prepareImport(raw, existing = [], mode = "add") {
  if (!["add", "update"].includes(mode)) throw Error("登録方法が不正です。");
  const input =
    raw?.format !== undefined
      ? parseMaterials(raw)
      : Array.isArray(raw)
        ? raw
        : raw?.items;
  if (!Array.isArray(input)) throw Error("教材JSONの形式が不正です。");
  if (input.some((i) => !i || typeof i !== "object" || Array.isArray(i)))
    throw Error("問題データはオブジェクトにしてください。");
  const known = new Map(existing.map((i) => [identity(i), i]));
  const merged = input.map((i) =>
    mode === "update"
      ? {
          ...known.get(identity(i)),
          ...i,
          favorite: known.get(identity(i))?.favorite ?? false,
          review: known.get(identity(i))?.review ?? false,
        }
      : i,
  );
  const parsed = validateItems(merged, existing, mode === "update");
  if (parsed.errors.length) throw Error(parsed.errors.join("\n"));
  const all = new Map(
    [...existing, ...parsed.items].map((i) => [identity(i), i]),
  );
  for (const item of all.values())
    if (item.sentenceNumber !== undefined) {
      const parent = all.get(`sentence:${item.sentenceNumber}`);
      if (
        item.sentenceTranslation &&
        !parent?.ja.includes(item.sentenceTranslation)
      )
        throw Error(
          `単語 ${item.number}: 例文内の日本語訳は対応する例文の訳に含まれる文字列にしてください。`,
        );
      if (
        item.sentenceForm &&
        !parent?.en.toLowerCase().includes(item.sentenceForm.toLowerCase())
      )
        throw Error(
          `単語 ${item.number}: 例文内の表記が対応する英文にありません。`,
        );
      if (!parent || parent.section !== item.section)
        throw Error(
          `単語 ${item.number}: 対応する例文・セクションが一致しません。`,
        );
    }
  return {
    items: parsed.items,
    added: parsed.items.filter((i) => !known.has(identity(i))).length,
    updated: parsed.items.filter((i) => known.has(identity(i))).length,
  };
}
export function applyImport(state, items, mode) {
  const checked = prepareImport(items, state.items, mode);
  const merged = new Map(state.items.map((i) => [identity(i), i]));
  for (const item of checked.items) merged.set(identity(item), item);
  state.items = [...merged.values()];
}
