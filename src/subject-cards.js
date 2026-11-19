import { createStorage, storageMessage } from "./storage.js";
import { bindCardSwipe, bindCardTap } from "./swipe.js";
import { day } from "./core.js";
import {
  historyQueue,
  historySettings,
  isHistoryCategory,
  readHistoryBackup,
  renderHistoryScreen,
} from "./history-screens.js";

const subjects = {
  ja: {
    name: "国語",
    detail: "現代文単語・古文単語",
    decks: { modern: "現代文単語", classical: "古文単語" },
  },
  history: { name: "歴史総合", decks: { general: "歴史総合" } },
};
const fileLimit = 10 * 1024 * 1024;
const cardLimit = 10000;
const keyOf = ({ deck, number }) => `${deck}:${number}`;

function readSubjectCards(raw, id, backup = false) {
  if (
    raw?.format !== (backup ? "history-backup" : "subject-cards") ||
    raw.version !== 1 ||
    !Array.isArray(raw.cards)
  )
    throw Error(
      "カード教材のJSON形式を確認してください。ひな形をダウンロードできます。",
    );
  if (raw.subject !== id)
    throw Error("選択中の科目とJSONの科目が一致しません。");
  if ((!backup && !raw.cards.length) || raw.cards.length > cardLimit)
    throw Error("カードを1〜10,000件指定してください。");
  const seen = new Set();
  return raw.cards.map((card, index) => {
    const deck = card?.deck ?? (id === "history" ? "general" : "");
    if (
      typeof deck !== "string" ||
      !Object.hasOwn(subjects[id].decks, deck) ||
      !Number.isSafeInteger(card?.number) ||
      card.number < 1
    )
      throw Error(`${index + 1}件目のカードの分類と番号を確認してください。`);
    const { number, question, answer, category } = card;
    if (
      id === "history" &&
      category !== undefined &&
      !isHistoryCategory(category)
    )
      throw Error(
        `${index + 1}件目のカードの分類（category）を確認してください。`,
      );
    if (
      typeof question !== "string" ||
      !question.trim() ||
      typeof answer !== "string" ||
      !answer.trim()
    )
      throw Error(`${index + 1}件目の問題・答えを入力してください。`);
    const key = keyOf({ deck, number });
    if (seen.has(key))
      throw Error(
        `${subjects[id].decks[deck]}の番号${number}が重複しています。`,
      );
    seen.add(key);
    const result = {
      deck,
      number,
      question: question.trim(),
      answer: answer.trim(),
    };
    if (id === "history" && category !== undefined) result.category = category;
    return result;
  });
}

export function subjectPicker() {
  return `<section class="subject-picker"><h1>科目を選ぶ</h1><div class="subject-grid">
    <a class="subject-tile subject-tile-english" href="#home"><strong>英</strong><span>英語</span></a>
    <a class="subject-tile" data-subject-theme="ja" href="#subject/ja"><strong>国</strong><span>現代文・古文単語</span></a>
    <a class="subject-tile" href="#subject/time"><strong>時</strong><span>準備中</span></a>
    <a class="subject-tile" data-subject-theme="history" href="#subject/history"><strong>歴</strong><span>歴史総合</span></a>
  </div></section>`;
}

