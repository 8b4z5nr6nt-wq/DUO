// Only dates and example numbers from the supplied schedule; no textbook content.
export const quizSchedule = [
  [1, "4/20", 1, 22],
  [2, "4/27", 23, 44],
  [3, "5/11", 45, 66],
  [4, "5/18", 67, 88],
  [5, "6/8", 89, 110],
  [6, "6/15", 111, 132],
  [7, "6/22", 133, 154],
  [8, "7/13", 155, 176],
  [9, "9/14", 177, 198],
  [10, "9/24", 199, 220],
  [11, "10/5", 251, 272],
  [12, "10/13", 273, 294],
  [13, "10/20", 295, 316],
  [14, "10/24", 317, 338],
  [15, "11/2", 339, 360],
  [16, "11/9", 361, 382],
  [17, "11/16", 383, 404],
  [18, "12/7", 405, 426],
  [19, "12/17", 427, 448],
  [20, "1/18", 479, 500],
  [21, "1/25", 501, 520],
  [22, "2/1", 521, 540],
  [23, "2/8", 541, 560],
].map(([number, date, start, end]) => ({
  id: `quiz-${number}`,
  label: `第${number}回（${date}）`,
  start,
  end,
}));
export const examSchedule = [
  { id: "exam-regular-1", label: "第1回 定期考査", start: 1, end: 66 },
  { id: "exam-regular-2", label: "第2回 定期考査", start: 67, end: 154 },
  { id: "exam-proficiency-2", label: "第2回 実力テスト", start: 155, end: 250 },
  { id: "exam-regular-3", label: "第3回 定期考査", start: 251, end: 338 },
  { id: "exam-proficiency-3", label: "第3回 実力テスト", start: 339, end: 478 },
  { id: "exam-regular-4", label: "第4回 定期考査", start: 479, end: 560 },
];
export const schedulePresets = [...quizSchedule, ...examSchedule];
export function applyScheduleRange(options, id) {
  const preset = schedulePresets.find((p) => p.id === id);
  if (id && !preset) throw Error("予定表の範囲を選び直してください。");
  return {
    ...options,
    ...(preset ? { kind: "sentence" } : {}),
    sections: "",
    sentences: preset ? `${preset.start}-${preset.end}` : "",
    words: "",
    selectedIds: null,
  };
}
export function schedulePresetId(options) {
  if (
    options.kind !== "sentence" ||
    options.sections ||
    options.words ||
    options.selectedIds
  )
    return "";
  return (
    schedulePresets.find((p) => options.sentences === `${p.start}-${p.end}`)
      ?.id || ""
  );
}
