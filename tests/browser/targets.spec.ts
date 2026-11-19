import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { questions } from '../../src/questions/bank';
import { object } from '../../src/firebase/model';

const database = 'http://127.0.0.1:8080/v1/projects/demo-chinese-exam/databases/(default)/documents';
const admin = { Authorization: 'Bearer owner' };
async function read(request: APIRequestContext, path: string) {
  const response = await request.get(`${database}/${path}`, { headers: admin });
  expect(response.ok()).toBe(true);
  const data: unknown = await response.json();
  if (!object(data)) throw new Error('Missing emulator document');
  return data;
}
async function patch(request: APIRequestContext, path: string, field: string, value: unknown) {
  const response = await request.patch(`${database}/${path}?updateMask.fieldPaths=${field}`, {
    headers: admin, data: { fields: { [field]: value } },
  });
  expect(response.ok()).toBe(true);
}

const commitEndpoint = /documents:commit(?:\?|$)/;

async function holdNextCommit(page: Page) {
  let send = () => {};
  const gate = new Promise<void>(resolve => { send = resolve; });
  await page.route(commitEndpoint, async route => {
    await gate;
    await route.continue();
  }, { times: 1 });
  return send;
}

test('peer score updates preserve chest presses and only the target receives a notice', async ({ browser }, info) => {
  const context = await browser.newContext(), peerContext = await browser.newContext();
  const observerContext = await browser.newContext();
  const teacher = await context.newPage(), student = await context.newPage(), peer = await peerContext.newPage();
  const observer = await observerContext.newPage();
  const email = `targets-${crypto.randomUUID()}@example.test`;
  await promisify(execFile)(process.execPath, ['scripts/authorize-teachers.mjs', '--emulator', '--project', 'demo-chinese-exam', '--email', email, '--apply']);
  await teacher.goto('/?view=teacher');
  const opened = teacher.waitForEvent('popup');
  await teacher.getByRole('button', { name: '使用 Google 登入' }).click();
  const popup = await opened;
  await popup.waitForLoadState();
  await expect(popup.getByText('Sign-in with Google.com', { exact: true })).toBeVisible();
  await popup.getByText('Add new account').click();
  await popup.locator('#email-input').fill(email);
  await popup.getByRole('button', { name: 'Sign in with Google.com', exact: true }).click();
  await teacher.getByRole('button', { name: '建立房間' }).click();
  const link = await teacher.locator('[data-share-url]').inputValue();
  for (const [page, name] of [[student, '寶箱<玩家>'], [peer, '目標玩家'], [observer, '觀戰玩家']] as const) {
    await page.goto(link);
    await page.getByLabel('玩家暱稱').fill(name);
    await page.getByRole('button', { name: '加入教室' }).click();
    await expect(page.getByRole('heading', { name: '已入座，等待老師開始' })).toBeVisible();
  }
  const code = new URL(link).searchParams.get('room');
  const index = await read(context.request, `roomCodes/${code}`);
  if (!object(index.fields) || !object(index.fields.roomId) || typeof index.fields.roomId.stringValue !== 'string') throw new Error('Missing room ID');
  const room = index.fields.roomId.stringValue;
  const members = await read(context.request, `rooms/${room}/scores`);
  if (!Array.isArray(members.documents)) throw new Error('Missing score documents');
  const scorePaths = new Map<string, string>();
  for (const member of members.documents) {
    if (!object(member) || typeof member.name !== 'string' || !object(member.fields)
      || !object(member.fields.nickname) || typeof member.fields.nickname.stringValue !== 'string') throw new Error('Invalid public score');
    scorePaths.set(member.fields.nickname.stringValue, member.name.split('/documents/')[1] ?? '');
  }
  const ownPath = scorePaths.get('寶箱<玩家>'), otherPath = scorePaths.get('目標玩家');
  if (!ownPath || !otherPath) throw new Error('Missing synthetic players');
  const ownId = ownPath.split('/').at(-1);
  await teacher.getByRole('button', { name: '開始闖關' }).click();
  await student.setViewportSize({ width: 768, height: 1024 });
  await peer.setViewportSize({ width: 390, height: 844 });
  for (const [kind, startingPeerScore, expectedOwn, expectedPeer] of [
    ['steal', 99, 99, 0], ['swap', 40, 40, 99], ['swap', 40, 40, 40],
  ] as const) {
    const id = await student.locator('[data-question]').getAttribute('data-question');
    const q = questions.get(id ?? '');
    if (!q || !id) throw new Error('Unknown target question');
    await student.getByRole('radio').filter({ hasText: q.choices[q.correctChoiceIndex] }).click();
    await student.getByRole('button', { name: '送出答案', exact: true }).click();
    const box = student.getByRole('button', { name: '寶箱 1', exact: true });
    await expect(box).toBeEnabled();
    if (kind === 'steal') {
      await box.scrollIntoViewIfNeeded();
      const bounds = await box.boundingBox();
      if (!bounds) throw new Error('Missing chest bounds');
      const pointer = await context.newCDPSession(student);
      const touch = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      await pointer.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
      await pointer.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touch, y: touch.y - 50 }] });
      await pointer.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await pointer.detach();
      await expect(box).toBeEnabled();
      await expect(student.locator('.chest-result')).toHaveCount(0);

      await student.route(commitEndpoint, route => route.fulfill({
        status: 403,
        json: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'synthetic failed commit' } },
      }), { times: 1 });
      await box.click();
      await expect(student.getByRole('status').filter({ hasText: '可再次操作' })).toBeVisible();
      await expect(box).toBeEnabled();
      await expect(student.locator('.chest-result')).toHaveCount(0);
    }

    const sendOpen = await holdNextCommit(student);
    try {
      await box.focus();
      await student.keyboard.press(kind === 'steal' ? 'Space' : 'Enter');
      await expect(student.getByRole('status').filter({ hasText: '開啟中…' })).toBeVisible();
      await expect(box).toBeDisabled();
      await expect(student.getByRole('button', { name: '寶箱 2', exact: true })).toBeDisabled();
      await expect(student.locator('.chest-result')).toHaveCount(0);
      await student.screenshot({ path: info.outputPath(`${id}-opening-tablet.png`), fullPage: true });
      if (kind === 'steal') {
        // The same anonymous player wins the race from another tab while this commit waits.
        const otherTab = await context.newPage();
        try {
          await otherTab.goto(link);
          await otherTab.getByRole('button', { name: '寶箱 3', exact: true }).click();
          await expect(otherTab.locator('.chest-result')).toContainText('寶箱 3');
        } finally {
          await otherTab.close();
        }
      }
    } finally {
      sendOpen();
    }
    await expect(student.locator('.chest-result')).toContainText(kind === 'steal' ? '寶箱 3' : '寶箱 1');
    // Seed deterministic emulator-only outcomes and balances; the visible UI performs the claim.
    await patch(context.request, otherPath, 'score', { integerValue: String(startingPeerScore + 1) });
    await patch(context.request, `rooms/${room}/players/${ownId}/answers/${id}`, 'chest', { mapValue: { fields: {
      box: { integerValue: kind === 'steal' ? '2' : '0' }, outcome: { mapValue: { fields: { kind: { stringValue: kind }, amount: { integerValue: '0' } } } },
      targetId: { nullValue: null }, settled: { booleanValue: false }, delta: { integerValue: '0' }, fallback: { booleanValue: false },
    } } });
    const target = student.getByRole('button', { name: `目標玩家 · ${startingPeerScore + 1} 分`, exact: true });
    await expect(target).toBeVisible();
    await student.screenshot({ path: info.outputPath(`${kind}-target-tablet.png`), fullPage: true });
    const peerChoice = peer.getByRole('radio').first();
    await peerChoice.focus();
    await expect(peerChoice).toBeFocused();
    await target.scrollIntoViewIfNeeded();
    const bounds = await target.boundingBox();
    if (!bounds) throw new Error('Missing target bounds');
    await student.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await student.mouse.down();
    await patch(context.request, otherPath, 'score', { integerValue: String(startingPeerScore) });
    await expect(student.getByRole('button', { name: `目標玩家 · ${startingPeerScore} 分`, exact: true })).toBeVisible();
    const sendClaim = await holdNextCommit(student);
    try {
      await student.mouse.up();
      await expect(student.getByRole('status').filter({ hasText: '結算中…' })).toBeVisible({ timeout: 4_000 });
      await expect(student.getByRole('button', { name: `目標玩家 · ${startingPeerScore} 分`, exact: true })).toBeDisabled();
      await expect(peer.getByText('寶箱<玩家>對你使用了寶箱效果。')).toHaveCount(0);
      await expect(student.getByRole('button', { name: '下一題 →' })).toHaveCount(0);
      await student.screenshot({ path: info.outputPath(`${id}-settling-tablet.png`), fullPage: true });
    } finally {
      sendClaim();
    }
    await expect(student.locator('.chest-result')).toContainText('已結算');
    await expect(student.locator('.chest-result')).toContainText(/本次 [+-]?\d+ 分/);
    await expect(student.locator('.progress-label')).toContainText(`${expectedOwn} 分`);
    await expect(peer.locator('.progress-label')).toContainText(`${expectedPeer} 分`);
    await expect(peer.getByRole('status').filter({ hasText: '寶箱<玩家>對你使用了寶箱效果。' })).toBeVisible();
    await expect(student.getByText('寶箱<玩家>對你使用了寶箱效果。')).toHaveCount(0);
    await expect(observer.getByText('寶箱<玩家>對你使用了寶箱效果。')).toHaveCount(0);
    await expect(peerChoice).toBeFocused();
    expect(await peer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await peer.screenshot({ path: info.outputPath(`${id}-attack-notice.png`), fullPage: true });
    await peer.reload();
    await expect(peer.getByRole('radio')).toHaveCount(4);
    await expect(peer.getByText('寶箱<玩家>對你使用了寶箱效果。')).toHaveCount(0);
    await student.getByRole('button', { name: '下一題 →', exact: true }).click();
    await expect(student.locator('[data-question]')).not.toHaveAttribute('data-question', id);
  }
  await teacher.close();
  await patch(context.request, `rooms/${room}`, 'remainingMs', { integerValue: '0' });
  await expect(student.getByRole('heading', { name: '冒險結算' })).toBeVisible();
  await expect(student.getByRole('button', { name: '送出答案', exact: true })).toHaveCount(0);
  await expect(student.locator('.result')).toContainText('40 分');
  await student.screenshot({ path: info.outputPath('expired-teacher-offline.png'), fullPage: true });
  await peerContext.close();
  await observerContext.close(); await context.close();
});
