import { day, shuffle } from "./core.js";

const base = "#subject/history";
const ratingLabels = ["覚えていない", "微妙", "覚えた"];
const defaults = {
  goal: 10,
  order: "number",
  filter: "all",
  from: 0,
  to: 0,
  count: 0,
};
export const historySettings = (state) => ({ ...defaults, ...state.settings });
const cardKey = (number) => `general:${number}`;

export function historyQueue(state) {
  const { from, to, order, filter, count } = historySettings(state);
  const cards = state.cards.filter(({ number }) => {
    if ((from && number < from) || (to && number > to)) return false;
    const rating = state.ratings[cardKey(number)];
    if (filter === "weak") return rating === 0 || rating === 1;
    if (filter === "new") return rating === undefined;
    return true;
  });
  const ordered =
    order === "random"
      ? shuffle(cards)
      : cards.sort((a, b) => a.number - b.number);
  return count ? ordered.slice(0, count) : ordered;
}

export function readHistoryBackup(raw, cards) {
  const invalid = () =>
    Error("歴史総合のバックアップの記録・設定を確認してください。");
  if (
    !raw.ratings ||
    typeof raw.ratings !== "object" ||
    Array.isArray(raw.ratings) ||
    !Array.isArray(raw.attempts) ||
    !raw.settings ||
    typeof raw.settings !== "object" ||
    Array.isArray(raw.settings)
  )
    throw invalid();
  const numbers = new Set(cards.map(({ number }) => number));
  const keys = new Set(cards.map(({ number }) => cardKey(number)));
  const isRating = (rating) =>
    Number.isInteger(rating) && rating >= 0 && rating < ratingLabels.length;
  const ratings = {};
  for (const [key, rating] of Object.entries(raw.ratings)) {
    if (!keys.has(key) || !isRating(rating)) throw invalid();
    ratings[key] = rating;
  }
  const ids = new Set();
  const attempts = raw.attempts.map((item) => {
    const { id, number, rating, at } = item || {};
    if (
      typeof id !== "string" ||
      !/^[0-9a-f-]{36}$/.test(id) ||
      ids.has(id) ||
      !numbers.has(number) ||
      !isRating(rating) ||
      !Number.isSafeInteger(at) ||
      at <= 0 ||
      at > 8640000000000000
    )
      throw invalid();
    ids.add(id);
    return { id, number, rating, at };
  });
  return { ratings, attempts, settings: readSettings(raw.settings) };
}

function readSettings(raw) {
  const { goal, order, filter, from, to, count } = raw;
  if (
    !Number.isSafeInteger(goal) ||
    goal < 1 ||
    goal > 1000 ||
    !["number", "random"].includes(order) ||
    !["all", "weak", "new"].includes(filter) ||
    ![from, to, count].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    count > 10000 ||
    (from && to && from > to)
  ) {
    throw Error("出題範囲・問題数・1日の目標を確認してください。");
  }
  return { goal, order, filter, from, to, count };
}

const tone = ["#bf6f57", "#ba8419", "#288865"];
const normalize = (value) => value.normalize("NFKC").trim().toLowerCase();
const control = (name, label, value, max = "", placeholder = "", min = 1) =>
  `<label>${label}<input name="${name}" type="number" inputmode="numeric" min="${min}" ${max ? `max="${max}"` : ""} value="${value || ""}" placeholder="${placeholder}"></label>`;

