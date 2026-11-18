import { GoogleAuthProvider, onAuthStateChanged, signInAnonymously, signInWithPopup, signOut } from 'firebase/auth';
import { Classroom, cloudError } from '../firebase/classroom';
import { createRuntime } from '../firebase/runtime';
import { rankedPlayers, restoreCursor, type CloudAnswer, type CloudPlayer, type CloudRoom, type Leaderboard } from '../firebase/model';
import { questions, sections } from '../questions/bank';
import { paintLandscape } from './landscape';
import { icon } from './art';

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
const viewedCorrect = new Set<string>();
let roomStops: (() => void)[] = [], identityStops: (() => void)[] = [], epoch = 0, identityEpoch = 0;
let publisher: ReturnType<typeof setInterval> | undefined;
const labels = { lobby: '等待開始', running: '闖關中', paused: '已暫停', ended: '已結束', archived: '已封存' };
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const button = (action: string, label: string, kind = 'primary') => `<button type="button" class="${kind}" data-action="${action}" ${busy ? 'disabled' : ''}>${label}</button>`;
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
  room = null; player = null; roster = []; answers = {}; leaderboard = null;
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
function teacherView() {
  const user = runtime.auth.currentUser;
  if (!user || user.isAnonymous) return `<section class="panel waiting"><h1>老師登入</h1><p>使用已授權的 Google 帳號管理教室。</p>${button('login', '使用 Google 登入')}</section>`;
  if (!authorized) return `<section class="panel"><h1>等待老師授權</h1><p>已使用 Google 帳號登入。</p><p>請將以下 email 提供給管理員，加入白名單後按「重新檢查授權」。</p><p><code>${escape(user.email ?? '')}</code></p><div class="actions">${button('reauthorize', '重新檢查授權')}${button('logout', '登出', 'secondary')}</div></section>`;
  return `<div class="section-head"><div><p class="eyebrow">${escape(user.email ?? '')}</p><h1>老師控制台</h1></div><div class="actions">${button('new', '建立教室')}${button('logout', '登出', 'secondary')}</div></div><section class="panel"><h2>我的教室</h2>${rooms.length ? `<ul class="rank-list">${rooms.map(r => `<li><span>${escape(r.code)} · ${labels[r.status]}</span><button type="button" class="secondary" data-room="${escape(r.id)}" ${busy ? 'disabled' : ''}>${room?.id === r.id ? '目前教室' : '開啟教室'}</button></li>`).join('')}</ul>` : '<p>尚無教室，請先建立。</p>'}</section>${room ? `<div class="dashboard"><section class="panel"><h2>房間 ${escape(room.code)}</h2><p class="tag">${labels[room.status]}</p><div class="stats"><div><small>已加入</small><strong>${roster.length} / 30</strong></div></div>${roster.length > 30 ? '<p class="error">已超過 30 人，公開排名只顯示前 30 人，請結束並另開教室分流。</p>' : ''}<div class="share-field"><label for="share">學生加入連結</label><input id="share" readonly value="${escape(url('student', room.code))}"></div><div class="actions">${room.status === 'lobby' || room.status === 'paused' ? button('running', room.status === 'lobby' ? '開始闖關' : '恢復作答') : ''}${room.status === 'running' ? button('paused', '暫停作答') : ''}${['lobby', 'running', 'paused'].includes(room.status) ? button('ended', '結束活動', 'secondary') : ''}${room.status === 'ended' ? button('archived', '封存教室', 'secondary') : ''}</div></section>${rankings()}</div><section class="panel"><h2>玩家進度</h2><ul class="rank-list">${roster.map(p => `<li><span>${escape(p.nickname)}</span><strong>${p.completedCount} / 40 題</strong><small>${p.totalScore} 分</small></li>`).join('')}</ul></section>` : ''}`;
}
function review(p: CloudPlayer) {
  const wrong = p.order.filter(id => answers[id] && !answers[id]?.correct);
  return `<section class="panel result"><h2>冒險結算</h2><div class="stats"><div><small>總分</small><strong>${p.totalScore} 分</strong></div><div><small>完成題數</small><strong>${p.completedCount} / 40</strong></div></div><h3>錯題回顧</h3>${wrong.length ? wrong.map(id => {
    const q = questions.get(id)!;
    return `<details><summary>${escape(q.stem)}</summary><p>正解：${escape(q.choices[q.correctChoiceIndex])}</p><p>${escape(q.explanation)}</p>${room?.status === 'running' && !answers[id]?.viewed ? `<button type="button" class="secondary" data-claim="${escape(id)}" ${busy ? 'disabled' : ''}>閱讀詳解，領取 20 分</button>` : ''}</details>`;
  }).join('') : '<p>目前沒有錯題。</p>'}<p class="footnote">活動暫停或結束後仍可閱讀詳解，恢復作答後才能領分。</p></section>`;
}
function studentView() {
  if (!room) return landing();
  if (!player) return '<section class="panel"><p role="status">正在讀取已保存的進度…</p></section>';
  const p = player;
  let content: string;
  const id = p.order[cursor ?? 0], q = id ? questions.get(id) : undefined, a = id ? answers[id] : undefined;
  if (room.status === 'ended' || summaryVisible) content = review(p);
  else if (room.status === 'lobby') content = '<section class="panel waiting"><h2>已入座，等待老師開始</h2><p>老師開始活動後即可作答。</p></section>';
  else if (room.status === 'paused') content = `<section class="panel waiting"><h2>老師已暫停活動</h2><p>進度已保存，恢復後可繼續作答。</p></section>${a && q ? `<section class="panel"><h3>${escape(q.stem)}</h3><details><summary>閱讀詳解</summary><p>${escape(q.explanation)}</p></details><p>恢復作答後可領取詳解分數。</p></section>` : ''}`;
  else if (id && q) {
    const explanationVisible = a && (a.viewed || viewedCorrect.has(id));
    content = `<section class="panel question" data-question="${escape(id)}"><p class="eyebrow">第 ${(cursor ?? 0) + 1} / 40 題 · ${escape(q.sectionId)}</p><h2>${escape(q.stem)}</h2><div class="choices" role="radiogroup" aria-label="答案選項">${p.choices[id]!.map((original, i) => `<button type="button" class="choice ${a ? original === q.correctChoiceIndex ? 'right' : a.selected === i ? 'wrong' : '' : selected === i ? 'chosen' : ''}" role="radio" aria-checked="${a ? a.selected === i : selected === i}" tabindex="${i === Math.max(0, selected) ? 0 : -1}" data-choice="${i}" ${a || busy ? 'disabled' : ''}><b>${'ABCD'[i]}</b>${escape(q.choices[original] ?? '')}</button>`).join('')}</div>${a ? `<div class="feedback"><strong>${a.correct ? '答對了！＋100 分' : '這題答錯了'}</strong>${explanationVisible ? `<p>${escape(q.explanation)}</p>${!a.correct ? '<small>已閱讀詳解 · ＋20 分</small>' : ''}` : button('explain', a.correct ? '閱讀詳解' : '閱讀詳解，領取 20 分', 'secondary')}</div>${p.completedCount % 3 === 0 ? `<p class="footnote">命運事件 ${p.completedCount / 3} 已解鎖，本輪不計分。</p>` : ''}${a.correct || a.viewed ? button('next', cursor === 39 ? '查看結算 →' : '下一題 →') : '<p class="footnote">讀完詳解即可繼續。</p>'}` : `<button type="button" class="primary" data-action="answer" ${busy || selected < 0 ? 'disabled' : ''}>送出答案</button>`}</section>`;
  } else content = review(p);
  return `<div class="section-head"><div><p class="eyebrow">房間 ${escape(room.code)} ／ ${escape(p.nickname)}</p><h1>我的冒險手冊</h1></div>${button('ranks', showRanks ? '收起排名' : '全班排名', 'secondary')}</div><div class="progress"><span style="width:${p.completedCount / 40 * 100}%"></span></div><p class="progress-label">已保存 ${p.completedCount} / 40 題 <b>${p.totalScore} 分</b></p>${showRanks ? rankings() : ''}${content}`;
}
function render() {
  const focused = document.activeElement;
  const focusedChoice = focused instanceof HTMLButtonElement ? focused.dataset.choice : undefined;
  const focusedQuestion = focused?.closest('[data-question]')?.getAttribute('data-question');
  // Keep an in-progress join form intact when only connection/error status changes.
  const currentCode = appRoot.querySelector<HTMLInputElement>('#code')?.value;
  const nickname = appRoot.querySelector<HTMLInputElement>('#nick')?.value;
  appRoot.innerHTML = `<header><div class="bar"><a class="brand" href="${escape(url('student'))}">${icon('book')} 國文段考生存戰</a><nav aria-label="主要導覽"><a href="${escape(url('student', code))}">學生入口</a><a href="${escape(url('teacher'))}">老師控制台</a></nav></div></header><main><div class="crumb">教室大廳 / ${teacher ? '老師控制台' : '學生入口'}<strong>${runtime.emulators ? '本機模擬器' : '雲端教室'}</strong></div><p class="error" role="alert">${escape(message)}</p>${navigator.onLine ? '' : '<p class="error" role="status">目前離線，暫停送出。請恢復連線後再試。</p>'}${busy ? '<p role="status">正在處理，等待伺服器確認…</p>' : ''}${loading ? '<section class="panel"><p role="status">正在連線教室…</p></section>' : teacher ? teacherView() : studentView()}</main><footer><span>國三國文・課堂練習</span><a href="?demo=1">本機示範</a></footer>`;
  if (currentCode !== undefined) { const input = appRoot.querySelector<HTMLInputElement>('#code'); if (input) input.value = currentCode; }
  if (nickname !== undefined) { const input = appRoot.querySelector<HTMLInputElement>('#nick'); if (input) input.value = nickname; }
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
  const failure = (e: unknown) => { if (active()) report(e); };
  roomStops.push(current.watchRoom(target.id, value => { if (active()) { room = value; render(); } }, failure));
  roomStops.push(current.watchLeaderboard(target.id, value => { if (active()) { leaderboard = value; render(); } }, failure));
  if (teacher) {
    let latest: CloudPlayer[] | null = null, published = '', lastPublished = Date.now(), publishing = false;
    roomStops.push(current.watchPlayers(target.id, value => { if (active()) { roster = value; latest = value; render(); } }, failure));
    publisher = setInterval(() => {
      if (!active() || publishing || !latest || !navigator.onLine || !room) return;
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
  identityStops.push(current.watchRooms(value => {
    if (generation !== identityEpoch) return;
    rooms = value; loading = false;
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
  if (!target || busy) return;
  if (target.dataset.choice !== undefined) {
    selected = Number(target.dataset.choice); render();
    appRoot.querySelector<HTMLButtonElement>(`[data-choice="${selected}"]`)?.focus(); return;
  }
  if (target.dataset.room) { const next = rooms.find(r => r.id === target.dataset.room); if (next) openRoom(next); return; }
  const action = target.dataset.action;
  if (!action && !target.dataset.claim) return;
  if (action === 'ranks') { showRanks = !showRanks; render(); return; }
  if (action === 'ended' && !confirm('結束後無法恢復作答，確定結束活動？')) return;
  const questionId = target.dataset.claim ?? target.closest('[data-question]')?.getAttribute('data-question');
  // Capture the displayed answer before a snapshot can change UI state.
  const selectedChoice = selected;
  busy = true; message = ''; render();
  void (async () => {
    try {
      if (action === 'login') await signInWithPopup(runtime.auth, new GoogleAuthProvider());
      else if (action === 'logout') await signOut(runtime.auth);
      else if (action === 'reauthorize') await authorize();
      else if (classroom) {
        if (action === 'new') openRoom(await classroom.createRoom());
        else if (room && teacher && (action === 'running' || action === 'paused' || action === 'ended' || action === 'archived')) await classroom.setStatus(room.id, action);
        else if (room && player && questionId) {
          if (action === 'answer') await classroom.submitAnswer(room.id, questionId, selectedChoice);
          else if (action === 'explain' || target.dataset.claim) {
            if (answers[questionId]?.correct) viewedCorrect.add(questionId);
            else await classroom.claimExplanation(room.id, questionId);
          } else if (action === 'next' && (answers[questionId]?.correct || answers[questionId]?.viewed)) {
            if (cursor === 39) summaryVisible = true;
            else cursor = (cursor ?? 0) + 1;
            selected = -1;
          }
        }
      }
    } catch (e) { message = cloudError(e); }
    finally {
      busy = false; render();
      if (action === 'next') { const heading = appRoot.querySelector<HTMLElement>('.question h2,.result h2'); if (heading) { heading.tabIndex = -1; heading.focus(); } }
    }
  })();
});
window.addEventListener('online', render);
window.addEventListener('offline', render);
window.addEventListener('pagehide', () => { stopRoom(); identityStops.forEach(stop => stop()); stopAuth(); });
render();

window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
