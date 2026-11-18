import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext } from '@playwright/test';
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

test('students select a peer for steal and swap, and time expires with teacher offline', async ({ browser }, info) => {
  const context = await browser.newContext(), peerContext = await browser.newContext();
  const teacher = await context.newPage(), student = await context.newPage(), peer = await peerContext.newPage();
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
  await teacher.getByRole('button', { name: '建立教室' }).click();
  const link = await teacher.locator('[data-share-url]').inputValue();
  for (const [page, name] of [[student, '寶箱玩家'], [peer, '目標玩家']] as const) {
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
  const ownPath = scorePaths.get('寶箱玩家'), otherPath = scorePaths.get('目標玩家');
  if (!ownPath || !otherPath) throw new Error('Missing synthetic players');
  const ownId = ownPath.split('/').at(-1);
  await teacher.getByRole('button', { name: '開始闖關' }).click();
  await student.setViewportSize({ width: 768, height: 1024 });
  for (const [kind, startingPeerScore, expectedOwn, expectedPeer] of [
    ['steal', 80, 80, 0], ['swap', 40, 40, 80],
  ] as const) {
    const id = await student.locator('[data-question]').getAttribute('data-question');
    const q = questions.get(id ?? '');
    if (!q || !id) throw new Error('Unknown target question');
    await student.getByRole('radio').filter({ hasText: q.choices[q.correctChoiceIndex] }).click();
    await student.getByRole('button', { name: '送出答案', exact: true }).click();
    await student.getByRole('button', { name: '寶箱 1', exact: true }).click();
    await expect(student.locator('.chest-result')).toBeVisible();
    // Seed deterministic emulator-only outcomes and balances; the visible UI performs the claim.
    await patch(context.request, otherPath, 'score', { integerValue: String(startingPeerScore) });
    await patch(context.request, `rooms/${room}/players/${ownId}/answers/${id}`, 'chest', { mapValue: { fields: {
      box: { integerValue: '0' }, outcome: { mapValue: { fields: { kind: { stringValue: kind }, amount: { integerValue: '0' } } } },
      targetId: { nullValue: null }, settled: { booleanValue: false }, delta: { integerValue: '0' }, fallback: { booleanValue: false },
    } } });
    const target = student.getByRole('button', { name: `目標玩家 · ${startingPeerScore} 分`, exact: true });
    await expect(target).toBeVisible();
    await student.screenshot({ path: info.outputPath(`${kind}-target-tablet.png`), fullPage: true });
    await target.click();
    await expect(student.locator('.chest-result')).toContainText(/本次 [+-]?\d+ 分/);
    await expect(student.locator('.progress-label')).toContainText(`${expectedOwn} 分`);
    await expect(peer.locator('.progress-label')).toContainText(`${expectedPeer} 分`);
    await student.getByRole('button', { name: '下一題 →', exact: true }).click();
    await expect(student.locator('[data-question]')).not.toHaveAttribute('data-question', id);
  }
  await teacher.close();
  await patch(context.request, `rooms/${room}`, 'remainingMs', { integerValue: '0' });
  await expect(student.getByRole('heading', { name: '冒險結算' })).toBeVisible();
  await expect(student.getByRole('button', { name: '送出答案', exact: true })).toHaveCount(0);
  await expect(student.locator('.result')).toContainText('40 分');
  await student.screenshot({ path: info.outputPath('expired-teacher-offline.png'), fullPage: true });
  await peerContext.close(); await context.close();
});