export function renderHistoryScreen(
  screen,
  {
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
  },
) {
  const list = state.cards;
  const select = (selector) => app.querySelector(selector);
  const settings = historySettings(state);
  const attempts = state.attempts ?? [];

  if (screen === "search") {
    app.innerHTML = `<h1>検索</h1><section class="card">
      <label>番号・問題・答え<input id="history-search" type="search" value="${esc(context.query ?? "")}"></label>
      <p id="history-matches" role="status"></p><div id="history-list"></div>
      <div class="row between" id="history-pages" hidden><button id="history-prev" type="button">前へ</button><span id="history-page"></span><button id="history-next" type="button">次へ</button></div>
    </section>`;
    const input = select("#history-search");
    let index = 0;
    const pageSize = 40;
    function update() {
      const query = normalize(input.value);
      const matches = list
        .filter(
          ({ number, question, answer }) =>
            String(number).includes(query) ||
            normalize(question).includes(query) ||
            normalize(answer).includes(query),
        )
        .sort((a, b) => a.number - b.number);
      const pages = Math.ceil(matches.length / pageSize);
      select("#history-matches").textContent = `${matches.length} 件`;
      select("#history-pages").hidden = pages <= 1;
      select("#history-prev").disabled = index <= 0;
      select("#history-next").disabled = index >= pages - 1;
      select("#history-page").textContent = `${index + 1} / ${pages}`;
      select("#history-list").innerHTML =
        matches
          .slice(index * pageSize, (index + 1) * pageSize)
          .map(
            ({ number, question, answer }) =>
              `<a class="list-item history-item" href="${base}/detail/${number}"><span class="item-number">#${number}</span><span class="item-body"><span class="item-en">${esc(question)}</span><span class="item-ja">${esc(answer)}</span></span><span aria-hidden="true">›</span></a>`,
          )
          .join("") || '<p class="muted">該当するカードはありません。</p>';
    }
    input.addEventListener("input", () => {
      context.query = input.value;
      index = 0;
      update();
    });
    select("#history-prev").onclick = () => {
      index--;
      update();
    };
    select("#history-next").onclick = () => {
      index++;
      update();
    };
    update();
    return true;
  }

  if (screen === "detail") {
    const card = list.find(({ number }) => String(number) === part);
    app.innerHTML = card
      ? `<h1>カード ${card.number}</h1><section class="card">
      <p class="prompt">${esc(card.question)}</p><p class="history-answer">${esc(card.answer)}</p>
      <p class="muted">${ratingLabels[state.ratings[cardKey(card.number)]] ?? "未学習"}</p>
      </section><a class="button" href="${base}/search">検索へ戻る</a>`
      : `<h1>カードが見つかりません</h1><a class="button" href="${base}/search">検索へ戻る</a>`;
    return true;
  }

  if (screen === "progress") {
    const days = new Map();
    for (const attempt of attempts) {
      const date = day(attempt.at);
      days.set(date, (days.get(date) ?? 0) + 1);
    }
    const week = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));
      const label = day(date);
      return { label, count: days.get(label) ?? 0 };
    });
    const max = Math.max(settings.goal, ...week.map(({ count }) => count));
    const counts = [0, 0, 0, 0];
    for (const { number } of list)
      counts[state.ratings[cardKey(number)] ?? 3]++;
    const byNumber = new Map(list.map((card) => [card.number, card]));
    app.innerHTML = `<h1>履歴・進捗</h1>
      <section class="card"><h2>直近7日の学習量</h2>${week.map(({ label, count }) => `<div class="chart-row"><span>${label.slice(5)}</span><div class="bar" aria-hidden="true"><span style="width:${(count / max) * 100}%;background:#ba8419"></span></div><span>${count} 問</span></div>`).join("")}</section>
      <section class="card"><h2>習得状況</h2><div class="bar" aria-hidden="true">${counts.map((count, i) => `<span style="width:${(count / (list.length || 1)) * 100}%;background:${tone[i] ?? "#a59b8b"}"></span>`).join("")}</div>
      <ul class="chart-legend">${[...ratingLabels, "未学習"].map((label, i) => `<li>${label}<strong>${counts[i]}</strong></li>`).join("")}</ul></section>
      <section class="card"><h2>最近の学習履歴</h2>${
        [...attempts]
          .sort((a, b) => b.at - a.at)
          .slice(0, 50)
          .map(
            (attempt) =>
              `<p><a class="history-link" href="${base}/detail/${attempt.number}">${esc(byNumber.get(attempt.number)?.question ?? `カード ${attempt.number}`)}</a> · ${ratingLabels[attempt.rating]}<br><small>${new Date(attempt.at).toLocaleString("ja-JP")}</small></p>`,
          )
          .join("") || '<p class="muted">学習履歴はまだありません。</p>'
      }</section>`;
    return true;
  }

  if (screen === "settings" || screen === "setup") {
    const setup = screen === "setup";
    const fields = setup
      ? `<div class="grid">
      ${control("from", "開始番号", settings.from, "", "最初から")}
      ${control("to", "終了番号", settings.to, "", "最後まで")}
      <label>絞り込み<select name="filter"><option value="all">すべて</option><option value="weak">苦手</option><option value="new">未学習</option></select></label>
      <label>出題順<select name="order"><option value="number">番号順</option><option value="random">ランダム</option></select></label>
      ${control("count", "問題数", settings.count, 10000, "すべて")}
    </div>`
      : control("goal", "1日の学習目標（回答数）", settings.goal, 1000);
    app.innerHTML = `<h1>${setup ? "学習設定" : "設定"}</h1>${setup ? "" : versionCard()}<form class="card" id="history-settings">
      ${fields}<div class="row"><button class="primary" type="submit">${setup ? "学習を開始" : "設定を保存"}</button>
      ${setup ? '<button id="history-save-range" type="submit">範囲・出題設定を保存</button>' : `<a class="button" href="${base}/setup">範囲・出題設定</a>`}</div>
      ${setup && context.session ? `<a class="button" href="${base}/learn">途中の学習を再開</a>` : ""}
    </form>`;
    const form = select("#history-settings");
    if (setup) {
      form.elements.filter.value = settings.filter;
      form.elements.order.value = settings.order;
    }
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (context.busy) return;
      const begin = setup && event.submitter?.id !== "history-save-range";
      if (begin && context.session) {
        notify("途中の学習を再開し、終了してから新しく始めてください。");
        return;
      }
      try {
        const values = Object.fromEntries(new FormData(form));
        for (const key of ["goal", "from", "to", "count"])
          if (Object.hasOwn(values, key)) values[key] = Number(values[key]);
        const next = {
          ...context.state,
          settings: readSettings({
            ...historySettings(context.state),
            ...values,
          }),
        };
        if (begin && !historyQueue(next).length) {
          notify("この条件で出題できるカードがありません。");
          return;
        }
        if (!(await save(next)) || !isCurrent()) return;
        if (begin) start();
        else notify("設定を保存しました。", "success");
      } catch (error) {
        notify(error.message);
      }
    };
    return true;
  }
  return false;
}
