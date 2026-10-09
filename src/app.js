import "./style.css";
import {
  defaults,
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
let options = {
  kind: "sentence",
  direction: "en-ja",
  sections: "",
  sentences: "",
  words: "",
  filter: "all",
  order: "number",
  count: "",
};
function notify(text) {
  const el = document.querySelector("#notice");
  el.textContent = text;
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
    `${study ? '<p><a class="button primary" href="#learn">途中の学習を再開</a></p>' : ""}<div class="grid"><section class="card"><p class="muted">今日の学習 / 目標 ${state.settings.goal} 問</p><div class="big">${today}<small> 問</small></div><progress max="${state.settings.goal}" value="${today}"></progress><p>${today >= state.settings.goal ? "目標達成です。" : "あと " + (state.settings.goal - today) + " 問"}</p></section><section class="card"><p class="muted">登録済み</p><div class="big">${state.items.length}<small> 件</small></div><p>復習期限到来 ${due} 方向別問題</p></section></div><section class="card"><h2>学習を始める</h2><p>4つの出題方法。範囲とペースを選んで始めましょう。</p>${link("setup", "学習設定へ", true)} ${link("search", "登録済みデータを見る")}</section>${state.items.length ? "" : `<section class="card"><h2>まだ問題がありません</h2><p>教材データは同梱されていません。自分で確認した内容を登録してください。動作確認には開発用の架空データを使えます。</p>${link("data", "データを登録する")}</section>`}${help()}`;
}
function setup() {
  app.innerHTML =
    title("学習設定", "未登録の番号は対象外になります。") +
    `${study ? '<p><a class="button" href="#learn">途中の学習に戻る</a></p>' : ""}<form id="setup-form"><div class="grid"><label>種類<select name="kind"><option value="sentence">例文</option><option value="word">単語</option><option value="all">例文と単語</option></select></label><label>出題方向<select name="direction"><option value="en-ja">英語 → 日本語</option><option value="ja-en">日本語 → 英語</option></select></label></div><fieldset><legend>番号で範囲指定（空欄は全範囲）</legend><label>セクション<input name="sections" placeholder="例: 1-5,8"></label><div class="grid"><label>例文番号<input name="sentences" placeholder="例: 1-20"></label><label>単語番号<input name="words" placeholder="例: 1-50"></label></div></fieldset><div class="grid"><label>絞り込み<select name="filter"><option value="all">登録済みすべて</option><option value="weak">苦手（微妙・覚えてない）</option><option value="due">復習期限が来た問題</option><option value="favorite">お気に入り</option><option value="review">要復習マーク</option></select></label><label>順序<select name="order"><option value="number">番号順</option><option value="random">ランダム</option></select></label><label>問題数（空欄は全問）<input type="number" name="count" min="1" max="10000" placeholder="全問"></label></div><fieldset><legend>今回の時間設定</legend>${timingFields(state.settings)}</fieldset><p id="target-count" aria-live="polite"></p><button class="primary" type="submit">学習を開始</button></form>`;
  const form = $("#setup-form");
  for (const [k, v] of Object.entries(options)) form.elements[k].value = v;
  const read = () => {
    options = Object.fromEntries(
      [
        "kind",
        "direction",
        "sections",
        "sentences",
        "words",
        "filter",
        "order",
        "count",
      ].map((k) => [k, form.elements[k].value]),
    );
    return selectItems(state, options);
  };
  const update = () => {
    try {
      const n = read().length;
      $("#target-count").textContent =
        `対象 ${n} 問 / 出題 ${Math.min(n, Number(options.count) || n)} 問`;
      form.querySelector("button").disabled = n === 0;
    } catch (e) {
      $("#target-count").textContent = e.message;
      form.querySelector("button").disabled = true;
    }
  };
  form.addEventListener("input", update);
  update();
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const config = readTiming(form, state.settings);
      validateSettings(config);
      let queue = read();
      if (options.order === "random") queue = shuffle(queue);
      if (options.count) queue = queue.slice(0, Number(options.count));
      if (!queue.length) return;
      const session = {
        id: crypto.randomUUID(),
        started: Date.now(),
        direction: options.direction,
        attempts: [],
      };
      if (!(await commit((s) => s.sessions.push(session)))) return;
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
function learn() {
  if (!study) {
    app.innerHTML =
      title("学習を選んでください") + link("setup", "学習設定へ", true);
    return;
  }
  const item = current(),
    prompt = study.direction === "en-ja" ? item.en : item.ja;
  app.innerHTML = `<div class="learning">${title("学習", `${study.index + 1} / ${study.queue.length} 問 · ${type(item)} ${item.number} · セクション ${item.section} · ${study.direction === "en-ja" ? "英語 → 日本語" : "日本語 → 英語"}`)}<div class="row between"><span id="timer" aria-live="off"></span><button id="pause">${study.paused ? "再開" : "一時停止"}</button></div><p id="paused" ${study.paused ? "" : "hidden"}>一時停止中です。タイマーは進みません。</p><section class="card"><p class="prompt">${esc(prompt)}</p><p class="hint" id="hint"></p>${study.phase === "question" ? `<form id="answer-form"><label>あなたの回答<textarea id="answer" autocomplete="off" ${study.paused ? "disabled" : ""}>${esc(study.answer)}</textarea></label><div class="row"><button class="primary" ${study.paused ? "disabled" : ""}>回答を確認</button><button type="button" id="skip" ${study.paused ? "disabled" : ""}>スキップ</button></div></form>` : evaluation()}</section><p class="muted">${study.retried ? "再挑戦中：前の間違いの記録は残ります。" : "日本語は自己判定。英語も言い換えの場合は自己判定できます。"}</p><button id="finish" class="danger">ここで終了して結果を見る</button></div>`;
  $("#pause").onclick = () => {
    if (!study.paused) advanceClock();
    study.paused = !study.paused;
    study.lastTick = performance.now();
    learn();
  };
  $("#finish").onclick = finish;
  if (study.phase === "question") {
    const input = $("#answer");
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
    $("#answer-form").onsubmit = (e) => {
      e.preventDefault();
      submit();
    };
    $("#skip").onclick = async () => {
      if (await recordAttempt(null, "skip")) next();
    };
    if (!study.paused) input.focus();
  } else {
    app.querySelectorAll("[data-rating]").forEach(
      (b) =>
        (b.onclick = async () => {
          const correctness = $("#correctness").value;
          if (await recordAttempt(Number(b.dataset.rating), correctness))
            next();
        }),
    );
    $("#retry").onclick = async () => {
      const correctness = $("#correctness").value;
      if (await recordAttempt(0, correctness)) {
        study.phase = "question";
        study.elapsed = 0;
        study.hints = 0;
        study.answer = "";
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
  advanceClock();
  if (study.phase !== "question") return;
  study.answer = $("#answer").value;
  study.phase = "evaluate";
  study.judgment = judge(
    study.answer,
    current(),
    study.direction,
    study.config,
  );
  learn();
}
function diffHTML(input, expected) {
  const parts = difference(input, expected);
  const render = (p, tag) =>
    `${esc(p.prefix)}<${tag}>${esc(p.changed) || "（文字なし）"}</${tag}>${esc(p.suffix)}`;
  return `<div class="scroll"><p class="muted">異なる範囲を強調しています（表記上の比較）。</p><table><tr><th>比較</th><th>回答</th></tr><tr><td>入力</td><td>${render(parts.answer, "del")}</td></tr><tr><td>登録された答え</td><td>${render(parts.expected, "ins")}</td></tr></table></div>`;
}
function evaluation() {
  const result =
    study.judgment ||
    judge(study.answer, current(), study.direction, study.config);
  const status = study.timedOut
    ? "時間切れ"
    : result.status === "correct"
      ? "登録された正解と一致しました"
      : result.status === "spelling"
        ? "スペルミスの可能性"
        : "意味の一致は自動判断できません。自己判定してください";
  return `<h2>${status}</h2><p>あなたの回答</p><pre>${esc(study.answer || "（未回答）")}</pre><p>正解候補</p><pre>${result.answers.map(esc).join("\n")}</pre>${result.status === "correct" ? "" : diffHTML(study.answer, answerText())}<label>回答の正誤（自己判定で変更できます）<select id="correctness"><option value="correct" ${result.exact && !study.timedOut ? "selected" : ""}>正解</option><option value="incorrect" ${result.status === "spelling" && !study.timedOut ? "selected" : ""}>不正解</option><option value="unknown" ${!result.exact && result.status !== "spelling" && !study.timedOut ? "selected" : ""}>判断保留</option>${study.timedOut ? '<option value="timeout" selected>時間切れ</option>' : ""}</select></label><p>記憶を評価して次へ</p><div class="row">${ratings.map((r, i) => `<button data-rating="${i}" ${study.paused ? "disabled" : ""}>${r}</button>`).join("")}</div><p><button id="retry" ${study.paused ? "disabled" : ""}>覚えてないとして記録し、その場で再挑戦</button></p>`;
}
async function recordAttempt(rating, correctness) {
  if (study.paused || busy) return false;
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
      answer: study.answer,
      correctness,
      rating: rating ?? 0,
      hints: study.hints,
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
    elapsed: 0,
    lastTick: performance.now(),
    hints: 0,
    answer: "",
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
        Array.from(answerText()).length,
        1 +
          Math.floor((s.elapsed - s.config.hintStart) / s.config.hintInterval),
      );
    if (s.config.timer && s.elapsed >= s.config.limit) {
      s.elapsed = s.config.limit;
      s.timedOut = true;
      s.phase = "evaluate";
      s.judgment = judge(s.answer, current(), s.direction, s.config);
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
    ? `ヒント: ${Array.from(answerText()).slice(0, study.hints).join("")}`
    : "";
}
setInterval(() => {
  advanceClock();
  updateClockUI();
}, 200);
function pauseForLeaving() {
  if (study && !study.paused) {
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
}
function sessionHTML(s) {
  const a = s.attempts;
  return `<section class="card"><h2>${fmt(s.started)}</h2><p>${s.direction === "en-ja" ? "英語 → 日本語" : "日本語 → 英語"} · ${a.length} 回答 · ${new Set(a.map(identity)).size} 問 · ${s.ended ? "終了" : "途中終了／進行中"}</p><p>正解 ${a.filter((x) => x.correctness === "correct").length} / 不正解 ${a.filter((x) => x.correctness === "incorrect").length} / 保留 ${a.filter((x) => x.correctness === "unknown").length} / スキップ ${a.filter((x) => x.correctness === "skip").length} / 時間切れ ${a.filter((x) => x.correctness === "timeout").length}</p>${a.map((x) => `<details><summary>${type(x)} ${x.number} · ${ratings[x.rating]} · ${{ correct: "正解", incorrect: "不正解", unknown: "保留", skip: "スキップ", timeout: "時間切れ" }[x.correctness]} ${x.retry ? "（再挑戦）" : ""}</summary><p>${fmt(x.at)} · セクション ${x.section} · ヒント ${x.hints} 文字</p><p>問題: ${esc(x.prompt)}</p><p>回答: ${esc(x.answer || "（未回答）")}</p><p>正解: ${esc(x.correctAnswer)}</p></details>`).join("")}</section>`;
}
function search() {
  app.innerHTML =
    title("検索・一覧", "番号は例文と単語を区別します。") +
    `<div class="grid"><label>番号・英語・日本語<input id="query" type="search" placeholder="例: 1 / robot / 月"></label><label>種類<select id="search-kind"><option value="all">すべて</option><option value="sentence">例文</option><option value="word">単語</option><option value="sections">セクション</option></select></label></div><div id="list"></div>`;
  const update = () => {
    const q = $("#query").value.trim().toLowerCase(),
      kind = $("#search-kind").value;
    let items = state.items.filter(
      (i) =>
        (kind === "all" || kind === "sections" || i.kind === kind) &&
        (!q ||
          [i.number, i.en, i.ja, ...i.aliasesEn, ...i.aliasesJa].some((v) =>
            String(v).toLowerCase().includes(q),
          )),
    );
    if (kind === "sections") {
      const sections = [...new Set(state.items.map((i) => i.section))]
        .sort((a, b) => a - b)
        .filter((n) => !q || String(n).includes(q));
      $("#list").innerHTML =
        sections
          .map(
            (n) =>
              `<a class="list-item" href="#section/${n}">セクション ${n} · ${state.items.filter((i) => i.section === n).length} 件</a>`,
          )
          .join("") || '<p class="empty">登録済みセクションがありません。</p>';
    } else
      $("#list").innerHTML =
        `<p class="muted">${items.length} 件</p>` +
          items
            .sort((a, b) => a.section - b.section || a.number - b.number)
            .map(itemLink)
            .join("") || "<p>該当なし</p>";
  };
  $("#query").oninput = update;
  $("#search-kind").onchange = update;
  update();
}
function itemLink(i) {
  return `<a class="list-item" href="#detail/${i.kind}/${i.number}"><span class="badge">${type(i)} ${i.number}</span> <small>セクション ${i.section} ${i.favorite ? "★" : ""} ${i.review ? "要復習" : ""}</small><p>${esc(i.en)}</p><small>${esc(i.ja)}</small></a>`;
}
function section(n) {
  app.innerHTML =
    title(`セクション ${esc(n)}`) +
    state.items
      .filter((i) => String(i.section) === n)
      .map(itemLink)
      .join("") +
    link("search", "一覧へ");
}
function detail(kind, number) {
  const item = state.items.find(
    (i) => i.kind === kind && i.number === Number(number),
  );
  if (!item) {
    app.innerHTML = title("未登録の問題です") + link("search", "一覧へ");
    return;
  }
  app.innerHTML =
    title(`${type(item)} ${item.number}`, `セクション ${item.section}`) +
    `<section class="card"><p class="prompt">${esc(item.en)}</p><p>${esc(item.ja)}</p><dl>${[
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
  for (const f of ["favorite", "review"])
    $("#" + f).onclick = async () => {
      if (
        await commit((s) => {
          const i = s.items.find((x) => identity(x) === identity(item));
          i[f] = !i[f];
        })
      )
        detail(kind, number);
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
        return `<div class="chart-row"><span>${label.slice(5)}</span><div class="bar" aria-label="${label}: ${n}問"><span style="width:${(n / max) * 100}%;background:#bded99"></span></div><span>${n} 問</span></div>`;
      },
    ).join(
      "",
    )}</section><section class="card"><h2>3段階評価の割合</h2><div class="bar" role="img" aria-label="${ratings.map((r, i) => r + " " + counts[i] + "件").join("、")}">${counts.map((n, i) => `<span style="width:${(n / total) * 100}%;background:${["#c57868", "#d8ba79", "#bded99"][i]}"></span>`).join("")}</div><p>${ratings.map((r, i) => `${r} ${counts[i]}件（${Math.round((counts[i] / total) * 100)}%）`).join(" / ")}</p></section><div class="grid">${[
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
      }
      importPreview = null;
      data();
      notify("保存しました。");
    }
  };
}
function settings() {
  const s = state.settings;
  app.innerHTML =
    title("設定", "時間設定は次の学習から反映されます。") +
    `<form id="settings-form"><section class="card"><label>1日の学習目標（回答数）<input name="goal" type="number" min="1" max="1000" value="${s.goal}" required></label>${timingFields(s)}</section><section class="card"><h2>英語回答の表記ゆれ</h2>${[
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
        notify("設定を保存しました。");
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
      );
    } catch {
      notify("永続保存を利用できません。バックアップを保存してください。");
    }
  };
}
function render() {
  if (!state) return;
  const [route = "home", ...parts] = location.hash.slice(1).split("/");
  if (study && route !== "learn") pauseForLeaving();
  document
    .querySelectorAll("nav a")
    .forEach((a) => a.classList.toggle("active", a.hash === "#" + route));
  (
    ({
      home,
      setup,
      learn,
      result,
      search,
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
document.addEventListener("click", (event) => {
  const anchor = event.target.closest('a[href^="#"]');
  if (anchor && anchor.hash !== "#learn") pauseForLeaving();
});
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
    storageReady = true;
  } catch (e) {
    state = emptyState();
    notify(storageMessage(e));
  }
  render();
  connection();
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    try {
      await navigator.serviceWorker.register(
        `${import.meta.env.BASE_URL}sw.js`,
      );
      await navigator.serviceWorker.ready;
      offlineReady = true;
      connection();
    } catch {
      notify(
        "オフライン準備に失敗しました。オンラインで再読み込みしてください。",
      );
    }
  } else if (import.meta.env.DEV) {
    document.querySelector("#connection").textContent =
      "開発モード（PWAはビルド後に確認）";
  }
}
init();