export function createSubjectScreens(app, esc, notify, versionCard) {
  const contexts = new Map();
  const find = (selector) => app.querySelector(selector);
  let renderId = 0;

  async function render(id, screen = "", part = "") {
    const token = ++renderId;
    const hash = location.hash;
    const isCurrent = () => token === renderId && location.hash === hash;
    if (id === "time") {
      app.innerHTML =
        '<h1>時</h1><section class="card"><p>準備中です。</p><a class="button" href="#subjects">科目を選ぶ</a></section>';
      return;
    }
    if (!Object.hasOwn(subjects, id)) {
      app.innerHTML = subjectPicker();
      return;
    }
    const subject = subjects[id];
    const base = `#subject/${id}`;
    const heading = `<h1>${subject.name}</h1>`;
    let context = contexts.get(id);
    if (!context) {
      const storage = createStorage(`subject:${id}`, () => ({
        cards: [],
        ratings: {},
      }));
      context = {
        storage,
        loading: storage.open(),
        deck: "all",
        session: null,
        busy: false,
      };
      contexts.set(id, context);
    }
    if (!context.state) {
      app.innerHTML = heading + '<p role="status">読み込み中…</p>';
      try {
        context.state = await context.loading;
      } catch (error) {
        contexts.delete(id);
        if (isCurrent()) {
          app.innerHTML = heading + "<p>教材を開けませんでした。</p>";
          notify(storageMessage(error));
        }
        return;
      }
      if (!isCurrent()) return;
    }
    const { state } = context;
    async function save(next) {
      if (context.busy) return false;
      context.busy = true;
      try {
        await context.storage.save(next);
        context.state = next;
        return true;
      } catch (error) {
        if (isCurrent()) notify(storageMessage(error));
        return false;
      } finally {
        context.busy = false;
      }
    }
    const go = (page = "") => {
      location.hash = base + (page ? `/${page}` : "");
    };
    const back = `<a class="button" href="${base}">${subject.name}のホーム</a>`;
    const isHistory = id === "history";
    const queue = state.cards.filter(
      (card) => context.deck === "all" || card.deck === context.deck,
    );
    function start() {
      if (context.busy || context.session) return;
      const cards = isHistory
        ? historyQueue(context.state)
        : [...queue].sort(
            (a, b) => a.deck.localeCompare(b.deck) || a.number - b.number,
          );
      if (!cards.length) {
        notify(
          "この条件で出題できるカードがありません。学習設定をご確認ください。",
        );
        return;
      }
      context.session = {
        queue: cards,
        index: 0,
        revealed: false,
        totals: [0, 0, 0],
      };
      go("learn");
    }
    if (
      isHistory &&
      renderHistoryScreen(screen, {
        app,
        part,
        context,
        state,
        esc,
        save,
        notify,
        isCurrent,
        start,
        versionCard,
      })
    )
      return;

    if (screen === "data") {
      app.innerHTML =
        (isHistory ? "<h1>データ管理</h1>" : heading) +
        `<section class="card"><h2>教材JSONの取り込み</h2>
        <label>JSONファイル<input id="subject-file" type="file" accept=".json,application/json"></label>
        <label>またはJSONを貼り付け<textarea id="subject-json" spellcheck="false"></textarea></label>
        <div class="row"><button id="subject-preview" class="primary" type="button">取り込み前に確認</button>
        <button id="subject-template" type="button">JSONのひな形</button></div>
        <div id="subject-confirmation" aria-live="polite"></div></section>
        ${isHistory ? `<section class="card"><h2>バックアップ</h2><p>教材・評価・履歴・設定を保存します。復元は上の取り込みから行えます。</p><button id="history-backup" type="button">バックアップを保存</button></section>` : ""}${back}`;
      if (isHistory)
        find("#history-backup").onclick = () => {
          const current = context.state;
          downloadJSON("history-backup.json", {
            format: "history-backup",
            version: 1,
            subject: id,
            cards: current.cards,
            ratings: current.ratings,
            attempts: current.attempts ?? [],
            settings: historySettings(current),
          });
        };
      const file = find("#subject-file");
      const input = find("#subject-json");
      const confirmation = find("#subject-confirmation");
      file.addEventListener("change", () => {
        input.value = "";
        confirmation.replaceChildren();
      });
      input.addEventListener("input", () => {
        file.value = "";
        confirmation.replaceChildren();
      });
      find("#subject-template").onclick = () => downloadTemplate(id);
      find("#subject-preview").onclick = async (event) => {
        const button = event.currentTarget;
        const selected = file.files[0];
        const pasted = input.value;
        confirmation.replaceChildren();
        button.disabled = true;
        try {
          if (
            selected
              ? selected.size > fileLimit
              : new Blob([pasted]).size > fileLimit
          )
            throw Error("JSONは10MB以下にしてください。");
          const text = selected ? await selected.text() : pasted;
          if (
            !isCurrent() ||
            selected !== file.files[0] ||
            pasted !== input.value
          )
            return;
          let raw;
          try {
            raw = JSON.parse(text.replace(/^\uFEFF/, ""));
          } catch {
            throw Error(
              "JSONを読み取れません。ファイルまたは貼り付けた内容を確認してください。",
            );
          }
          const backup = isHistory && raw?.format === "history-backup";
          const cards = readSubjectCards(raw, id, backup);
          const restore = backup ? readHistoryBackup(raw, cards) : null;
          const merged = new Map(
            context.state.cards.map((card) => [keyOf(card), card]),
          );
          const updated = cards.filter((card) =>
            merged.has(keyOf(card)),
          ).length;
          for (const card of cards) merged.set(keyOf(card), card);
          if (merged.size > cardLimit)
            throw Error("登録できるカードは科目ごとに10,000件までです。");
          confirmation.innerHTML = `<p>追加 ${cards.length - updated}件 · 更新 ${backup ? 0 : updated}件</p>
            ${restore ? "<p>既存のカード・評価・設定を優先し、未登録のカードと履歴を追加します。</p>" : `<p>最初のカード</p><p class="subject-import-sample">${esc(cards[0].question)} → ${esc(cards[0].answer)}</p>`}
            <button id="subject-import" type="button" class="primary">${restore ? "バックアップを追加統合" : "この内容を登録"}</button>`;
          find("#subject-import").onclick = async (event) => {
            const commit = event.currentTarget;
            commit.disabled = true;
            // Rebuild from the current state in case a previous write completed during preview.
            const next = new Map(
              context.state.cards.map((card) => [keyOf(card), card]),
            );
            for (const card of cards) {
              const key = keyOf(card);
              if (restore && next.has(key)) continue;
              next.set(key, { ...next.get(key), ...card });
            }
            const nextState = { ...context.state, cards: [...next.values()] };
            if (restore) {
              const attempts = new Map(
                restore.attempts.map((item) => [item.id, item]),
              );
              for (const item of nextState.attempts ?? [])
                attempts.set(item.id, item);
              nextState.attempts = [...attempts.values()];
              nextState.ratings = { ...restore.ratings, ...nextState.ratings };
              nextState.settings ??= restore.settings;
            }
            if (await save(nextState)) {
              if (isCurrent()) go();
            } else commit.disabled = false;
          };
        } catch (error) {
          if (isCurrent()) confirmation.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      };
      return;
    }

    if (screen === "learn" && context.session) {
      const session = context.session;
      const card = session.queue[session.index];
      if (!card) {
        app.innerHTML =
          heading +
          `<section class="card"><h2>学習結果</h2><p>覚えた ${session.totals[2]} · 微妙 ${session.totals[1]} · 覚えていない ${session.totals[0]}</p>${back}</section>`;
        context.session = null;
        return;
      }
      const { revealed } = session;
      app.innerHTML = `<div class="learning card-learning"><h1>カード学習</h1>
        <p class="muted">${subject.decks[card.deck]} · ${session.index + 1} / ${session.queue.length} 問</p>
        <section class="swipe-card learning-card" aria-label="学習カード">
          <div class="card-question"><p class="prompt">${esc(card.question)}</p></div>
          <div class="card-answer" aria-live="polite">${revealed ? `<p>${esc(card.answer)}</p>` : '<p class="muted">タップして答えを表示</p>'}</div>
        </section>
        ${revealed ? '<div class="row card-ratings"><button data-subject-rating="0">← 覚えていない</button><button data-subject-rating="1">微妙</button><button class="primary" data-subject-rating="2">覚えた →</button></div>' : '<button id="subject-flip" class="primary">カードをめくる</button>'}
        <div class="row subject-card-actions">${back}<button id="subject-finish" type="button">学習を終える</button></div></div>`;
      find("#subject-finish").onclick = () => {
        if (context.busy) return;
        session.index = session.queue.length;
        void render(id, screen);
      };
      if (!revealed) {
        const reveal = () => {
          if (!isCurrent() || session.revealed || context.busy) return;
          session.revealed = true;
          void render(id, screen);
          find('[data-subject-rating="2"]')?.focus({ preventScroll: true });
        };
        find("#subject-flip").onclick = reveal;
        bindCardTap(find(".card-learning"), reveal);
        return;
      }
      const buttons = app.querySelectorAll("[data-subject-rating]");
      async function rate(rating) {
        if (!isCurrent() || context.busy) return;
        buttons.forEach((button) => {
          button.disabled = true;
        });
        const ratings = { ...context.state.ratings, [keyOf(card)]: rating };
        const next = { ...context.state, ratings };
        if (isHistory)
          next.attempts = [
            ...(next.attempts ?? []),
            {
              id: crypto.randomUUID(),
              number: card.number,
              rating,
              at: Date.now(),
            },
          ];
        if (await save(next)) {
          session.totals[rating]++;
          session.index++;
          session.revealed = false;
          if (location.hash === hash) {
            void render(id, screen);
            find("#subject-flip")?.focus({ preventScroll: true });
          }
        } else
          buttons.forEach((button) => {
            button.disabled = false;
          });
      }
      buttons.forEach((button) => {
        button.onclick = () => void rate(Number(button.dataset.subjectRating));
      });
      bindCardSwipe(find(".swipe-card"), () => !context.busy, rate);
      return;
    }

    const learned = queue.filter(
      (card) => state.ratings[keyOf(card)] === 2,
    ).length;
    const goal = isHistory ? historySettings(state).goal : 0;
    const today = isHistory
      ? (state.attempts ?? []).filter((entry) => day(entry.at) === day()).length
      : 0;
    app.innerHTML =
      heading +
      `<section class="card subject-home">
      ${subject.detail ? `<p>${subject.detail}</p>` : ""}
      ${isHistory ? `<h2>今日の学習</h2><p>${today} / ${goal} 問</p><progress aria-label="今日の学習" value="${today}" max="${goal}"></progress>` : ""}
      ${
        id === "ja"
          ? `<label>学習範囲<select id="subject-deck"><option value="all">すべて</option>${Object.entries(
              subject.decks,
            )
              .map(
                ([value, label]) =>
                  `<option value="${value}">${label}</option>`,
              )
              .join("")}</select></label>`
          : ""
      }
      <p>${queue.length}枚 · 覚えた ${learned}枚</p>
      ${
        context.session
          ? `<a class="button primary" href="${base}/learn">途中の学習を再開</a>`
          : `<button id="subject-start" type="button" ${!queue.length || context.busy ? "disabled" : ""} class="primary">カード学習を開始</button>`
      }
      <a class="button" href="${base}/data">JSONを取り込む</a>
      ${isHistory ? `<a class="button" href="${base}/setup">範囲・出題設定</a>` : ""}
    </section>`;
    const deck = find("#subject-deck");
    if (deck) {
      deck.value = context.deck;
      deck.onchange = () => {
        context.deck = deck.value;
        void render(id);
      };
    }
    const startButton = find("#subject-start");
    if (startButton) startButton.onclick = start;
  }

  return {
    render,
    saving: () => [...contexts.values()].some(({ busy }) => busy),
  };
}

function downloadTemplate(id) {
  const card = { number: 1, question: "問題を入力", answer: "答えを入力" };
  if (id === "ja") card.deck = "modern";
  if (id === "history") card.category = "event";
  const template = {
    format: "subject-cards",
    version: 1,
    subject: id,
    cards: [card],
  };
  downloadJSON(`${id}-cards.json`, template);
}

function downloadJSON(filename, data) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
