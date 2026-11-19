import { roomLabels, managementLocked, canDelete, controlButton, deletionSection, confirmRoomDeletion, preserveDetails, runningHint } from './room-controls';
import { GoogleAuthProvider, onAuthStateChanged, signInAnonymously, signInWithPopup, signOut } from 'firebase/auth';
import { Classroom, cloudError } from '../firebase/classroom';
import { createRuntime } from '../firebase/runtime';
import { rankedPlayers, restoreCursor, type CloudAnswer, type CloudPlayer, type CloudRoom, type Leaderboard, type PublicScore } from '../firebase/model';
import { questions, sections } from '../questions/bank';
import { paintLandscape } from './landscape';
import { icon } from './art';
import { remainingTime } from '../game/rewards';
import { sharePanel, mountShare } from './share';
import './rewards.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('找不到教室畫面。');
const appRoot = root;
const params = new URLSearchParams(location.search), teacher = params.get('view') === 'teacher';
const runtime = createRuntime(teacher ? 'teacher' : 'student');
let classroom: Classroom | null = null;
let rooms: CloudRoom[] = [], room: CloudRoom | null = null, player: CloudPlayer | null = null;
let answers: Record<string, CloudAnswer> = {}, roster: CloudPlayer[] = [], leaderboard: Leaderboard | null = null;
let code = (params.get('room') ?? '').toUpperCase();
let authorized = false, loading = true, busy = false, message = '', selected = -1;
let cursor: number | null = null, summaryVisible = false, showRanks = false;
let peers: PublicScore[] = [];
const viewedCorrect = new Set<string>();
let roomStops: (() => void)[] = [], identityStops: (() => void)[] = [], epoch = 0, identityEpoch = 0;
let publisher: ReturnType<typeof setInterval> | undefined;
const labels = roomLabels;
let busyAction = '';
let unavailable = '';
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const button = (action: string, label: string, kind = 'primary') => `<button type="button" class="${kind}" data-action="${action}" ${busy ? 'disabled' : ''}>${busy && busyAction === action ? (action === 'paused' ? '正在暫停…' : action === 'running' ? '正在恢復…' : action === 'ended' ? '正在結束…' : label) : label}</button>`;
function url(role: 'teacher' | 'student', target = '') {
  const u = new URL(location.href);
  u.search = new URLSearchParams({ view: role, ...(target ? { room: target } : {}) }).toString();
  return u.href;
}
function stopRoom() {
  epoch++;
  roomStops.forEach(stop => stop()); roomStops = [];
  if (publisher !== undefined) clearInterval(publisher);
  publisher = undefined;
  room = null; player = null; roster = []; peers = []; answers = {}; leaderboard = null;
  cursor = null; summaryVisible = false; viewedCorrect.clear(); selected = -1;
}
function report(error: unknown) { message = cloudError(error); render(); }
function rankings() {
  let last = -1, rank = 0;
  return `<section class="panel"><div class="section-head"><h2>全班排行榜</h2>${icon('trophy')}</div><p class="muted">老師在線時，排名有變更約每 10 秒更新。${leaderboard ? `最後更新 ${escape(leaderboard.updatedAt.toDate().toLocaleTimeString('zh-TW'))}，老師離線或關閉控制台後停止更新。` : '等待老師發布排名。'}</p>${leaderboard?.entries.length ? `<ol class="rank-list">${leaderboard.entries.map((entry, i) => {
    if (entry.score !== last) { last = entry.score; rank = i + 1; }
    return `<li><b>${rank}</b><span>${escape(entry.nickname)}</span><strong>${entry.score} 分</strong></li>`;
  }).join('')}</ol>` : '<p class="empty">尚無玩家排名。</p>'}</section>`;
}
function landing() {
  return `<div class="landing"><article class="cover"><div class="cover-copy"><div class="edition">國三國文・冒險手冊</div><h1>國文段考<span>生存戰<span class="seal">命運<br>大富翁</span></span></h1></div><canvas aria-hidden="true"></canvas><div class="cover-foot"><span>四大單元</span><span>40 道試題</span><span>30 人教室</span></div></article><section class="join panel"><h2>加入教室</h2><p class="muted">輸入老師提供的房間碼與暱稱。同一瀏覽器可接續進度。</p><form id="join"><label for="code">房間碼</label><input id="code" name="code" required maxlength="6" pattern="[A-Za-z0-9]{6}" value="${escape(code)}" autocapitalize="characters" spellcheck="false"><label for="nick">玩家暱稱</label><input id="nick" name="nick" required minlength="2" maxlength="12" placeholder="取個 2 至 12 字的暱稱" autocomplete="off"><button class="primary full" type="submit" ${busy ? 'disabled' : ''}>${busy ? '正在加入…' : '加入教室 →'}</button></form><p class="footnote">更換裝置、無痕視窗或清除網站資料後，無法找回匿名進度。</p></section></div><section class="units"><h2>本次闖關單元</h2><div class="unit-grid">${sections.map((s, i) => `<div class="unit u${i}"><span class="unit-art">${icon(['mountain', 'bowl', 'tree', 'scroll'][i] ?? 'book')}</span><strong>${escape(s)}</strong></div>`).join('')}</div><p class="footnote">題庫待老師校對，〈以粥養身〉課名待核。</p></section>`;
}
function timer(value: CloudRoom) {
  const seconds = Math.ceil(remainingTime(value) / 1000);
  return `<span class="timer" role="timer" aria-label="剩餘時間">剩餘 <span data-timer>${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}</span></span>`;
}
function teacherView() {
  const user = runtime.auth.currentUser;
  if (!user || user.isAnonymous) return `<section class="panel waiting"><h1>老師登入</h1><p>使用已授權的 Google 帳號管理房間。</p>${button('login', '使用 Google 登入')}</section>`;
  if (!authorized) return `<section class="panel"><h1>等待老師授權</h1><p>已使用 Google 帳號登入。</p><p>請將以下 email 提供給管理員，加入白名單後按「重新檢查授權」。</p><p><code>${escape(user.email ?? '')}</code></p><div class="actions">${button('reauthorize', '重新檢查授權')}${button('logout', '登出', 'secondary')}</div></section>`;
  const locked = managementLocked(room?.status);
  const modern = room?.rulesVersion === 2;
  const header = `<div class="teacher-toolbar" ${room?.status === 'running' ? 'aria-describedby="running-hint"' : ''}><h1 tabindex="-1">老師控制台</h1><div class="actions">${controlButton('new', '建立房間', busy || locked)}${button('logout', '登出', 'secondary')}</div></div>`;
  const list = `<details class="teacher-management" data-disclosure="rooms-${room?.status ?? 'none'}" ${room?.status === 'running' ? '' : 'open'}><summary>我的房間</summary>${rooms.length ? `<ul class="rank-list">${rooms.map(r => `<li><span>${escape(r.code)} · ${labels[r.status]}</span><button type="button" class="secondary" data-room="${escape(r.id)}" ${busy || locked || room?.id === r.id ? 'disabled' : ''}>${room?.id === r.id ? '目前房間' : '進入房間'}</button></li>`).join('')}</ul>` : '<p>尚無房間，請先建立。</p>'}<p class="teacher-email">${escape(user.email ?? '')}</p></details>`;
  if (!room) return header + list;
  const current = room;
  const deleting = current.status === 'deleting';
  const main = `<section class="panel room-core"><div class="room-summary"><h2 tabindex="-1">房間 ${escape(current.code)}</h2><span class="room-status tag ${current.status}">${labels[current.status]}</span></div>${deleting ? '<p role="status">房間已停止加入與遊戲。可繼續刪除剩餘紀錄。</p>' : `<div class="stats"><div><small>已加入</small><strong>${roster.length} / 30</strong></div><div><small>已完成</small><strong>${roster.filter(p => p.finishedAt !== null).length}</strong></div></div>${modern ? timer(current) : '<p>舊規則房間，僅供回顧。請建立新房間。</p>'}<div class="actions">${modern && (current.status === 'lobby' || (current.status === 'paused' && remainingTime(current) > 0)) ? button('running', current.status === 'lobby' ? '開始闖關' : '恢復作答') : ''}${modern && current.status === 'running' ? button('paused', '暫停作答') : ''}${modern && ['lobby', 'running', 'paused'].includes(current.status) ? button('ended', '結束活動', 'danger') : ''}</div>`}${current.status === 'running' ? `<p class="management-hint" id="running-hint">${runningHint}</p>` : ''}</section>`;
  const management = `<details class="teacher-management" data-disclosure="management-${current.id}-${current.status}" ${current.status !== 'running' ? 'open' : ''}><summary>房間管理</summary>${deleting ? '' : `${sharePanel(url('student', current.code))}${modern ? `<div class="duration-control"><label for="duration">活動時間（1–60 分鐘）</label><input id="duration" type="number" min="1" max="60" value="${current.durationMinutes}" ${busy || current.status !== 'lobby' ? 'disabled' : ''}>${controlButton('duration', '設定時間', busy || current.status !== 'lobby')}</div>` : ''}${current.status === 'ended' && modern ? button('archived', '封存房間', 'secondary') : ''}`}${deletionSection(current.code, current.status, busy || !canDelete(current.status, !modern))}</details>`;
  const progress = deleting ? '' : `<section class="panel"><h2>玩家進度</h2>${roster.length ? `<ul class="rank-list">${roster.map(p => `<li><span>${escape(p.nickname)}</span><strong>${p.completedCount} / 40 題</strong><small>${p.totalScore} 分</small></li>`).join('')}</ul>` : '<p class="empty">還沒有玩家。</p>'}</section><details class="teacher-ranks" data-disclosure="ranks-${current.id}"><summary>全班排行榜</summary>${rankings()}</details>`;
  return header + main + progress + management + list;
}
function review(p: CloudPlayer) {
  const wrong = p.order.filter(id => answers[id] && !answers[id]?.correct);
  return `<section class="panel result"><h2>冒險結算</h2><div class="stats"><div><small>總分</small><strong>${p.totalScore} 分</strong></div><div><small>完成題數</small><strong>${p.completedCount} / 40</strong></div></div><h3>錯題回顧</h3>${wrong.length ? wrong.map(id => {
    const q = questions.get(id)!;
    return `<details><summary>${escape(q.stem)}</summary><p>正解：${escape(q.choices[q.correctChoiceIndex])}</p><p>${escape(q.explanation)}</p></details>`;
  }).join('') : '<p>目前沒有錯題。</p>'}<p class="footnote">閱讀詳解不加分。全班時間結束前，分數仍可能被寶箱效果改變。</p></section>`;
}
function chestPanel(p: CloudPlayer, id: string) {
  const chest = answers[id]?.chest;
  if (!chest) return `<div class="chest-grid" aria-label="選擇命運寶箱">${[0, 1, 2].map(box => `<button type="button" class="chest-box" data-action="open-${box}" ${busy ? 'disabled' : ''}><span class="chest-pixel" aria-hidden="true"></span>寶箱 ${box + 1}</button>`).join('')}</div>`;
  const effect = chest.outcome, needsTarget = effect.kind === 'steal' || effect.kind === 'swap';
  const others = peers.filter(peer => peer.id !== p.id);
  const label = effect.kind === 'gain' ? `加分 ${effect.amount} 分` : effect.kind === 'loss' ? `扣分 ${effect.amount} 分` : effect.kind === 'steal' ? '搶奪 100 分' : '互換分數';
  return `<div class="chest-result" role="status"><strong>寶箱 ${chest.box + 1}：${label}</strong>${chest.settled ? `<p>${chest.fallback ? '目前沒有其他玩家，改獲得 20 分。' : '已結算'} 本次 ${chest.delta >= 0 ? '+' : ''}${chest.delta} 分</p>` : needsTarget && room && room.playerCount > 1 ? `<p>選擇對象，確認後立即結算。</p><div class="target-list">${others.map(peer => button('target-' + peer.id, `${escape(peer.nickname)} · ${peer.score} 分`, 'secondary')).join('')}</div>${others.length ? '' : '<p>正在讀取同房玩家…</p>'}` : `<p>${needsTarget ? '目前只有你一人，改獲得 20 分。' : '確認後結算本次分數。'}</p>${button('claim', '確認領取')}`}</div>${chest.settled ? button('next', cursor === 39 ? '查看結算 →' : '下一題 →') : ''}`;
}
function studentView() {
  if (!room) return unavailable ? `<section class="panel"><h1>房間無法繼續使用</h1><p role="status">${escape(unavailable)}</p><a class="secondary" href="${escape(url('student'))}">返回學生入口</a></section>` : landing();
  if (!player) return '<section class="panel"><p role="status">正在讀取已保存的進度…</p></section>';
  const p = player;
  let content: string;
  const id = p.order[cursor ?? 0], q = id ? questions.get(id) : undefined, a = id ? answers[id] : undefined;
  if (room.rulesVersion !== 2 || room.status === 'ended' || room.status === 'archived' || summaryVisible || (room.status === 'running' && remainingTime(room) <= 0)) content = `${room.rulesVersion !== 2 ? '<p>這是舊規則房間，僅供回顧；請老師建立新房間。</p>' : ''}${review(p)}`;
  else if (room.status === 'lobby') content = '<section class="panel waiting"><h2>已入座，等待老師開始</h2><p>老師開始活動後即可作答。</p></section>';
  else if (room.status === 'paused') content = `<section class="panel waiting"><h2>老師已暫停活動</h2><p>進度已保存，恢復後可繼續作答。</p></section>${a && q ? `<section class="panel"><h3>${escape(q.stem)}</h3><details><summary>閱讀詳解（不加分）</summary><p>${escape(q.explanation)}</p></details></section>` : ''}`;
  else if (id && q) {
    const frozen = !a?.correct && (p.cooldownUntil ?? 0) > Date.now();
    content = `<section class="panel question" data-question="${escape(id)}"><p class="eyebrow">第 ${(cursor ?? 0) + 1} / 40 題 · ${escape(q.sectionId)}</p><h2>${escape(q.stem)}</h2><div class="choices" role="radiogroup" aria-label="答案選項">${p.choices[id]!.map((original, i) => `<button type="button" class="choice ${a ? original === q.correctChoiceIndex ? 'right' : a.selected === i ? 'wrong' : '' : selected === i ? 'chosen' : ''}" role="radio" aria-checked="${a ? a.selected === i : selected === i}" tabindex="${i === Math.max(0, selected) ? 0 : -1}" data-choice="${i}" ${a || busy ? 'disabled' : ''}><b>${'ABCD'[i]}</b>${escape(q.choices[original] ?? '')}</button>`).join('')}</div>${a ? `<div class="feedback"><strong>${a.correct ? '答對了！選一個命運寶箱' : '這題答錯了'}</strong><details ${viewedCorrect.has(id) ? 'open' : ''}><summary>閱讀詳解（不加分）</summary><p>${escape(q.explanation)}</p></details></div>${a.correct ? chestPanel(p, id) : frozen ? `<p class="freeze" role="status">冷凍 <span data-freeze>${Math.ceil(((p.cooldownUntil ?? 0) - Date.now()) / 1000)}</span> 秒，看看詳解再出發。</p>` : button('next', cursor === 39 ? '查看結算 →' : '下一題 →')}` : `<button type="button" class="primary" data-action="answer" ${busy || selected < 0 ? 'disabled' : ''}>送出答案</button>`}</section>`;
  } else content = review(p);
  return `<div class="section-head"><div><p class="eyebrow">房間 ${escape(room.code)} ／ ${escape(p.nickname)}</p><h1>我的冒險手冊</h1></div>${button('ranks', showRanks ? '收起排名' : '全班排名', 'secondary')}</div>${room.rulesVersion === 2 ? timer(room) : ''}<div class="progress"><span style="width:${p.completedCount / 40 * 100}%"></span></div><p class="progress-label">已保存 ${p.completedCount} / 40 題 <b>${p.totalScore} 分</b></p>${showRanks ? rankings() : ''}${content}`;
}
function render() {
  const restoreDetails = preserveDetails(appRoot);
  const focused = document.activeElement;
  const focusedChoice = focused instanceof HTMLButtonElement ? focused.dataset.choice : undefined;
  const focusedAction = focused instanceof HTMLButtonElement ? focused.dataset.action : undefined;
  const focusedQuestion = focused?.closest('[data-question]')?.getAttribute('data-question');
  // Keep an in-progress join form intact when only connection/error status changes.
  const currentCode = appRoot.querySelector<HTMLInputElement>('#code')?.value;
  const nickname = appRoot.querySelector<HTMLInputElement>('#nick')?.value;
  const duration = appRoot.querySelector<HTMLInputElement>('#duration')?.value;
  const shareOpen = appRoot.querySelector<HTMLDetailsElement>('.share-qr-details')?.open;
  const explanationOpen = appRoot.querySelector<HTMLDetailsElement>('.feedback details')?.open;
  appRoot.innerHTML = `<header><div class="bar"><a class="brand" href="${escape(url('student'))}">${icon('book')} 國文段考生存戰</a><nav aria-label="主要導覽"><a href="${escape(url('student', code))}">學生入口</a><a href="${escape(url('teacher'))}">老師控制台</a></nav></div></header><main><div class="crumb">房間大廳 / ${teacher ? '老師控制台' : '學生入口'}<strong>${runtime.emulators ? '本機模擬器' : '雲端房間'}</strong></div><p class="error" role="alert">${escape(message)}</p>${navigator.onLine ? '' : '<p class="error" role="status">目前離線，暫停送出。請恢復連線後再試。</p>'}${busy ? `<p role="status">${busyAction === 'delete' ? '正在刪除…' : '正在處理，等待伺服器確認…'}</p>` : ''}${loading ? '<section class="panel"><p role="status">正在連線房間…</p></section>' : teacher ? teacherView() : studentView()}</main><footer><span>國三國文・課堂練習</span><a href="?demo=1">本機示範</a></footer>`;
  restoreDetails();
  if (currentCode !== undefined) { const input = appRoot.querySelector<HTMLInputElement>('#code'); if (input) input.value = currentCode; }
  if (nickname !== undefined) { const input = appRoot.querySelector<HTMLInputElement>('#nick'); if (input) input.value = nickname; }
  if (duration !== undefined && focused?.id === 'duration') { const input = appRoot.querySelector<HTMLInputElement>('#duration'); if (input) { input.value = duration; input.focus(); } }
  if (shareOpen) { const details = appRoot.querySelector<HTMLDetailsElement>('.share-qr-details'); if (details) details.open = true; }
  if (explanationOpen && focusedQuestion === appRoot.querySelector('[data-question]')?.getAttribute('data-question')) { const details = appRoot.querySelector<HTMLDetailsElement>('.feedback details'); if (details) details.open = true; }
  if (!document.querySelector('dialog[open]') && focusedAction && /^[a-z0-9-]+$/.test(focusedAction)) (appRoot.querySelector<HTMLElement>(`[data-action="${focusedAction}"]:not(:disabled)`) ?? appRoot.querySelector<HTMLElement>('.room-core [data-action]:not(:disabled),.room-core h2'))?.focus({ preventScroll: true });
  const canvas = appRoot.querySelector('canvas'); if (canvas) paintLandscape(canvas);
  if (focusedChoice && /^[0-3]$/.test(focusedChoice)
    && focusedQuestion === appRoot.querySelector('[data-question]')?.getAttribute('data-question')) {
    appRoot.querySelector<HTMLButtonElement>(`[data-choice="${focusedChoice}"]:not(:disabled)`)?.focus({ preventScroll: true });
  }
}
function openRoom(target: CloudRoom) {
  stopRoom();
  room = target; code = target.code;
  history.replaceState(null, '', url(teacher ? 'teacher' : 'student', code));
  const current = classroom;
  if (!current) return;
  const generation = epoch;
  const active = () => generation === epoch;
  const unavailableRoom = () => {
    stopRoom(); unavailable = '房間正在刪除或已刪除，無法繼續活動。'; message = '';
    if (teacher) { code = ''; history.replaceState(null, '', url('teacher')); }
    render();
  };
  const failure = (e: unknown) => {
    if (!active()) return;
    void current.isRoomRetired(target.id, target.code).then(retired => {
      if (!active()) return;
      if (retired) { if (teacher) { stopRoom(); room = { ...target, status: 'deleting' }; render(); } else unavailableRoom(); }
      else report(e);
    }).catch(() => { if (active()) report(e); });
  };
  if (target.status === 'deleting') { render(); return; }
  roomStops.push(current.watchRoom(target.id, value => {
    if (!active()) return;
    if (!value) { unavailableRoom(); return; }
    if (value.status === 'deleting') {
      if (teacher) { stopRoom(); room = value; render(); } else unavailableRoom();
      return;
    }
    room = value; render();
  }, failure));
  if (!teacher && target.rulesVersion === 2) roomStops.push(current.watchScores(target.id, value => { if (active()) { peers = value; render(); } }, failure));
  roomStops.push(current.watchLeaderboard(target.id, value => { if (active()) { leaderboard = value; render(); } }, failure));
  if (teacher) {
    let latest: CloudPlayer[] | null = null, published = '', lastPublished = Date.now(), publishing = false;
    roomStops.push(current.watchPlayers(target.id, value => { if (active()) { roster = value; latest = value; render(); } }, failure));
    if (target.rulesVersion === 2) publisher = setInterval(() => {
      if (!active() || publishing || !latest || !navigator.onLine || !room) return;
      if (room.rulesVersion === 2 && room.status === 'running' && remainingTime(room) <= 0) {
        publishing = true; void current.setStatus(target.id, 'ended').catch(failure).finally(() => { publishing = false; }); return;
      }
      const signature = JSON.stringify(rankedPlayers(latest));
      if (signature === published || Date.now() - lastPublished < 10_000) return;
      publishing = true;
      const publish = room.status === 'ended' || room.status === 'archived'
        ? current.getPlayers(target.id).then(finalPlayers => current.publishLeaderboard(target.id, finalPlayers, 'final'))
        : current.publishLeaderboard(target.id, latest);
      void publish.then(accepted => {
        if (accepted) { published = signature; lastPublished = Date.now(); }
      }).catch(failure).finally(() => { publishing = false; });
    }, 1000);
  } else roomStops.push(current.watchProgress(target.id, (value, saved) => {
    if (!active()) return;
    const oldId = player?.order[cursor ?? 0];
    player = value; answers = saved;
    if (cursor === null || cursor > value.completedCount) cursor = restoreCursor(value.completedCount);
    // Another tab may have advanced farther. Recover its last committed answer.
    if (value.completedCount > cursor + 1) cursor = restoreCursor(value.completedCount);
    if (oldId !== value.order[cursor]) selected = -1;
    render();
  }, failure));
  render();
}
async function authorize() {
  const current = classroom, generation = identityEpoch;
  if (!current) return;
  const allowed = await current.isTeacher();
  if (generation !== identityEpoch) return;
  authorized = allowed;
  if (!authorized) { loading = false; render(); return; }
  identityStops.forEach(stop => stop()); identityStops = [];
  const revoked = (error: unknown) => {
    if (generation !== identityEpoch) return;
    identityStops.forEach(stop => stop()); identityStops = [];
    stopRoom(); rooms = []; authorized = false; loading = false; report(error);
  };
  identityStops.push(current.watchAuthorization(allowed => {
    if (!allowed) revoked(new Error('老師授權已撤銷，請聯絡管理員。'));
  }, revoked));
  identityStops.push(current.watchRooms((value, unreadable) => {
    if (generation !== identityEpoch) return;
    rooms = value; loading = false;
    if (unreadable) message = `${unreadable} 間房間的版本或資料無法辨識，請聯絡管理員；其他房間仍可使用。`;
    if (room?.status === 'deleting' && !rooms.some(r => r.id === room?.id)) { stopRoom(); code = ''; message = '房間已刪除。'; history.replaceState(null, '', url('teacher')); }
    if (!room && code) { const target = rooms.find(r => r.code === code); if (target) openRoom(target); }
    render();
  }, revoked));
  loading = false; render();
}
const stopAuth = onAuthStateChanged(runtime.auth, user => {
  const generation = ++identityEpoch;
  stopRoom(); identityStops.forEach(stop => stop()); identityStops = [];
  classroom = user ? new Classroom(runtime.db, user) : null;
  authorized = false; rooms = []; loading = true;
  void (async () => {
    try {
      if (teacher && user && !user.isAnonymous) await authorize();
      else if (!teacher && user?.isAnonymous && /^[A-Z0-9]{6}$/.test(code)) {
        const existing = await classroom?.resumeRoom(code);
        if (generation === identityEpoch && existing) openRoom(existing.room);
      }
    } catch (e) { if (generation === identityEpoch) message = cloudError(e); }
    finally { if (generation === identityEpoch) { loading = false; render(); } }
  })();
});
appRoot.addEventListener('submit', e => {
  if (!(e.target instanceof HTMLFormElement) || e.target.id !== 'join') return;
  e.preventDefault(); if (busy) return;
  const data = new FormData(e.target), entered = String(data.get('code')), nickname = String(data.get('nick'));
  busy = true; message = ''; render();
  void (async () => {
    try {
      if (!runtime.auth.currentUser) await signInAnonymously(runtime.auth);
      await runtime.auth.authStateReady();
      const user = runtime.auth.currentUser;
      if (!user?.isAnonymous) throw new Error('學生請使用匿名身分加入。');
      const current = new Classroom(runtime.db, user);
      const joined = await current.joinRoom(entered, nickname);
      classroom = current; openRoom(joined.room);
    } catch (e) { message = cloudError(e); }
    finally { busy = false; loading = false; render(); }
  })();
});
appRoot.addEventListener('keydown', e => {
  if (!(e.target instanceof HTMLElement) || !e.target.matches('[data-choice]') || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault(); const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
  appRoot.querySelector<HTMLButtonElement>(`[data-choice="${(Number(e.target.dataset.choice) + delta + 4) % 4}"]`)?.click();
});
appRoot.addEventListener('click', e => {
  const target = e.target instanceof Element ? e.target.closest('button') : null;
  if (!target || target.disabled || busy) return;
  if (target.dataset.choice !== undefined) {
    selected = Number(target.dataset.choice); render();
    appRoot.querySelector<HTMLButtonElement>(`[data-choice="${selected}"]`)?.focus(); return;
  }
  if (target.dataset.room && managementLocked(room?.status)) return;
  if (target.dataset.room) { const next = rooms.find(r => r.id === target.dataset.room); if (next) openRoom(next); return; }
  const action = target.dataset.action;
  if (!action) return;
  if (teacher && managementLocked(room?.status) && ['new', 'duration', 'archived'].includes(action)) return;
  if (teacher && action === 'delete' && room && canDelete(room.status, room.rulesVersion === 1)) {
    const target = room, current = classroom;
    if (!current) return;
    confirmRoomDeletion(target.code, () => !busy && room?.id === target.id && canDelete(room.status, room.rulesVersion === 1), async () => {
      busy = true; busyAction = 'delete'; message = ''; render();
      try {
        await current.beginDeletion(target.id, target.code);
        stopRoom(); room = { ...target, status: 'deleting' }; render();
        await current.deleteRoom(target.id, target.code);
        stopRoom(); code = ''; history.replaceState(null, '', url('teacher')); message = '房間已刪除。';
      } catch (error) { message = cloudError(error); }
      finally { busy = false; busyAction = ''; render(); appRoot.querySelector<HTMLElement>('[data-action=delete],h1')?.focus(); }
    });
    return;
  }
  if (action === 'ranks') { showRanks = !showRanks; render(); return; }
  if (action === 'ended' && !confirm('結束後無法恢復作答，確定結束活動？')) return;
  const durationMinutes = Number(appRoot.querySelector<HTMLInputElement>('#duration')?.value);
  const questionId = target.closest('[data-question]')?.getAttribute('data-question');
  // Capture the displayed answer before a snapshot can change UI state.
  const selectedChoice = selected;
  busy = true; busyAction = action; message = ''; render();
  void (async () => {
    try {
      if (action === 'login') await signInWithPopup(runtime.auth, new GoogleAuthProvider());
      else if (action === 'logout') await signOut(runtime.auth);
      else if (action === 'reauthorize') await authorize();
      else if (classroom) {
        if (action === 'new') openRoom(await classroom.createRoom());
        else if (room && teacher && action === 'duration') await classroom.setDuration(room.id, durationMinutes);
        else if (room && teacher && (action === 'running' || action === 'paused' || action === 'ended' || action === 'archived')) await classroom.setStatus(room.id, action);
        else if (room && player && questionId) {
          if (action === 'answer') await classroom.submitAnswer(room.id, questionId, selectedChoice);
          else if (action.startsWith('open-')) await classroom.openChest(room.id, questionId, Number(action.slice(5)));
          else if (action === 'claim' || action.startsWith('target-')) await classroom.claimChest(room.id, questionId, action === 'claim' ? null : action.slice(7));
          else if (action === 'next') {
            const answer = answers[questionId];
            if (!answer || (answer.correct ? !answer.chest?.settled : (player.cooldownUntil ?? Infinity) > Date.now())) return;
            if (cursor === 39) {
              if (!player.finishedAt) await classroom.finishPlayer(room.id);
              summaryVisible = true;
            } else cursor = (cursor ?? 0) + 1;
            selected = -1;
          }
        }
      }
    } catch (e) { message = cloudError(e); }
    finally {
      busy = false; busyAction = ''; render();
      if (action === 'next') { const heading = appRoot.querySelector<HTMLElement>('.question h2,.result h2'); if (heading) { heading.tabIndex = -1; heading.focus(); } }
    }
  })();
});
mountShare(appRoot);
const clock = setInterval(() => {
  if (!room || room.rulesVersion !== 2) return;
  const left = Math.ceil(remainingTime(room) / 1000), display = appRoot.querySelector('[data-timer]');
  if (display) display.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const freeze = appRoot.querySelector('[data-freeze]');
  if (freeze && player) {
    const seconds = Math.max(0, Math.ceil(((player.cooldownUntil ?? 0) - Date.now()) / 1000));
    if (!seconds) render(); else freeze.textContent = String(seconds);
  }
  if (!teacher && room.status === 'running' && left === 0 && !appRoot.querySelector('.result')) render();
}, 250);
window.addEventListener('online', render);
window.addEventListener('offline', render);
window.addEventListener('pagehide', () => { clearInterval(clock); stopRoom(); identityStops.forEach(stop => stop()); stopAuth(); });
render();

window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
