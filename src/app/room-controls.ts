import type { RoomStatus } from '../firebase/model';
import './room-controls.css';

export const roomLabels: Record<RoomStatus, string> = {
  lobby: '等待開始', running: '闖關中', paused: '已暫停', ended: '已結束', archived: '已封存', deleting: '刪除中',
};
export const runningHint = '活動進行中，請先暫停或結束活動';
export function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
export function managementLocked(status: RoomStatus | undefined): boolean { return status === 'running' || status === 'deleting'; }
export function canDelete(status: RoomStatus, legacy = false): boolean {
  return status === 'deleting' || (legacy ? true : status === 'lobby' || status === 'ended' || status === 'archived');
}
export function controlButton(action: string, label: string, disabled: boolean, kind = 'secondary'): string {
  return `<button type="button" class="${kind}" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}
export function deletionSection(code: string, status: RoomStatus, disabled: boolean): string {
  return `<section class="delete-zone" aria-label="刪除房間"><h3>刪除房間</h3><p>永久刪除房間 ${escapeText(code)} 與玩家紀錄，無法復原。</p>${controlButton('delete', status === 'deleting' ? '繼續刪除' : '刪除房間', disabled, 'danger')}</section>`;
}
export function preserveDetails(root: HTMLElement): () => void {
  document.querySelector('dialog[data-room-delete]')?.dispatchEvent(new Event('room-controls:update'));
  const open = [...root.querySelectorAll<HTMLDetailsElement>('details[data-disclosure]')].map(el => [el.dataset.disclosure, el.open] as const);
  return () => { for (const el of root.querySelectorAll<HTMLDetailsElement>('details[data-disclosure]')) {
    const previous = open.find(([id]) => id === el.dataset.disclosure);
    if (previous) el.open = previous[1];
  } };
}
// This dialog lives outside view innerHTML. Snapshot renders cannot erase input,
// change the deletion target or steal focus while the teacher is confirming.
export function confirmRoomDeletion(code: string, allowed: () => boolean, submit: () => Promise<void>): void {
  if (document.querySelector('dialog[data-room-delete]')) return;
  const dialog = document.createElement('dialog');
  dialog.dataset.roomDelete = '';
  dialog.setAttribute('aria-labelledby', 'delete-title');
  dialog.setAttribute('aria-describedby', 'delete-warning');
  dialog.innerHTML = `<form><h2 id="delete-title">永久刪除房間 ${escapeText(code)}？</h2><p id="delete-warning">房間、玩家、答案、寶箱與排名紀錄都會永久刪除，無法復原。</p><label for="delete-code">輸入房間碼以確認</label><input id="delete-code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12"><div class="actions"><button type="button" class="secondary" data-cancel autofocus>取消</button><button type="submit" class="danger" disabled>永久刪除</button></div><p role="alert"></p></form>`;
  const input = dialog.querySelector('input'), confirm = dialog.querySelector<HTMLButtonElement>('[type=submit]');
  const returnFocus = document.activeElement;
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
    else document.querySelector<HTMLElement>('[data-action=delete],main h1')?.focus();
  });
  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
  const update = () => { if (confirm) confirm.disabled = input?.value.trim().toUpperCase() !== code || !allowed(); };
  input?.addEventListener('input', update);
  dialog.addEventListener('room-controls:update', update);
  dialog.querySelector('form')?.addEventListener('submit', event => {
    event.preventDefault();
    if (confirm?.disabled || input?.value.trim().toUpperCase() !== code) return;
    if (!allowed()) {
      const error = dialog.querySelector('[role=alert]');
      if (error) error.textContent = '房間狀態已變更，請關閉後重新確認。';
      return;
    }
    dialog.close(); void submit();
  });
  document.body.append(dialog); dialog.showModal();
}
