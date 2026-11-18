import "./style.css";
import { sections, questions } from "../questions/bank";
import { answer, explain, score, type Player } from "../game/session";
import {
  demoCode,
  join,
  publish,
  readRoom,
  update,
  type Room,
  type Status,
} from "../game/local";
import { paintLandscape } from "./landscape";
import { icon } from "./art";

const root = document.querySelector<HTMLDivElement>("#app")!;
const params = new URLSearchParams(location.search);
const initialCode = (params.get("room") ?? "").toUpperCase();
let code = /^[A-Z0-9]{6}$/.test(initialCode) ? initialCode : demoCode;
const teacher = params.get("view") === "teacher";
function identity(target: string) {
  try {
    return (
      sessionStorage.getItem("quest.tab." + target) ??
      (params.get("guest") === "1"
        ? ""
        : localStorage.getItem("quest.identity." + target)) ??
      ""
    );
  } catch {
    return "";
  }
}
let activeId = identity(code);
if (activeId && !teacher) {
  try {
    sessionStorage.setItem("quest.tab." + code, activeId);
  } catch {
    /* Storage access is reported by render. */
  }
}
let showRanks = false;
let message = "";
let selected = -1;
let busy = false;
const symbols = ["mountain", "bowl", "tree", "scroll"];
const statusLabels: Record<Status, string> = {
  lobby: "等待開始",
  running: "闖關中",
  paused: "已暫停",
  ended: "已結束",
};
const html = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const button = (action: string, label: string, kind = "primary") =>
  '<button type="button" class="' +
  kind +
  '" data-action="' +
  action +
  '">' +
  label +
  "</button>";
function url(view: string, target = code) {
  const u = new URL(location.href);
  u.search = new URLSearchParams({ room: target, view }).toString();
  return u.href;
}
const teacherLink = () =>
  '<a class="secondary" href="' +
  html(url("teacher")) +
  '" target="_blank" rel="noopener">在新分頁開啟老師控制台 ↗</a>';
