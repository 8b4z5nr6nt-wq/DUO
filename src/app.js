import "./style.css";
import { installSwipeNavigation } from "./swipe.js";
import { emptyDrawing, hasInk, mountHandwriting } from "./handwriting.js";
import {
  defaults,
  matchScore,
  memoryRating,
  hintWords,
  choiceAnswers,
  emptyState,
  difference,
  key,
  identity,
  day,
  judge,
  nextRecord,
  selectItems,
  shuffle,
  parseCSV,
  validateItems,
  validateBackup,
  validateSettings,
  mergeBackup,
  demoItems,
} from "./core.js";
import { openStorage, saveStorage, storageMessage } from "./storage.js";
const appVersion = __APP_VERSION__;
const app = document.querySelector("#app");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const ratings = ["覚えてない", "微妙", "覚えた"];
const type = (i) => (i.kind === "sentence" ? "例文" : "単語");
const fmt = (t) => new Date(t).toLocaleString("ja-JP");
const $ = (s) => app.querySelector(s);
let state,
  storageReady = false,
  busy = false,
  study = null,
  importPreview = null,
  lastResult = null;
const browse = { kind: "sentence", section: null, query: "" };
let activeNavigation = null;
let detailNavigationFocus = null;
let handwritingEditor = null;
let canvasControllers = [];
function disposeCanvases() {
  for (const controller of canvasControllers) controller.destroy();
  canvasControllers = [];
  handwritingEditor = null;
}
function captureAnswer() {
  if (!study || study.phase !== "question") return;
  if (handwritingEditor) study.drawing = handwritingEditor.getDrawing();
  if ($("#answer")) study.answer = $("#answer").value;
}
function drawingHTML(drawing, label, id = "") {
  return hasInk(drawing)
    ? `<canvas ${id ? `id="${id}"` : ""} class="handwriting-preview" role="img" aria-label="${label}" data-drawing="${esc(JSON.stringify(drawing))}">手書き回答の筆跡</canvas>`
    : '<p class="muted">（未回答）</p>';
}
function mountDrawingPreviews() {
  app.querySelectorAll("canvas[data-drawing]").forEach((canvas) => {
    canvasControllers.push(
      mountHandwriting(canvas, {
        drawing: JSON.parse(canvas.dataset.drawing),
        readOnly: true,
      }),
    );
  });
}
installSwipeNavigation(app, {
  previous: () => activeNavigation?.previous() ?? false,
  next: () => activeNavigation?.next() ?? false,
});
const defaultOptions = {
  kind: "sentence",
  direction: "en-ja",
  sections: "",
  sentences: "",
  words: "",
  filter: "all",
  order: "number",
  count: "",
  answerMode: "text",
  selectedIds: null,
};
let rangeDraft = null;
let rangeBrowse = { kind: "sentence", section: null, query: "" };
let options = { ...defaultOptions };
function notify(text, tone = "error") {
  const el = document.querySelector("#notice");
  el.textContent = text;
  el.dataset.tone = tone;
  el.hidden = !text;
}
async function commit(change) {
  if (busy) {
    notify("保存中です。少し待ってから操作してください。");
    return false;
  }
  if (!storageReady) {
    notify(
      "端末の保存領域を利用できません。再読み込みしてから操作してください。",
    );
    return false;
  }
  busy = true;
  try {
    const candidate = structuredClone(state);
    change(candidate);
    await saveStorage(candidate);
    state = candidate;
    notify("");
    return true;
  } catch (e) {
    notify(storageMessage(e));
    return false;
  } finally {
    busy = false;
  }
}
function link(route, label, primary = false) {
  return `<a class="button ${primary ? "primary" : ""}" href="#${route}">${label}</a>`;
}
function title(name, desc = "") {
  return `<p class="eyebrow">YOUR ENGLISH, YOUR PACE</p><h1>${name}</h1><p class="muted">${desc}</p>`;
}
function help() {
  return `<details><summary>iPhone・iPadで使う／オフライン確認</summary><p>SafariでHTTPS配信されたDUOを開き、初回読み込み後「オフライン準備完了」を確認します。共有ボタン →「ホーム画面に追加」で登録してください（機種・OSでメニューが異なります）。</p><p>機内モードにしてアプリを開き直し、検索・学習・履歴保存を確認してください。初回はオンライン接続が必要です。Safariのサイトデータ削除・端末の容量整理でデータが失われる場合があります。定期的にJSONバックアップを保存してください。アカウントや同期機能はありません。</p></details>`;
}
function home() {
  const today = state.sessions
    .flatMap((s) => s.attempts)
    .filter((a) => day(a.at) === day()).length;
  const due = Object.values(state.records).filter(
    (r) => r.due <= Date.now(),
  ).length;
  app.innerHTML =
    title("今日の一歩を。", "自分で登録した英語を、自分のペースで。") +
    `${study ? '<p><a class="button primary" href="#learn">途中の学習を再開</a></p>' : ""}<div class="grid"><section class="card"><p class="muted">今日の学習 / 目標 ${state.settings.goal} 問</p><div class="big">${today}<small> 問</small></div><progress max="${state.settings.goal}" value="${today}"></progress><p>${today >= state.settings.goal ? "目標達成です。" : "あと " + (state.settings.goal - today) + " 問"}</p></section><section class="card"><p class="muted">登録済み</p><div class="big">${state.items.length}<small> 件</small></div><p>復習期限到来 ${due} 方向別問題</p></section></div><section class="card"><h2>学習を始める</h2><p>例文も単語も、書いて思い出す。範囲と回答方法を選んで始めましょう。</p>${link("setup", "学習設定へ", true)} ${link("search", "登録済みデータを見る")}</section>${state.items.length ? "" : `<section class="card"><h2>まだ問題がありません</h2><p>教材データは同梱されていません。自分で確認した内容を登録してください。動作確認には開発用の架空データを使えます。</p>${link("data", "データを登録する")}</section>`}${help()}`;
}
function setup() {
  app.innerHTML =
    title("学習設定", "未登録の番号は対象外になります。") +
    `${study ? '<p><a class="button" href="#learn">途中の学習に戻る</a></p>' : ""}<form id="setup-form"><div class="grid"><label>種類<select name="kind"><option value="sentence">例文</option><option value="word">単語</option><option value="all">例文と単語</option></select></label><label>出題方向<select name="direction"><option value="en-ja">英語 → 日本語</option><option value="ja-en">日本語 → 英語</option></select></label></div><label>回答方法<select name="answerMode"><option value="text">キーボード</option><option value="scribble">手書き（Apple Pencil）・スクリブル自動採点</option><option value="choice">4択問題</option><option value="card">カード形式</option><option value="handwriting">筆跡を保存（Apple Pencil・指／自己採点）</option></select></label><p class="muted">iPadOSのスクリブルを有効にし、回答欄にApple Pencilで書くと、変換された文字を自動採点します。4択には同じ種類の異なる答えが4件以上必要です。</p><div class="range-controls"><div class="row between"><button type="button" id="choose-range">範囲を選択</button><button type="button" id="clear-range">全範囲に戻す</button></div><p id="range-summary" class="muted" aria-live="polite"></p></div><details><summary>番号を入力して範囲指定</summary><fieldset><legend>番号で範囲指定（空欄は全範囲）</legend><label>セクション<input name="sections" placeholder="例: 1-5,8"></label><div class="grid"><label>例文番号<input name="sentences" placeholder="例: 1-20"></label><label>単語番号<input name="words" placeholder="例: 1-50"></label></div></fieldset></details><div class="grid"><label>絞り込み<select name="filter"><option value="all">登録済みすべて</option><option value="weak">苦手（微妙・覚えてない）</option><option value="due">復習期限が来た問題</option><option value="favorite">お気に入り</option><option value="review">要復習マーク</option></select></label><label>順序<select name="order"><option value="number">番号順</option><option value="random">ランダム</option></select></label><label>問題数（空欄は全問）<input type="number" name="count" min="1" max="10000" placeholder="全問"></label></div><details><summary>タイマー・ヒント</summary><fieldset><legend>時間設定</legend>${timingFields(state.settings)}</fieldset></details><p id="target-count" aria-live="polite"></p><button class="primary" type="submit">学習を開始</button><button type="button" id="reset-study">学習設定を初期化</button></form>`;
  $("#reset-study").onclick = async () => {
    if (
      await commit((s) => {
        s.settings = structuredClone(defaults);
      })
    ) {
      options = { ...defaultOptions };
      setup();
      notify(
        "学習設定を初期化しました。問題・履歴・復習予定は保持しています。",
        "success",
      );
    }
  };
  const form = $("#setup-form");
  let pendingSave = Promise.resolve();
  for (const [k, v] of Object.entries(options))
    if (form.elements[k]) form.elements[k].value = v;
  const read = () => {
    options = {
      ...options,
      ...Object.fromEntries(
        [
          "kind",
          "direction",
          "sections",
          "sentences",
          "words",
          "filter",
          "order",
          "count",
          "answerMode",
        ].map((k) => [k, form.elements[k].value]),
      ),
    };
    return selectItems(state, options);
  };
  const update = () => {
    try {
      const n = read().length;
      const ids = options.selectedIds && new Set(options.selectedIds);
      const chosen = ids && state.items.filter((i) => ids.has(identity(i)));
      $("#range-summary").textContent = chosen
        ? `一覧から ${chosen.length} 問選択（例文 ${chosen.filter((i) => i.kind === "sentence").length} / 単語 ${chosen.filter((i) => i.kind === "word").length}）。種類・絞り込みは下の対象数に反映されます。`
        : [options.sections, options.sentences, options.words].some(Boolean)
          ? "番号で指定した範囲を使用中です。"
          : "全範囲から出題します。一覧で問題を選べます。";
      $("#target-count").textContent =
        `対象 ${n} 問 / 出題 ${Math.min(n, Number(options.count) || n)} 問`;
      form.querySelector('[type="submit"]').disabled = n === 0;
    } catch (e) {
      $("#target-count").textContent = e.message;
      form.querySelector('[type="submit"]').disabled = true;
    }
  };
  const saveSetup = async () => {
    read();
    const saved = {
      ...readTiming(form, state.settings),
      answerMode: options.answerMode,
      studyOptions: { ...options },
    };
    validateSettings(saved);
    return commit((s) => {
      s.settings = saved;
    });
  };
  form.addEventListener("input", (event) => {
    if (["sections", "sentences", "words"].includes(event.target.name))
      options.selectedIds = null;
    update();
    pendingSave = pendingSave.then(saveSetup).catch((e) => {
      notify(e.message);
      return false;
    });
  });
  $("#choose-range").onclick = async () => {
    try {
      await pendingSave;
      if (!(await saveSetup())) return;
      rangeDraft = null;
      location.hash = "pick-range";
    } catch (e) {
      notify(e.message);
    }
  };
  $("#clear-range").onclick = async () => {
    await pendingSave;
    options.selectedIds = null;
    for (const field of ["sections", "sentences", "words"])
      form.elements[field].value = "";
    try {
      if (await saveSetup()) update();
    } catch (e) {
      notify(e.message);
    }
  };
  update();
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await pendingSave;
      let queue = read();
      const config = {
        ...readTiming(form, state.settings),
        answerMode: options.answerMode,
      };
      validateSettings(config);
      if (
        config.answerMode === "choice" &&
        queue.some(
          (item) =>
            !choiceAnswers(item, state.items, options.direction, config).length,
        )
      )
        throw Error(
          "4択には同じ種類の異なる正解が4件以上必要です。問題を追加するか、別の回答方法を選んでください。",
        );
      if (options.order === "random") queue = shuffle(queue);
      if (options.count) queue = queue.slice(0, Number(options.count));
      if (!queue.length) return;
      const session = {
        id: crypto.randomUUID(),
        started: Date.now(),
        direction: options.direction,
        attempts: [],
      };
      if (
        !(await commit((s) => {
          s.sessions.push(session);
          s.settings = { ...config, studyOptions: { ...options } };
        }))
      )
        return;
      study = {
        queue,
        index: 0,
        sessionId: session.id,
        direction: options.direction,
        config,
        phase: "question",
        elapsed: 0,
        lastTick: performance.now(),
        paused: false,
        hints: 0,
        answer: "",
        inputMode: config.answerMode,
        drawing: emptyDrawing(),
        retried: false,
      };
      location.hash = "learn";
    } catch (e) {
      notify(e.message);
    }
  };
}
function timingFields(s) {
  return `<div class="row"><label><input type="checkbox" name="timer" ${s.timer ? "checked" : ""}>時間制限を使う</label><label><input type="checkbox" name="hints" ${s.hints ? "checked" : ""}>ヒントを使う</label></div><div class="grid"><label>制限時間（秒）<input name="limit" type="number" min="1" max="3600" value="${s.limit}" required></label><label>ヒント開始（秒）<input name="hintStart" type="number" min="0" max="3600" value="${s.hintStart}" required></label><label>ヒント間隔（秒）<input name="hintInterval" type="number" min="1" max="300" value="${s.hintInterval}" required></label></div>`;
}
function readTiming(form, s) {
  return {
    ...s,
    ...Object.fromEntries(
      ["limit", "hintStart", "hintInterval"].map((k) => [
        k,
        Number(form.elements[k].value),
      ]),
    ),
    timer: form.elements.timer.checked,
    hints: form.elements.hints.checked,
  };
}
function current() {
  return study.queue[study.index];
}
function answerText() {
  const item = current();
  return study.direction === "en-ja" ? item.ja : item.en;
}
function answerFormHTML() {
  const disabled = study.paused ? "disabled" : "";
  const handwriting = study.inputMode === "handwriting";
  if (study.inputMode === "choice") {
    study.choices ||= choiceAnswers(
      current(),
      state.items,
      study.direction,
      study.config,
    );
    return `<form id="answer-form"><p>正しい答えを選択</p><div class="choice-grid">${study.choices.map((v, i) => `<button type="button" data-choice="${i}" ${disabled}>${esc(v)}</button>`).join("")}</div><button type="button" id="skip" ${disabled}>スキップ</button></form>`;
  }
  if (study.inputMode === "card")
    return `<form id="answer-form"><p class="muted">答えを思い出してからカードをめくりましょう。</p><button class="primary" ${disabled}>カードをめくる</button><button type="button" id="skip" ${disabled}>スキップ</button></form>`;
  return `<form id="answer-form">
    <div class="answer-modes" role="group" aria-label="回答方法">
      <button type="button" data-answer-mode="text" aria-pressed="${!handwriting}" ${disabled}>キーボード</button>
      <button type="button" data-answer-mode="handwriting" aria-pressed="${handwriting}" ${disabled}>筆跡を保存</button>
      <button type="button" data-answer-mode="scribble" aria-pressed="${study.inputMode === "scribble"}" ${disabled}>手書き（Apple Pencil）</button>
    </div>
    ${
      handwriting
        ? `<div class="handwriting-workspace" data-no-swipe>
      <div class="handwriting-toolbar"><span>あなたの回答</span><div class="row">
        <button type="button" id="ink-undo" ${disabled}>ひとつ戻す</button>
        <button type="button" id="ink-clear" ${disabled}>すべて消す</button>
      </div></div>
      <p class="handwriting-help" id="handwriting-help">Apple Pencil・指・マウスで書けます。</p>
      <canvas id="handwriting-answer" class="handwriting-canvas" aria-label="手書きの回答欄" aria-describedby="handwriting-help" aria-disabled="${study.paused}">手書きに対応していない場合はキーボードへ切り替えてください。</canvas>
      <p id="ink-status" class="ink-status" role="status" aria-live="polite"></p>
    </div>`
        : `${study.inputMode === "scribble" ? '<p class="scribble-help">Apple Pencilで下の入力欄に書いてください。iPadOSのスクリブルで文字に変換後、「回答を確認」で採点します。変換した文字は修正できます。</p>' : ""}<label>あなたの回答<textarea id="answer" lang="${study.direction === "ja-en" ? "en" : "ja"}" autocomplete="off" ${disabled}>${esc(study.answer)}</textarea></label>`
    }
    <div class="row"><button class="primary" ${disabled}>回答を確認</button><button type="button" id="skip" ${disabled}>スキップ</button></div>
  </form>`;
}
function bindHandwriting() {
  const update = (drawing) => {
    study.drawing = drawing;
    const count = drawing.strokes.length;
    $("#ink-status").textContent = count
      ? `${count}画 · 書き終わったら回答を確認`
      : "まだ書いていません";
    $("#ink-undo").disabled = study.paused || count === 0;
    $("#ink-clear").disabled = study.paused || count === 0;
  };
  handwritingEditor = mountHandwriting($("#handwriting-answer"), {
    drawing: study.drawing,
    disabled: study.paused,
    onChange: update,
    onLimit: () =>
      notify(
        "この回答欄の筆跡がいっぱいです。不要な線を消すか、キーボードに切り替えてください。",
      ),
  });
  canvasControllers.push(handwritingEditor);
  $("#ink-undo").onclick = () => handwritingEditor.undo();
  $("#ink-clear").onclick = () => handwritingEditor.clear();
  update(study.drawing);
}
function learn() {
  disposeCanvases();
  if (!study) {
    app.innerHTML =
      title("学習を選んでください") + link("setup", "学習設定へ", true);
    return;
  }
  const item = current(),
    prompt = study.direction === "en-ja" ? item.en : item.ja;
  app.innerHTML = `<div class="learning">${title("学習", `${study.index + 1} / ${study.queue.length} 問 · ${type(item)} ${item.number} · セクション ${item.section} · ${study.direction === "en-ja" ? "英語 → 日本語" : "日本語 → 英語"}`)}<div class="row between"><span id="timer" aria-live="off"></span><button id="pause">${study.paused ? "再開" : "一時停止"}</button></div><p id="paused" ${study.paused ? "" : "hidden"}>一時停止中です。タイマーは進みません。</p><section class="card learning-card"><p class="prompt">${esc(prompt)}</p><p class="hint" id="hint"></p>${study.phase === "question" ? answerFormHTML() : evaluation()}</section><p class="muted">${study.retried ? "再挑戦中：前の間違いの記録は残ります。" : study.inputMode === "handwriting" ? "筆跡は文字に変換せず、正解と見比べて自己採点します。" : "文字回答は一致率で自動評価。言い換えは自己判定で変更できます。"}</p><button id="finish" class="danger">ここで終了して結果を見る</button></div>`;
  $("#pause").onclick = () => {
    captureAnswer();
    if (!study.paused) advanceClock();
    study.paused = !study.paused;
    study.lastTick = performance.now();
    learn();
  };
  $("#finish").onclick = finish;
  if (study.phase === "question") {
    app.querySelectorAll("[data-answer-mode]").forEach((button) => {
      button.onclick = async () => {
        if (
          study.paused ||
          busy ||
          button.dataset.answerMode === study.inputMode
        )
          return;
        captureAnswer();
        study.inputMode = button.dataset.answerMode;
        options.answerMode = study.inputMode;
        await commit((s) => {
          s.settings.answerMode = study.inputMode;
        });
        learn();
      };
    });
    const input = $("#answer");
    if (input) {
      let composing = false,
        compositionEnded = -Infinity;
      input.addEventListener("compositionstart", () => (composing = true));
      input.addEventListener("compositionend", () => {
        composing = false;
        compositionEnded = performance.now();
      });
      input.oninput = () => (study.answer = input.value);
      input.onkeydown = (e) => {
        if (
          e.key === "Enter" &&
          !e.shiftKey &&
          !e.isComposing &&
          !composing &&
          e.keyCode !== 229 &&
          performance.now() - compositionEnded > 80
        ) {
          e.preventDefault();
          if (!study.paused) submit();
        }
      };
      if (!study.paused) input.focus();
    } else if (study.inputMode === "handwriting") bindHandwriting();
    app.querySelectorAll("[data-choice]").forEach(
      (button) =>
        (button.onclick = () => {
          study.answer = study.choices[Number(button.dataset.choice)];
          submit();
        }),
    );
    $("#answer-form").onsubmit = (e) => {
      e.preventDefault();
      submit();
    };
    $("#skip").onclick = async () => {
      if (await recordAttempt(null, "skip")) next();
    };
  } else {
    mountDrawingPreviews();
    app.querySelectorAll("[data-rating]").forEach(
      (b) =>
        (b.onclick = async () => {
          const correctness = $("#correctness").value;
          if (await recordAttempt(Number(b.dataset.rating), correctness))
            next();
        }),
    );
    if ($("#auto-next"))
      $("#auto-next").onclick = async () => {
        const result = study.judgment || answerJudgment();
        const score =
          study.inputMode === "choice"
            ? Number(result.exact)
            : matchScore(study.answer, result.answers, study.config);
        if (
          await recordAttempt(
            study.timedOut ? 0 : memoryRating(score),
            study.timedOut ? "timeout" : result.exact ? "correct" : "incorrect",
          )
        )
          next();
      };
    $("#retry").onclick = async () => {
      const correctness = $("#correctness").value;
      if (await recordAttempt(0, correctness)) {
        study.phase = "question";
        study.elapsed = 0;
        study.hints = 0;
        study.answer = "";
        study.choices = null;
        study.drawing = emptyDrawing();
        study.retried = true;
        study.timedOut = false;
        study.judgment = null;
        study.paused = false;
        study.lastTick = performance.now();
        learn();
      }
    };
  }
  updateClockUI();
}
function submit() {
  if (study.paused || busy) return;
  captureAnswer();
  advanceClock();
  if (study.phase !== "question") return;
  study.phase = "evaluate";
  study.judgment = answerJudgment();
  learn();
}
function answerJudgment() {
  if (study.inputMode !== "handwriting")
    return judge(study.answer, current(), study.direction, study.config);
  const item = current();
  return {
    status: "self",
    exact: false,
    answers:
      study.direction === "en-ja"
        ? [item.ja, ...item.aliasesJa]
        : [item.en, ...item.aliasesEn],
  };
}
function diffHTML(input, expected) {
  const parts = difference(input, expected);
  const render = (p, tag) =>
    `${esc(p.prefix)}<${tag}>${esc(p.changed) || "（文字なし）"}</${tag}>${esc(p.suffix)}`;
  return `<div class="scroll"><p class="muted">異なる範囲を強調しています（表記上の比較）。</p><table><tr><th>比較</th><th>回答</th></tr><tr><td>入力</td><td>${render(parts.answer, "del")}</td></tr><tr><td>登録された答え</td><td>${render(parts.expected, "ins")}</td></tr></table></div>`;
}
function evaluation() {
  const result = study.judgment || answerJudgment();
  const handwritten = study.inputMode === "handwriting";
  const manual = handwritten || study.inputMode === "card";
  const score =
    study.inputMode === "choice"
      ? Number(result.exact)
      : matchScore(study.answer, result.answers, study.config);
  const autoRating = study.timedOut ? 0 : memoryRating(score);
  const status = study.timedOut
    ? "時間切れ"
    : handwritten
      ? "手書きの回答を見比べましょう"
      : result.status === "correct"
        ? "登録された正解と一致しました"
        : result.status === "spelling"
          ? "スペルミスの可能性"
          : "意味の一致は自動判断できません。自己判定してください";
  return `<h2>${study.timedOut ? "時間切れ" : handwritten ? "手書きの回答を見比べましょう" : manual ? "正解と見比べましょう" : `一致率 ${Math.round(score * 100)}% · ${ratings[autoRating]}`}</h2>${manual ? "" : `<p>${status}</p><p class="muted">表記の一致率：90%以上は覚えた、60%以上は微妙。それ未満は覚えていない。意味の一致判定ではありません。</p><button id="auto-next" class="primary" ${study.paused ? "disabled" : ""}>${ratings[autoRating]}として記録して次へ</button>`}<p>あなたの回答</p>${handwritten ? drawingHTML(study.drawing, "あなたの手書き回答", "handwriting-review") : `<pre>${esc(study.answer || "（未回答）")}</pre>`}<p>正解候補</p><pre>${result.answers.map(esc).join("\n")}</pre>${handwritten || result.status === "correct" ? "" : diffHTML(study.answer, answerText())}<label>回答の正誤（自己判定で変更できます）<select id="correctness"><option value="correct" ${result.exact && !study.timedOut ? "selected" : ""}>正解</option><option value="incorrect" ${!manual && !result.exact && !study.timedOut ? "selected" : ""}>不正解</option><option value="unknown" ${manual && !result.exact && !study.timedOut ? "selected" : ""}>判断保留</option>${study.timedOut ? '<option value="timeout" selected>時間切れ</option>' : ""}</select></label><p>記憶を評価して次へ</p><div class="row">${ratings.map((r, i) => `<button data-rating="${i}" ${study.paused ? "disabled" : ""}>${r}</button>`).join("")}</div><p><button id="retry" ${study.paused ? "disabled" : ""}>覚えてないとして記録し、その場で再挑戦</button></p>`;
}
async function recordAttempt(rating, correctness) {
  if (study.paused || busy) return false;
  captureAnswer();
  const item = current(),
    at = Date.now();
  return commit((s) => {
    const session = s.sessions.find((x) => x.id === study.sessionId);
    const attempt = {
      kind: item.kind,
      number: item.number,
      section: item.section,
      prompt: study.direction === "en-ja" ? item.en : item.ja,
      correctAnswer: answerText(),
      answer: study.inputMode === "handwriting" ? "" : study.answer,
      inputMode: study.inputMode,
      ...(study.inputMode === "handwriting"
        ? { drawing: structuredClone(study.drawing) }
        : {}),
      correctness,
      rating: rating ?? 0,
      hints: study.hints,
      hintUnit: "word",
      at,
      retry: study.retried,
      direction: study.direction,
    };
    session.attempts.push(attempt);
    const k = key(item, study.direction);
    const record = nextRecord(
      s.records[k],
      rating ?? 0,
      study.config.intervals,
      at,
    );
    if (["incorrect", "timeout", "skip"].includes(correctness))
      record.mistakes++;
    s.records[k] = record;
  });
}
function next() {
  study.index++;
  if (study.index >= study.queue.length) {
    finish();
    return;
  }
  Object.assign(study, {
    phase: "question",
    choices: null,
    elapsed: 0,
    lastTick: performance.now(),
    hints: 0,
    answer: "",
    drawing: emptyDrawing(),
    retried: false,
    timedOut: false,
    judgment: null,
  });
  learn();
}
async function finish() {
  if (busy) return;
  const id = study.sessionId;
  if (
    !(await commit((s) => {
      s.sessions.find((x) => x.id === id).ended = Date.now();
    }))
  )
    return;
  lastResult = id;
  study = null;
  location.hash = "result";
}
function advanceClock() {
  if (!study) return;
  const now = performance.now();
  if (!study.paused && study.phase === "question")
    study.elapsed += Math.max(0, now - study.lastTick) / 1000;
  study.lastTick = now;
  const s = study;
  if (!s.paused && s.phase === "question") {
    if (s.config.hints && s.elapsed >= s.config.hintStart)
      s.hints = Math.min(
        hintWords(answerText(), s.direction === "ja-en" ? "en" : "ja").length,
        1 +
          Math.floor((s.elapsed - s.config.hintStart) / s.config.hintInterval),
      );
    if (s.config.timer && s.elapsed >= s.config.limit) {
      captureAnswer();
      s.elapsed = s.config.limit;
      s.timedOut = true;
      s.phase = "evaluate";
      s.judgment = answerJudgment();
      if (location.hash === "#learn") learn();
    }
  }
}
function updateClockUI() {
  if (!study || !$("#timer")) return;
  $("#timer").textContent = study.config.timer
    ? `残り ${Math.max(0, Math.ceil(study.config.limit - study.elapsed))} 秒`
    : "時間制限なし";
  $("#hint").textContent = study.hints
    ? `ヒント: ${hintWords(
        answerText(),
        study.direction === "ja-en" ? "en" : "ja",
      )
        .slice(0, study.hints)
        .join(" ")}`
    : "";
}
setInterval(() => {
  advanceClock();
  updateClockUI();
}, 200);
function pauseForLeaving() {
  if (study && !study.paused) {
    captureAnswer();
    advanceClock();
    study.paused = true;
    if (location.hash === "#learn") learn();
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseForLeaving();
});
window.addEventListener("pagehide", pauseForLeaving);
function result() {
  const session =
    state.sessions.find((s) => s.id === lastResult) || state.sessions.at(-1);
  app.innerHTML =
    title("学習結果") +
    (session ? sessionHTML(session) : "<p>履歴がありません。</p>") +
    link("setup", "もう一度学習", true);
  mountDrawingPreviews();
}
function sessionHTML(s) {
  const a = s.attempts;
  return `<section class="card"><h2>${fmt(s.started)}</h2><p>${s.direction === "en-ja" ? "英語 → 日本語" : "日本語 → 英語"} · ${a.length} 回答 · ${new Set(a.map(identity)).size} 問 · ${s.ended ? "終了" : "途中終了／進行中"}</p><p>正解 ${a.filter((x) => x.correctness === "correct").length} / 不正解 ${a.filter((x) => x.correctness === "incorrect").length} / 保留 ${a.filter((x) => x.correctness === "unknown").length} / スキップ ${a.filter((x) => x.correctness === "skip").length} / 時間切れ ${a.filter((x) => x.correctness === "timeout").length}</p>${a.map((x) => `<details><summary>${type(x)} ${x.number} · ${ratings[x.rating]} · ${{ correct: "正解", incorrect: "不正解", unknown: "保留", skip: "スキップ", timeout: "時間切れ" }[x.correctness]} ${x.retry ? "（再挑戦）" : ""}</summary><p>${fmt(x.at)} · セクション ${x.section} · ヒント ${x.hints} ${x.hintUnit === "word" ? "語" : "文字"}</p><p>問題: ${esc(x.prompt)}</p>${x.inputMode === "handwriting" ? `<p>回答：手書き</p>${drawingHTML(x.drawing, "保存した手書き回答")}` : `<p>回答: ${esc(x.answer || "（未回答）")}</p>`}<p>正解: ${esc(x.correctAnswer)}</p></details>`).join("")}</section>`;
}
function pickRange() {
  if (!rangeDraft) {
    const registered = new Set(state.items.map(identity));
    const previous =
      options.selectedIds ??
      ([options.sections, options.sentences, options.words].some(Boolean)
        ? selectItems(state, { ...options, filter: "all" }).map(identity)
        : []);
    rangeDraft = new Set(previous.filter((id) => registered.has(id)));
    rangeBrowse = {
      kind: options.kind === "word" ? "word" : "sentence",
      section: null,
      query: "",
    };
  }
  search(undefined, true);
}
function selectionRow(i) {
  const id = identity(i);
  return `<label class="list-item range-item${rangeDraft.has(id) ? " selected" : ""}"><input type="checkbox" data-pick-id="${id}" aria-label="${type(i)} ${i.number}を選択" ${rangeDraft.has(id) ? "checked" : ""}><span class="item-body"><span class="item-number">${type(i)}${String(i.number).padStart(3, "0")}</span><span class="item-en">${esc(i.en)}</span><span class="item-ja">${esc(i.ja)}</span><span class="item-meta">セクション ${i.section}</span></span></label>`;
}
function search(requestedSection, picking = false) {
  const view = picking ? rangeBrowse : browse;
  if (requestedSection !== undefined) {
    const n = Number(requestedSection);
    if (!state.items.some((i) => i.section === n)) {
      activeNavigation = null;
      app.innerHTML =
        title(
          `セクション ${esc(requestedSection)}`,
          "このセクションはまだ登録されていません。",
        ) +
        '<div class="empty card"><p>登録済みのセクションから選んでください。</p></div>' +
        link("search", "一覧へ");
      return;
    }
    view.section = n;
    view.query = "";
  }
  app.innerHTML =
    title(
      picking ? "学習範囲を選択" : "検索・一覧",
      picking
        ? "チェックで選択。検索やセクションを変えても選択は残ります。"
        : "1セクションずつ、左右にめくって探せます。",
    ) +
    (picking
      ? `<div class="range-toolbar card"><span id="selection-count" role="status" aria-live="polite"></span><div class="row"><button id="confirm-range" class="primary">選択を確定</button><button id="cancel-range">キャンセル</button></div><button id="clear-selection">選択を全解除</button></div>`
      : "") +
    `<div class="browse-modes" role="group" aria-label="表示モード"><button class="browse-mode" data-mode="sentence" aria-pressed="${view.kind === "sentence"}">例文モード</button><button class="browse-mode" data-mode="word" aria-pressed="${view.kind === "word"}">単語モード</button></div><div class="search-tools card"><label>番号・英語・日本語<input id="query" type="search" placeholder="選んだモードの全セクションから検索" value="${esc(view.query)}"></label></div><p class="search-summary" role="status" aria-live="polite"></p><section class="section-browser card" aria-label="セクションごとの一覧"><div class="section-controls"><button id="section-previous" aria-label="前のセクション">← 前へ</button><span class="section-position" aria-label="セクションの位置"></span><button id="section-next" aria-label="次のセクション">次へ →</button></div><div class="section-tabs" role="group" aria-label="セクションを選択"></div><p class="section-hint muted">${picking ? "セクションやモードを切り替えて、学ぶ問題にチェックしてください。" : "一覧を左右にスワイプするとセクションが変わります。"}</p>${picking ? '<div class="row range-bulk"><button id="select-visible">表示中を全選択</button><button id="deselect-visible">表示中を解除</button></div>' : ""}<div id="list"></div></section>`;
  let sections = [];
  const move = (step) => {
    const index = sections.indexOf(view.section);
    const next = sections[index + step];
    if (index < 0 || next === undefined) return false;
    const tabHadFocus = document.activeElement?.closest(".section-tabs");
    view.section = next;
    update();
    if (tabHadFocus)
      $(`[data-section="${view.section}"]`)?.focus({ preventScroll: true });
    return true;
  };
  const update = () => {
    const q = view.query.trim().toLowerCase();
    const numberQuery = /^\d+$/.test(q) ? q.replace(/^0+(?=\d)/, "") : q;
    const registered = state.items.filter((i) => i.kind === view.kind);
    const matches = registered.filter(
      (i) =>
        !q ||
        String(i.number).includes(numberQuery) ||
        [i.en, i.ja, ...i.aliasesEn, ...i.aliasesJa].some((v) =>
          String(v).toLowerCase().includes(q),
        ),
    );
    sections = [
      ...new Set((q ? matches : state.items).map((i) => i.section)),
    ].sort((a, b) => a - b);
    if (!sections.includes(view.section)) view.section = sections[0] ?? null;
    const index = sections.indexOf(view.section);
    const label = view.kind === "sentence" ? "例文" : "単語・熟語";
    const rows = matches
      .filter((i) => i.section === view.section)
      .sort((a, b) => a.number - b.number);
    const total = registered.filter((i) => i.section === view.section).length;
    app
      .querySelectorAll("[data-mode]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.mode === view.kind),
        ),
      );
    $(".search-summary").textContent =
      `検索結果 ${matches.length} 件 / 登録済み ${registered.length} 件`;
    $(".section-position").textContent = `${index + 1} / ${sections.length}`;
    $("#section-previous").disabled = index <= 0;
    $("#section-next").disabled = index < 0 || index >= sections.length - 1;
    $(".section-tabs").innerHTML = sections
      .map(
        (n) =>
          `<button data-section="${n}" aria-label="セクション ${n}"${n === view.section ? ' aria-current="true"' : ""}>SECTION ${String(n).padStart(2, "0")}</button>`,
      )
      .join("");
    app.querySelectorAll("[data-section]").forEach((button) => {
      button.onclick = () => {
        view.section = Number(button.dataset.section);
        update();
        $(`[data-section="${view.section}"]`)?.focus({ preventScroll: true });
      };
    });
    const tabs = $(".section-tabs");
    const selected = tabs.querySelector('[aria-current="true"]');
    if (selected)
      tabs.scrollLeft =
        selected.offsetLeft -
        tabs.offsetLeft -
        (tabs.clientWidth - selected.offsetWidth) / 2;
    const empty = !registered.length
      ? `${label}はまだ登録されていません。`
      : q
        ? `条件に合う${label}がありません。`
        : `このセクションの${label}はまだ登録されていません。`;
    $("#list").innerHTML =
      `<section class="section-stage library-group" data-kind="${view.kind}" data-swipe-surface aria-label="${view.section === null ? "検索結果" : `セクション ${view.section}の${label}`}" aria-live="polite"><div class="section-heading"><h2>${view.section === null ? "検索結果" : `セクション ${view.section}`}</h2><span class="library-count">${rows.length} / ${total} 件</span></div><div class="library-items">${rows.length ? rows.map(picking ? selectionRow : itemLink).join("") : `<div class="empty"><p>${empty}</p><p class="muted">${q ? "検索する言葉や番号を変えてみてください。" : "ほかのセクション・モードを選ぶか、データ画面から登録できます。"}</p></div>`}</div></section>`;
    if (picking) {
      const updateSelection = () => {
        $("#selection-count").textContent = `${rangeDraft.size} 問を選択中`;
        $("#confirm-range").disabled = rangeDraft.size === 0;
        $("#clear-selection").disabled = rangeDraft.size === 0;
        $("#select-visible").disabled =
          !rows.length || rows.every((i) => rangeDraft.has(identity(i)));
        $("#deselect-visible").disabled = !rows.some((i) =>
          rangeDraft.has(identity(i)),
        );
        app.querySelectorAll("[data-pick-id]").forEach((input) => {
          input.checked = rangeDraft.has(input.dataset.pickId);
          input
            .closest(".range-item")
            .classList.toggle("selected", input.checked);
        });
      };
      app.querySelectorAll("[data-pick-id]").forEach(
        (input) =>
          (input.onchange = () => {
            if (input.checked) rangeDraft.add(input.dataset.pickId);
            else rangeDraft.delete(input.dataset.pickId);
            updateSelection();
          }),
      );
      $("#select-visible").onclick = () => {
        rows.forEach((i) => rangeDraft.add(identity(i)));
        updateSelection();
      };
      $("#deselect-visible").onclick = () => {
        rows.forEach((i) => rangeDraft.delete(identity(i)));
        updateSelection();
      };
      $("#clear-selection").onclick = () => {
        rangeDraft.clear();
        updateSelection();
      };
      updateSelection();
    }
    activeNavigation = { previous: () => move(-1), next: () => move(1) };
  };
  $("#query").oninput = () => {
    view.query = $("#query").value;
    update();
  };
  app.querySelectorAll("[data-mode]").forEach((button) => {
    button.onclick = () => {
      view.kind = button.dataset.mode;
      update();
    };
  });
  $("#section-previous").onclick = () => move(-1);
  $("#section-next").onclick = () => move(1);
  if (picking) {
    $("#cancel-range").onclick = () => {
      rangeDraft = null;
      location.hash = "setup";
    };
    $("#confirm-range").onclick = async () => {
      if (busy || !rangeDraft.size) return;
      const selectedIds = state.items
        .filter((i) => rangeDraft.has(identity(i)))
        .map(identity);
      if (selectedIds.length > 10000) {
        notify(
          "1回に選択できる学習範囲は10000問までです。選択を減らしてください。",
        );
        return;
      }
      const kinds = new Set(selectedIds.map((id) => id.split(":")[0]));
      const chosenOptions = {
        ...options,
        selectedIds,
        kind: kinds.size === 2 ? "all" : [...kinds][0],
        sections: "",
        sentences: "",
        words: "",
      };
      if (
        await commit((s) => {
          s.settings.studyOptions = chosenOptions;
        })
      ) {
        options = chosenOptions;
        rangeDraft = null;
        location.hash = "setup";
      }
    };
  }
  update();
}
function itemLink(i) {
  const metadata = [
    `セクション ${i.section}`,
    i.kind === "word" ? i.partOfSpeech : "",
    i.favorite ? "★ お気に入り" : "",
    i.review ? "要復習" : "",
  ].filter(Boolean);
  return `<a class="list-item" href="#detail/${i.kind}/${i.number}"><span class="item-number">${type(i)}${String(i.number).padStart(3, "0")}</span><span class="item-body"><span class="item-en">${esc(i.en)}</span><span class="item-ja">${esc(i.ja)}</span><span class="item-meta">${esc(metadata.join(" · "))}</span></span><span class="item-chevron" aria-hidden="true">›</span></a>`;
}
function section(n) {
  search(n);
}
function detail(kind, number) {
  activeNavigation = null;
  const item = state.items.find(
    (i) => i.kind === kind && i.number === Number(number),
  );
  if (!item) {
    app.innerHTML = title("未登録の問題です") + link("search", "一覧へ");
    return;
  }
  browse.kind = kind;
  browse.section = item.section;
  const items = state.items
    .filter((i) => i.kind === kind)
    .sort((a, b) => a.number - b.number);
  const index = items.findIndex((i) => identity(i) === identity(item));
  const move = (step) => {
    const target = items[index + step];
    if (!target) return false;
    detailNavigationFocus = document.activeElement?.matches(
      "#detail-previous, #detail-next",
    )
      ? document.activeElement.id
      : null;
    location.hash = `detail/${target.kind}/${target.number}`;
    return true;
  };
  activeNavigation = { previous: () => move(-1), next: () => move(1) };
  app.innerHTML =
    title(
      `${type(item)} ${item.number}`,
      `セクション ${item.section} · 左右にスワイプして前後の${type(item)}へ`,
    ) +
    `<div class="detail-navigation"><button id="detail-previous" aria-label="前の${type(item)}" ${index === 0 ? "disabled" : ""}>← 前へ</button><span id="detail-position" class="section-position">${index + 1} / ${items.length}</span><button id="detail-next" aria-label="次の${type(item)}" ${index === items.length - 1 ? "disabled" : ""}>次へ →</button></div><section class="card focus-card" data-swipe-surface aria-label="${type(item)} ${item.number}の詳細"><p class="prompt">${esc(item.en)}</p><p>${esc(item.ja)}</p><dl>${[
      ["別解（英語）", item.aliasesEn.join(" / ")],
      ["別解（日本語）", item.aliasesJa.join(" / ")],
      ["品詞", item.partOfSpeech],
      ["その他の意味", item.otherMeanings],
      ["説明", item.notes],
      ["類義語", item.synonyms],
      ["関連表現", item.related.join("\n")],
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`)
      .join(
        "",
      )}</dl><small>番号のない関連表現は詳細表示のみで出題しません。</small><div class="row"><button id="favorite">${item.favorite ? "★ お気に入り解除" : "☆ お気に入り"}</button><button id="review">${item.review ? "要復習を解除" : "要復習にする"}</button>${link(`edit/${kind}/${number}`, "編集")}</div></section><div class="grid">${[
      "en-ja",
      "ja-en",
    ]
      .map((d) => {
        const r = state.records[key(item, d)];
        return `<section class="card"><h2>${d === "en-ja" ? "英語 → 日本語" : "日本語 → 英語"}</h2><p>${r ? ratings[r.rating] : "未学習"}</p>${r ? `<p>復習予定 ${fmt(r.due)}</p><p>${r.attempts} 回答 / 間違い ${r.mistakes} 回</p>` : ""}</section>`;
      })
      .join("")}</div>${link("search", "一覧へ")}`;
  $("#detail-previous").onclick = () => move(-1);
  $("#detail-next").onclick = () => move(1);
  if (detailNavigationFocus) {
    const control = $("#" + detailNavigationFocus);
    const target = control?.disabled ? $("h1") : control;
    if (target) {
      if (target.tagName === "H1") target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    detailNavigationFocus = null;
  }
  for (const f of ["favorite", "review"])
    $("#" + f).onclick = async () => {
      if (
        await commit((s) => {
          const i = s.items.find((x) => identity(x) === identity(item));
          i[f] = !i[f];
        })
      ) {
        detail(kind, number);
        $("#" + f)?.focus({ preventScroll: true });
      }
    };
}
function edit(kind, number) {
  const existing = state.items.find(
      (i) => i.kind === kind && i.number === Number(number),
    ),
    item = existing || {
      kind: "sentence",
      number: "",
      section: 1,
      en: "",
      ja: "",
      aliasesEn: [],
      aliasesJa: [],
      related: [],
    };
  app.innerHTML =
    title(
      existing ? "問題を編集" : "問題を登録",
      "写真・本の内容を確認して入力してください。OCRは未実装です。",
    ) +
    `<form id="edit-form"><div class="grid"><label>種類<select name="kind" ${existing ? "disabled" : ""}><option value="sentence" ${item.kind === "sentence" ? "selected" : ""}>例文</option><option value="word" ${item.kind === "word" ? "selected" : ""}>単語・熟語</option></select></label><label>番号<input name="number" type="number" min="1" required value="${item.number}" ${existing ? "readonly" : ""}></label><label>セクション<input name="section" type="number" min="1" required value="${item.section}"></label></div>${[
      ["en", "英語"],
      ["ja", "主要な日本語の意味・訳"],
      ["aliasesEn", "英語の別解（改行区切り）"],
      ["aliasesJa", "日本語の別解（改行区切り）"],
      ["partOfSpeech", "品詞"],
      ["otherMeanings", "その他の意味（判定には使いません）"],
      ["notes", "説明"],
      ["synonyms", "類義語"],
      ["related", "番号なしの関連表現（改行区切り・出題対象外）"],
    ]
      .map(
        ([f, label]) =>
          `<label>${label}<textarea name="${f}" ${["en", "ja"].includes(f) ? "required" : ""}>${esc(Array.isArray(item[f]) ? item[f].join("\n") : item[f] || "")}</textarea></label>`,
      )
      .join(
        "",
      )}<button class="primary">保存</button> ${link("data", "戻る")}</form>`;
  $("#edit-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const raw = {
      ...existing,
      ...Object.fromEntries(
        [
          "kind",
          "number",
          "section",
          "en",
          "ja",
          "partOfSpeech",
          "otherMeanings",
          "notes",
          "synonyms",
        ].map((f) => [f, form.elements[f].value]),
      ),
    };
    for (const f of ["aliasesEn", "aliasesJa", "related"])
      raw[f] = form.elements[f].value
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean);
    const parsed = validateItems([raw], state.items, !!existing);
    if (parsed.errors.length) {
      notify(parsed.errors.join("\n"));
      return;
    }
    if (
      await commit((s) => {
        if (existing)
          s.items[
            s.items.findIndex((i) => identity(i) === identity(existing))
          ] = parsed.items[0];
        else s.items.push(parsed.items[0]);
      })
    )
      location.hash = `detail/${raw.kind}/${raw.number}`;
  };
}
function progress() {
  const attempts = state.sessions.flatMap((s) => s.attempts),
    records = Object.values(state.records);
  const counts = ratings.map(
    (_, i) => records.filter((r) => r.rating === i).length,
  );
  const total = records.length || 1;
  app.innerHTML =
    title(
      "履歴・進捗",
      "学習量は回答回数。再挑戦も含みます。評価は出題方向別の最新評価です。",
    ) +
    `<section class="card"><h2>直近7日の学習量</h2>${Array.from(
      { length: 7 },
      (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - 6 + i);
        const label = day(d),
          n = attempts.filter((a) => day(a.at) === label).length,
          max = Math.max(
            1,
            state.settings.goal,
            ...Array.from({ length: 7 }, (_, j) => {
              const t = new Date();
              t.setDate(t.getDate() - j);
              return attempts.filter((a) => day(a.at) === day(t)).length;
            }),
          );
        return `<div class="chart-row"><span>${label.slice(5)}</span><div class="bar" aria-label="${label}: ${n}問"><span style="width:${(n / max) * 100}%;background:#3678e9"></span></div><span>${n} 問</span></div>`;
      },
    ).join(
      "",
    )}</section><section class="card"><h2>3段階評価の割合</h2><div class="bar" role="img" aria-label="${ratings.map((r, i) => r + " " + counts[i] + "件").join("、")}">${counts.map((n, i) => `<span style="width:${(n / total) * 100}%;background:${["#c56e7c", "#81a8da", "#3678e9"][i]}"></span>`).join("")}</div><p>${ratings.map((r, i) => `${r} ${counts[i]}件（${Math.round((counts[i] / total) * 100)}%）`).join(" / ")}</p></section><div class="grid">${[
      "sentence",
      "word",
    ]
      .map(
        (kind) =>
          `<section class="card"><h2>${kind === "sentence" ? "例文" : "単語"}のセクション別進捗</h2>${
            [
              ...new Set(
                state.items
                  .filter((i) => i.kind === kind)
                  .map((i) => i.section),
              ),
            ]
              .sort((a, b) => a - b)
              .map((section) => {
                const items = state.items.filter(
                    (i) => i.kind === kind && i.section === section,
                  ),
                  rs = items
                    .flatMap((i) =>
                      ["en-ja", "ja-en"].map((d) => state.records[key(i, d)]),
                    )
                    .filter(Boolean),
                  learned = rs.filter((r) => r.rating === 2).length;
                return `<p><a href="#section/${section}">セクション ${section}</a> · 覚えた ${learned}/${items.length * 2} 方向別問題 · 学習済み ${rs.length}</p><progress max="${items.length * 2}" value="${learned}"></progress>`;
              })
              .join("") || "<p>未登録</p>"
          }</section>`,
      )
      .join(
        "",
      )}</div><h2>学習履歴</h2>${state.sessions.length ? [...state.sessions].reverse().map(sessionHTML).join("") : '<p class="empty">まだ履歴がありません。</p>'}`;
  mountDrawingPreviews();
}
function data() {
  app.innerHTML =
    title(
      "データ管理",
      "問題と記録はこの端末に保存されます。教材データは含まれていません。",
    ) +
    `<section class="card"><h2>登録・編集</h2><p>${state.items.length} 件登録済み</p><div class="row">${link("edit", "1件ずつ登録", true)}${link("search", "検索して編集")}<button id="demo">開発用の架空データを追加</button></div><p class="muted">架空データは4件です。DUO教材の例文・訳・単語ではありません。既存番号と重複するデータは追加しません。</p></section><section class="card"><h2>JSON / CSV一括登録</h2><label>ファイル<input id="import-file" type="file" accept=".json,.csv,application/json,text/csv"></label><label>または貼り付け<textarea id="import-text" placeholder='[{"kind":"word","number":1,"section":1,"en":"...","ja":"..."}]'></textarea></label><label>形式<select id="import-format"><option value="json">JSON</option><option value="csv">CSV</option></select></label><button id="preview-import">取り込み前に確認</button></section><section class="card"><h2>全データバックアップ・復元</h2><button id="export">JSONバックアップを保存</button><p class="muted">問題・方向別復習記録・回答履歴・設定を含みます。</p><label>バックアップを選択<input id="backup-file" type="file" accept=".json,application/json"></label><label>復元方法<select id="restore-mode"><option value="merge">追加統合（既存問題・設定を優先）</option><option value="replace">既存データを消して完全復元</option></select></label><label>またはバックアップJSONを貼り付け<textarea id="backup-text"></textarea></label><button id="preview-backup">復元前に確認</button><p class="muted">復元を確定すると途中の学習は終了します。統合では同じ履歴IDを重複させず、復習記録は更新日時が新しいものを採用します。同じ番号の問題は既存内容を保持します。</p></section><div id="preview"></div>${help()}`;
  $("#demo").onclick = async () => {
    if (
      await commit((s) => {
        for (const item of demoItems)
          if (!s.items.some((i) => identity(i) === identity(item)))
            s.items.push(item);
      })
    )
      data();
  };
  $("#export").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `duo-backup-${day()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  $("#import-file").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      if (f.size > 10 * 1024 * 1024)
        throw Error("ファイルは10MB以下にしてください。");
      $("#import-text").value = await f.text();
      $("#import-format").value = f.name.toLowerCase().endsWith(".csv")
        ? "csv"
        : "json";
    } catch (e) {
      notify(e.message);
    }
  };
  $("#backup-file").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      if (f.size > 20 * 1024 * 1024)
        throw Error("バックアップは20MB以下にしてください。");
      $("#backup-text").value = await f.text();
    } catch (e) {
      notify(e.message);
    }
  };
  $("#preview-import").onclick = () => {
    try {
      const text = $("#import-text").value;
      const raw =
        $("#import-format").value === "csv" ? parseCSV(text) : JSON.parse(text);
      const parsed = validateItems(
        Array.isArray(raw) ? raw : raw.items,
        state.items,
      );
      importPreview = {
        kind: "items",
        value: parsed.items,
        errors: parsed.errors,
      };
      showPreview();
    } catch (e) {
      notify("取り込み形式エラー: " + e.message);
    }
  };
  $("#preview-backup").onclick = () => {
    try {
      const value = validateBackup(JSON.parse($("#backup-text").value));
      importPreview = {
        kind: "backup",
        value,
        mode: $("#restore-mode").value,
        errors: [],
      };
      showPreview();
    } catch (e) {
      notify("バックアップ形式エラー: " + e.message);
    }
  };
}
function showPreview() {
  const p = importPreview,
    items = p.kind === "items" ? p.value : p.value.items;
  $("#preview").innerHTML =
    `<section class="card"><h2>${p.kind === "items" ? "登録プレビュー" : p.mode === "replace" ? "完全復元：既存データを削除します" : "追加統合プレビュー"}</h2><p>${items.length} 問${p.kind === "backup" ? ` / ${p.value.sessions.length} 学習履歴 / ${Object.keys(p.value.records).length} 復習記録` : ""}</p>${p.errors.length ? `<pre class="wrong">${p.errors.map(esc).join("\n")}</pre><p>エラーを修正してください。一部だけの登録は行いません。</p>` : ""}<div class="scroll"><table><thead><tr><th>種類・番号</th><th>セクション</th><th>英語</th><th>日本語</th></tr></thead><tbody>${items.map((i) => `<tr><td>${type(i)} ${i.number}</td><td>${i.section}</td><td>${esc(i.en)}</td><td>${esc(i.ja)}</td></tr>`).join("")}</tbody></table></div>${p.kind === "backup" ? `<p>設定: 1日 ${p.value.settings.goal}問 / 復習間隔 ${p.value.settings.intervals.join(", ")}日</p>` : ""}${p.kind === "backup" && p.mode === "replace" ? '<label><input id="confirm-replace" type="checkbox">既存データを消すことを確認しました</label>' : ""}<button id="apply-import" class="primary" ${p.errors.length || (!items.length && p.kind === "items") ? "disabled" : ""}>${p.kind === "items" ? "この内容を登録" : "この内容で復元"}</button><button id="cancel-import">キャンセル</button></section>`;
  $("#preview").scrollIntoView({ behavior: "smooth" });
  $("#cancel-import").onclick = () => {
    importPreview = null;
    $("#preview").innerHTML = "";
  };
  $("#apply-import").onclick = async () => {
    if (
      p.kind === "backup" &&
      p.mode === "replace" &&
      !$("#confirm-replace").checked
    ) {
      notify("完全復元の確認チェックを入れてください。");
      return;
    }
    if (
      await commit((s) => {
        if (p.kind === "items") {
          const recheck = validateItems(p.value, s.items);
          if (recheck.errors.length) throw Error(recheck.errors.join("\n"));
          s.items.push(...recheck.items);
        } else {
          const result =
            p.mode === "replace" ? p.value : mergeBackup(s, p.value);
          Object.assign(s, result);
        }
      })
    ) {
      if (p.kind === "backup") {
        study = null;
        lastResult = null;
        options = {
          ...defaultOptions,
          ...state.settings.studyOptions,
          answerMode: state.settings.answerMode,
        };
      }
      importPreview = null;
      data();
      notify("保存しました。", "success");
    }
  };
}
function settings() {
  const s = state.settings;
  app.innerHTML =
    title("設定", "時間設定は次の学習から反映されます。") +
    `<section class="card version-card" aria-labelledby="version-heading"><div><h2 id="version-heading">現在表示中のバージョン</h2><p class="muted">この画面で使用しているDUOのバージョンです。</p></div><strong class="version-number">v${esc(appVersion)}</strong><a class="button" href="/auth/refresh" data-refresh-app>最新版を開く</a><p class="muted">更新には通信と、必要に応じてGitHubでの再ログインを使います。保存済みの学習データは保持されます。</p></section><form id="settings-form"><section class="card"><label>1日の学習目標（回答数）<input name="goal" type="number" min="1" max="1000" value="${s.goal}" required></label>${timingFields(s)}</section><section class="card"><h2>英語回答の表記ゆれ</h2>${[
      ["ignoreCase", "大小文字を区別しない"],
      ["ignoreSpaces", "余分な空白をまとめる"],
      ["ignorePunctuation", "句読点を無視する"],
    ]
      .map(
        ([f, l]) =>
          `<label><input type="checkbox" name="${f}" ${s[f] ? "checked" : ""}>${l}</label>`,
      )
      .join(
        "",
      )}<p class="muted">全角英数字は半角に正規化し、前後の空白は常に除きます。言い換えの意味判定は行いません。</p></section><section class="card"><h2>復習間隔（日）</h2><div class="grid">${ratings.map((r, i) => `<label>${r}<input name="interval${i}" type="number" min="1" max="365" value="${s.intervals[i]}" required></label>`).join("")}</div><p class="muted">「覚えた」は連続評価回数に応じて最大8倍まで延長します。変更は次の評価から反映し、過去の復習予定は保持します。</p></section><button class="primary">設定を保存</button></form><section class="card"><h2>端末ストレージ</h2><p id="storage-estimate">確認中…</p><button id="persist">永続保存をリクエスト</button><p class="muted">Safari・OSによって永続保存は許可されない場合があります。バックアップを続けてください。複数のDUO画面を同時に編集しないでください。</p></section>${help()}`;
  $("#settings-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const f = e.currentTarget;
      const settings = {
        ...readTiming(f, s),
        goal: Number(f.elements.goal.value),
        intervals: [0, 1, 2].map((i) =>
          Number(f.elements["interval" + i].value),
        ),
        ...Object.fromEntries(
          ["ignoreCase", "ignoreSpaces", "ignorePunctuation"].map((k) => [
            k,
            f.elements[k].checked,
          ]),
        ),
      };
      validateSettings(settings);
      if (await commit((state) => (state.settings = settings)))
        notify("設定を保存しました。", "success");
    } catch (e) {
      notify(e.message);
    }
  };
  navigator.storage
    ?.estimate?.()
    .then((v) => {
      if ($("#storage-estimate"))
        $("#storage-estimate").textContent =
          `使用量 約${Math.round((v.usage || 0) / 1024)} KB / 容量 約${Math.round((v.quota || 0) / 1024 / 1024)} MB`;
    })
    .catch(() => {});
  if (!navigator.storage?.estimate)
    $("#storage-estimate").textContent =
      "このブラウザでは容量を取得できません。";
  $("#persist").onclick = async () => {
    try {
      const ok = await navigator.storage?.persist?.();
      notify(
        ok
          ? "永続保存が許可されました。"
          : "永続保存は許可されませんでした。JSONバックアップを利用してください。",
        ok ? "success" : "error",
      );
    } catch {
      notify("永続保存を利用できません。バックアップを保存してください。");
    }
  };
}
function render() {
  if (!state) return;
  if (document.querySelector("#notice").dataset.tone === "success") notify("");
  activeNavigation = null;
  const [route = "home", ...parts] = location.hash.slice(1).split("/");
  const navRoute = ["detail", "section", "pick-range"].includes(route)
    ? "search"
    : ["learn", "result"].includes(route)
      ? "setup"
      : route;
  if (route !== "pick-range") rangeDraft = null;
  if (route !== "detail") detailNavigationFocus = null;
  if (study && route !== "learn") pauseForLeaving();
  disposeCanvases();
  document
    .querySelectorAll("nav a")
    .forEach((a) => a.classList.toggle("active", a.hash === "#" + navRoute));
  (
    ({
      home,
      setup,
      learn,
      result,
      search,
      "pick-range": pickRange,
      progress,
      data,
      settings,
      detail,
      edit,
      section,
    })[route] || home
  )(...parts);
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", render);
document.addEventListener("keydown", (event) => {
  if (
    !activeNavigation ||
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    window.getSelection()?.isCollapsed === false
  )
    return;
  if (
    event.target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), nav, [data-no-swipe]',
    )
  )
    return;
  const action =
    event.key === "ArrowLeft"
      ? "previous"
      : event.key === "ArrowRight"
        ? "next"
        : null;
  if (action && activeNavigation[action]()) event.preventDefault();
});
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-refresh-app]") && (study || busy)) {
    event.preventDefault();
    notify("途中の学習を記録して終了し、保存が完了してから更新してください。");
    return;
  }
  const anchor = event.target.closest('a[href^="#"]');
  if (anchor && anchor.hash !== "#learn") pauseForLeaving();
});
function updateNotice(message) {
  const notice = document.querySelector("#app-update");
  notice.querySelector("p").textContent = message;
  notice.hidden = false;
}
let offlineReady = false;
function connection() {
  document.querySelector("#connection").textContent =
    `${navigator.onLine ? "オンライン" : "オフライン"} · ${offlineReady ? "オフライン準備完了" : "オフライン準備前"}`;
}
window.addEventListener("online", connection);
window.addEventListener("offline", connection);
async function init() {
  try {
    state = await openStorage();
    state.settings = { ...defaults, ...state.settings };
    options = {
      ...defaultOptions,
      ...state.settings.studyOptions,
      answerMode: state.settings.answerMode,
    };
    storageReady = true;
  } catch (e) {
    state = emptyState();
    notify(storageMessage(e));
  }
  render();
  connection();
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    try {
      let hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadController)
          updateNotice(
            "更新の準備ができました。学習を記録したあと、最新版を開いてください。",
          );
        hadController = true;
      });
      const registration = await navigator.serviceWorker.register(
        `${import.meta.env.BASE_URL}sw.js`,
        { updateViaCache: "none" },
      );
      if (registration.active)
        registration.update().catch(() => {
          if (navigator.onLine)
            updateNotice(
              "更新を確認できませんでした。「最新版を開く」から再ログインして更新できます。",
            );
        });
      window.addEventListener("online", () => {
        registration
          .update()
          .catch(() =>
            updateNotice(
              "更新を確認できませんでした。「最新版を開く」から再ログインして更新できます。",
            ),
          );
      });
      await navigator.serviceWorker.ready;
      offlineReady = true;
      connection();
    } catch {
      offlineReady = !!navigator.serviceWorker.controller;
      connection();
      if (navigator.onLine)
        updateNotice(
          "更新を確認できませんでした。「最新版を開く」から再ログインして更新できます。",
        );
    }
  } else if (import.meta.env.DEV) {
    document.querySelector("#connection").textContent =
      "開発モード（PWAはビルド後に確認）";
  }
}
init();