function cover() {
  return `<article class="cover"><div class="cover-copy"><div class="edition"><span class="line"></span> 國三國文・冒險手冊</div><h1>國文段考<span>生存戰<span class="seal">命運<br>大富翁</span></span></h1></div><canvas aria-hidden="true"></canvas><div class="cover-foot"><span>✦ 四大單元</span><b>◆</b><span>40 道試題</span><b>◆</b><span>限額 30 人</span></div></article>`;
}
function joinPage() {
  return `<div class="landing">${cover()}<section class="join panel"><div class="mini-icon">${icon("flag")}</div><h2>加入教室</h2><p class="muted">輸入房間碼與暱稱，領取你的冒險手冊。</p><form id="join"><label for="code">房間碼</label><input id="code" name="code" required maxlength="6" pattern="[A-Za-z0-9]{6}" value="${html(code)}" autocapitalize="characters" spellcheck="false"><label for="nick">玩家暱稱</label><input id="nick" name="nick" required placeholder="取個 2–12 字的暱稱" autocomplete="off"><p class="error" role="alert">${html(message)}</p><button class="primary full" type="submit">加入教室 <span>→</span></button></form><p class="local-note"><i></i> 本機示範房間 <strong>${demoCode}</strong></p></section></div><section class="units"><h2>本次闖關單元</h2><div class="unit-grid">${sections.map((s, i) => `<div class="unit u${i}"><span class="unit-art">${icon(symbols[i]!)}</span><div><small>單元 0${i + 1} · 10 題</small><strong>${html(s.replace("（課名待核）", "").replace("語文天地一：", ""))}</strong></div></div>`).join("")}</div><p class="footnote">題庫待老師校對，〈以粥養身〉課名待核。</p></section>`;
}
function ranks(room: Room) {
  let last = -1,
    rank = 0;
  return `<section class="panel"><div class="section-head"><h2>全班排行榜</h2>${icon("trophy")}</div><p class="muted">老師控制台開啟時，每 10 秒檢查一次。${room.updated ? "上次更新 " + new Date(room.updated).toLocaleTimeString("zh-TW") : "尚無快照。"}</p>${
    room.entries.length
      ? '<ol class="rank-list">' +
        room.entries
          .map((e, i) => {
            if (e.score !== last) {
              rank = i + 1;
              last = e.score;
            }
            return (
              "<li><b>" +
              rank +
              "</b><span>" +
              html(e.nickname) +
              "</span><strong>" +
              e.score +
              " 分</strong></li>"
            );
          })
          .join("") +
        "</ol>"
      : '<p class="empty">等待老師發布第一份玩家排名。</p>'
  }</section>`;
}
function teacherPage(room: Room) {
  const statuses: Partial<Record<Status, [string, string]>> = {
    lobby: ["running", "開始闖關"],
    running: ["paused", "暫停作答"],
    paused: ["running", "恢復作答"],
  };
  const next = statuses[room.status];
  return `<div class="section-head"><div><p class="eyebrow">本機教室管理</p><h1>老師控制台</h1></div><span class="tag">${statusLabels[room.status]}</span></div><div class="dashboard"><section class="panel"><h2>教室狀態</h2><p class="muted">同一瀏覽器的分頁可共同使用此房間。</p><div class="stats"><div><small>房間碼</small><strong>${room.code}</strong></div><div><small>已加入</small><strong>${room.players.length} / 30</strong></div></div><div class="actions">${next ? button(next[0], next[1]) : button("new", "建立新示範房間")}${room.status !== "ended" ? button("end", "結束活動", "secondary") : ""}<a class="text-link" href="${html(url("student"))}">回學生畫面 →</a>${room.status === "lobby" ? '<a class="text-link" target="_blank" rel="noopener" href="' + html(url("student") + "&guest=1") + '">新增示範玩家 ↗</a>' : ""}</div></section>${ranks(room)}</div><section class="panel"><h2>玩家進度</h2>${room.players.length ? '<ul class="rank-list">' + room.players.map((p) => "<li><span>" + html(p.nickname) + "</span><strong>" + Object.keys(p.answers).length + " / 40 題</strong><small>" + (p.finishedAt ? "已完成" : "進行中") + "</small></li>").join("") + "</ul>" : '<p class="empty">還沒有玩家。先從學生畫面加入，再由老師開始。</p>'}</section>`;
}
function summary(p: Player) {
  const entries = Object.entries(p.answers),
    wrong = entries.filter(([, a]) => !a.correct);
  return `<section class="panel result"><div class="mini-icon">${icon("trophy")}</div><h2>冒險結算</h2><div class="stats"><div><small>最終得分</small><strong>${score(p)}</strong></div><div><small>完成題數</small><strong>${entries.length} / 40</strong></div><div><small>答對</small><strong>${entries.length - wrong.length} 題</strong></div></div>${wrong.some(([, a]) => !a.viewed) ? "<p>活動已結束，仍可閱讀詳解。結束後閱讀不再加分。</p>" : ""}<h3>錯題回顧</h3>${
    wrong.length
      ? wrong
          .map(([id, a]) => {
            const q = questions.get(id)!;
            return `<details><summary>${html(q.stem)}</summary><p>你的答案：${html(q.choices[p.choices[id]![a.selected]!]!)}</p><p><b>正解：${html(q.choices[q.correctChoiceIndex])}</b></p><p>${html(q.explanation)}</p></details>`;
          })
          .join("")
      : "<p>目前沒有錯題紀錄。</p>"
  }${teacherLink()}</section>`;
}
function pausedReview(p: Player) {
  const id = p.order[p.cursor];
  if (!id) return "";
  const a = p.answers[id],
    q = questions.get(id);
  if (!a || !q) return "";
  return `<div class="paused-review"><p class="eyebrow">已保存的作答</p><h3>${html(q.stem)}</h3><p>你的答案：${html(q.choices[p.choices[id]![a.selected]!]!)}</p><p><b>正解：${html(q.choices[q.correctChoiceIndex])}</b></p><details ${a.viewed ? "open" : ""}><summary>閱讀詳解</summary><p>${html(q.explanation)}</p></details>${!a.correct && !a.viewed ? '<p class="footnote">恢復作答後，可在題目下方領取詳解的 20 分。</p>' : ""}</div>`;
}
function studentPage(room: Room, p: Player) {
  const done = Object.keys(p.answers).length;
  let content = "";
  if (room.status === "ended" || p.cursor >= 40) content = summary(p);
  else if (room.status !== "running")
    content = `<section class="panel waiting"><div class="mini-icon">${icon("flag")}</div><h2>${room.status === "lobby" ? "已入座，等待老師開始" : "老師已暫停活動"}</h2><p>${room.status === "lobby" ? "老師按下「開始闖關」後，第一題就會出現。" : "進度已保存，恢復後可繼續作答。"}</p>${teacherLink()}${room.status === "paused" ? pausedReview(p) : ""}</section>`;
  else {
    const id = p.order[p.cursor]!,
      q = questions.get(id)!,
      a = p.answers[id];
    content = `<section class="panel question" data-question="${html(id)}"><p class="eyebrow">第 ${p.cursor + 1} / 40 題　·　${html(q.sectionId)}</p><h2>${html(q.stem)}</h2><div class="choices" role="radiogroup" aria-label="答案選項">${p.choices[id]!.map((original, i) => `<button type="button" class="choice ${a ? (original === q.correctChoiceIndex ? "right" : a.selected === i ? "wrong" : "") : selected === i ? "chosen" : ""}" role="radio" data-choice="${i}" aria-checked="${a ? a.selected === i : selected === i}" tabindex="${i === Math.max(0, selected) ? 0 : -1}" ${a ? "disabled" : ""}><b>${"ABCD"[i]}</b>${html(q.choices[original]!)}${a && original === q.correctChoiceIndex ? " ✓" : a?.selected === i ? " ×" : ""}</button>`).join("")}</div>${a ? `<div class="feedback"><strong>${a.correct ? "答對了！＋100 分" : "這題答錯了"}</strong>${a.viewed ? "<p>" + html(q.explanation) + "</p>" + (!a.correct ? "<small>已閱讀詳解 · ＋20 分</small>" : "") : button("explain", a.correct ? "閱讀詳解" : "閱讀詳解，領取 20 分", "secondary")}</div>${done % 3 === 0 ? '<p class="footnote">命運事件 ' + done / 3 + " 已解鎖 · 效果待老師設定，本輪不計分。</p>" : ""}${a.correct || a.viewed ? button("next", p.cursor === 39 ? "查看結算 →" : "下一題 →") : '<p class="footnote">讀完詳解即可繼續。</p>'}` : '<button type="button" class="primary" data-action="answer" ' + (selected < 0 ? "disabled" : "") + ">送出答案 →</button>"}</section>`;
  }
  return `<div class="section-head"><div><p class="eyebrow">房間 ${room.code}　／　${html(p.nickname)}</p><h1>我的冒險手冊</h1></div>${button("ranks", showRanks ? "收起排名" : "全班排名", "secondary")}</div><div class="progress"><span style="width:${(done / 40) * 100}%"></span></div><p class="progress-label">已完成 ${done} / 40 題 <b>${score(p)} 分</b></p>${showRanks ? ranks(room) : ""}${content}`;
}
function render() {
  try {
    const room = readRoom(code);
    const player = room?.players.find((p) => p.id === activeId);
    const displayed = room ?? {
      code,
      status: "lobby",
      players: [],
      entries: [],
      updated: 0,
    };
    root.innerHTML = `<header><div class="bar"><a class="brand" href="${html(url("student"))}">${icon("book")} 國文段考生存戰</a><nav aria-label="主要導覽"><a class="${!teacher ? "active" : ""}" href="${html(url("student"))}">學生入口</a><a class="${teacher ? "active" : ""}" href="${html(url("teacher"))}">老師控制台</a></nav></div></header><main><div class="crumb">教室大廳 <span>/</span> ${teacher ? "老師控制台" : player ? "冒險手冊" : "學生入口"}<strong><i></i> 本機示範</strong></div>${teacher ? teacherPage(displayed) : room && player ? studentPage(room, player) : joinPage()}${(teacher || player) && message ? '<p class="error" role="alert">' + html(message) + "</p>" : ""}</main><footer><span>${icon("book")} 國三國文・課堂練習</span><span>進度儲存在此瀏覽器</span></footer>`;
    const canvas = root.querySelector("canvas");
    if (canvas) paintLandscape(canvas);
  } catch {
    root.innerHTML =
      '<main><section class="panel"><h1>無法讀取本機進度</h1><p>請確認瀏覽器允許網站儲存資料。若此房間的存檔受損，可另開新的本機房間，保留原資料。</p>' +
      button("new", "建立新示範房間") +
      "</section></main>";
  }
}
root.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy || !(e.target instanceof HTMLFormElement)) return;
  const data = new FormData(e.target),
    entered = String(data.get("code")).trim().toUpperCase(),
    nickname = String(data.get("nick")).trim();
  busy = true;
  try {
    activeId = identity(entered);
    if (!activeId || !readRoom(entered)?.players.some((p) => p.id === activeId))
      activeId = await join(entered, nickname);
    code = entered;
    sessionStorage.setItem("quest.tab." + code, activeId);
    localStorage.setItem("quest.identity." + code, activeId);
    history.replaceState(null, "", url("student"));
    message = "";
    render();
  } catch (error) {
    message = error instanceof Error ? error.message : "無法加入房間。";
    const out = root.querySelector(".error");
    if (out) out.textContent = message;
  } finally {
    busy = false;
  }
});
root.addEventListener("keydown", (e) => {
  const target =
    e.target instanceof HTMLElement
      ? e.target.closest<HTMLButtonElement>("[data-choice]")
      : null;
  if (
    !target ||
    !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)
  )
    return;
  e.preventDefault();
  const delta = ["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : -1;
  root
    .querySelector<HTMLButtonElement>(
      '[data-choice="' +
        ((Number(target.dataset.choice) + delta + 4) % 4) +
        '"]',
    )
    ?.click();
});
root.addEventListener("click", async (e) => {
  const b = e.target instanceof Element ? e.target.closest("button") : null;
  if (!b || busy) return;
  if (b.dataset.choice !== undefined) {
    selected = Number(b.dataset.choice);
    render();
    root
      .querySelector<HTMLButtonElement>('[data-choice="' + selected + '"]')
      ?.focus();
    return;
  }
  const action = b.dataset.action;
  if (!action) return;
  if (action === "ranks") {
    showRanks = !showRanks;
    render();
    return;
  }
  if (action === "end" && !confirm("結束後無法恢復作答。確定結束本機活動？"))
    return;
  busy = true;
  try {
    if (action === "new") {
      let nextCode: string;
      do {
        nextCode = crypto
          .randomUUID()
          .replaceAll("-", "")
          .slice(0, 6)
          .toUpperCase();
      } while (readRoom(nextCode));
      await update(nextCode, () => {}, true);
      location.assign(url("teacher", nextCode));
      return;
    }
    const expectedId = b
      .closest("[data-question]")
      ?.getAttribute("data-question");
    await update(
      code,
      (room) => {
        if (teacher) {
          if (
            action === "running" &&
            (room.status === "lobby" || room.status === "paused")
          )
            room.status = "running";
          if (action === "paused" && room.status === "running")
            room.status = "paused";
          if (action === "end") room.status = "ended";
        } else {
          const p = room.players.find((p) => p.id === activeId);
          if (
            !p ||
            room.status !== "running" ||
            !expectedId ||
            p.order[p.cursor] !== expectedId
          )
            return;
          if (action === "answer") answer(p, expectedId, selected);
          if (action === "explain") explain(p, expectedId);
          const recorded = p.answers[expectedId];
          if (
            action === "next" &&
            recorded &&
            (recorded.correct || recorded.viewed)
          )
            p.cursor++;
        }
      },
      teacher && code === demoCode && action === "running",
    );
    selected = -1;
    message = "";
  } catch (error) {
    message = error instanceof Error ? error.message : "無法儲存，請重試。";
  } finally {
    busy = false;
    render();
    if (action === "next") {
      const heading = root.querySelector<HTMLElement>(
        ".question h2,.result h2",
      );
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        heading.scrollIntoView({ block: "nearest" });
      }
    }
  }
});
window.addEventListener("storage", (e) => {
  if (!e.key?.endsWith(code) || (!teacher && !activeId)) return;
  if (!busy) {
    const visible =
      root.querySelector<HTMLElement>("[data-question]")?.dataset.question;
    try {
      const player = readRoom(code)?.players.find((p) => p.id === activeId);
      if (visible !== player?.order[player.cursor]) selected = -1;
    } catch {
      selected = -1;
    }
    render();
  }
});
if (teacher) {
  const tick = async () => {
    try {
      const room = readRoom(code);
      if (room) {
        const previous = room.updated;
        await update(code, publish);
        if (previous !== readRoom(code)?.updated) render();
      }
    } catch {
      message = "無法更新本機排名。";
      render();
    }
  };
  window.setInterval(tick, 10000);
  void tick();
}
render();
