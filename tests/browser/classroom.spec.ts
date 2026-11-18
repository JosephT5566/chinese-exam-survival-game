import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { questions } from '../../src/questions/bank';

test('teacher and student keep distinct identities and complete a cloud classroom', async ({ browser }, testInfo) => {
  const teacherEmail = `browser-${crypto.randomUUID()}@example.test`;
  const context = await browser.newContext();
  const teacher = await context.newPage(), student = await context.newPage();
  const errors: string[] = [];
  teacher.on('pageerror', e => errors.push(e.message)); student.on('pageerror', e => errors.push(e.message));
  await teacher.goto('/?view=teacher');
  const opened = teacher.waitForEvent('popup');
  await teacher.getByRole('button', { name: '使用 Google 登入' }).click();
  const popup = await opened;
  await popup.waitForLoadState();
  await expect(popup.getByText("Sign-in with Google.com", { exact: true })).toBeVisible();
  await popup.getByText('Add new account').click();
  await popup.locator('#email-input').fill(teacherEmail);
  await popup.getByRole('button', { name: 'Sign in with Google.com', exact: true }).click();
  await expect(teacher.getByRole('heading', { name: '等待老師授權' })).toBeVisible();
  const provision = await promisify(execFile)(process.execPath, ['scripts/authorize-teachers.mjs', '--emulator', '--project', 'demo-chinese-exam', '--email', teacherEmail, '--apply']);
  await teacher.getByRole('button', { name: '重新檢查授權' }).click();
  await teacher.getByRole('button', { name: '建立教室' }).click();
  await expect(teacher.locator('#share')).toHaveValue(/room=[A-Z0-9]{6}/);
  const link = await teacher.locator('#share').inputValue();
  await student.goto(link);
  await student.getByLabel('玩家暱稱').fill('測試同學');
  await student.getByRole('button', { name: '加入教室' }).click();
  await expect(student.getByRole('heading', { name: '已入座，等待老師開始' })).toBeVisible();
  await expect(teacher.getByText('測試同學', { exact: true })).toBeVisible();
  await teacher.getByRole('button', { name: '開始闖關' }).click();
  await expect(student.getByRole('radio')).toHaveCount(4);
  await expect(teacher.getByRole('heading', { name: '老師控制台' })).toBeVisible();
  await student.getByRole('button', { name: '全班排名', exact: true }).click();

  for (let ordinal = 1; ordinal <= 40; ordinal++) {
    const question = student.locator('[data-question]');
    await expect(question).toBeVisible();
    const id = await question.getAttribute('data-question');
    const q = questions.get(id ?? '');
    if (!q) throw new Error('Unknown displayed question');
    const incorrect = ordinal === 1 || ordinal === 40;
    const choice = q.choices[incorrect ? (q.correctChoiceIndex + 1) % 4 : q.correctChoiceIndex];
    await student.getByRole('radio').filter({ hasText: choice ?? '' }).click();
    if (ordinal === 1) {
      // The first periodic ranking arrives while a keyboard choice has focus.
      await expect(student.locator('.rank-list').getByText('0 分', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(student.getByRole('radio').filter({ hasText: choice ?? '' })).toBeFocused();
    }
    if (ordinal === 2) {
      await context.setOffline(true);
      await student.getByRole('button', { name: '送出答案', exact: true }).click();
      await expect(student.getByRole('alert')).toContainText('離線');
      await expect(student.getByText('已保存 1 / 40 題', { exact: false })).toBeVisible();
      await context.setOffline(false);
    }
    await student.getByRole('button', { name: '送出答案', exact: true }).click();
    await expect(student.getByText(`已保存 ${ordinal} / 40 題`, { exact: false })).toBeVisible();
    if (incorrect) {
      await student.reload();
      await expect(student.locator('[data-question]')).toHaveAttribute('data-question', id ?? '');
      if (ordinal === 1) {
        await teacher.getByRole('button', { name: '暫停作答' }).click();
        await expect(student.getByRole('heading', { name: '老師已暫停活動' })).toBeVisible();
        await teacher.getByRole('button', { name: '恢復作答' }).click();
      }
      await student.getByRole('button', { name: '閱讀詳解，領取 20 分' }).click();
      await expect(student.getByText('已閱讀詳解 · ＋20 分')).toBeVisible();
    }
    await student.getByRole('button', { name: ordinal === 40 ? '查看結算 →' : '下一題 →', exact: true }).click();
  }
  await expect(student.getByRole('heading', { name: '冒險結算' })).toBeVisible();
  await expect(student.locator('.result').getByText('3840 分', { exact: true })).toBeVisible();
  await student.screenshot({ path: testInfo.outputPath('student-summary.png'), fullPage: true });
  if (await student.getByRole('button', { name: '全班排名', exact: true }).isVisible()) await student.getByRole('button', { name: '全班排名', exact: true }).click();
  await expect(student.locator('.rank-list').getByText('3840 分', { exact: true })).toBeVisible({ timeout: 20_000 });
  teacher.once('dialog', dialog => dialog.accept());
  await teacher.getByRole('button', { name: '結束活動' }).click();
  await expect(teacher.getByRole('button', { name: '封存教室' })).toBeVisible();
  await teacher.getByRole('button', { name: '封存教室' }).click();
  await expect(teacher.locator('.tag')).toHaveText('已封存');
  await teacher.screenshot({ path: testInfo.outputPath('teacher-archived.png'), fullPage: true });
  await teacher.getByRole('button', { name: '建立教室' }).click();
  await expect(teacher.locator('#share')).not.toHaveValue(link);
  const secondLink = await teacher.locator('#share').inputValue();
  const firstCode = new URL(link).searchParams.get('room');
  const secondCode = new URL(secondLink).searchParams.get('room');
  await teacher.getByText(`${firstCode} · 已封存`, { exact: true }).locator('..').getByRole('button').click();
  await expect(teacher.locator('#share')).toHaveValue(link);
  await teacher.getByText(`${secondCode} · 等待開始`, { exact: true }).locator('..').getByRole('button').click();
  await expect(teacher.locator('#share')).toHaveValue(secondLink);
  await expect(teacher.getByText('測試同學', { exact: true })).not.toBeVisible();
  const uid = provision.stdout.split(': ')[1]?.split(',')[0];
  expect(uid).toBeTruthy();
  const revoked = await context.request.patch(`http://127.0.0.1:8080/v1/projects/demo-chinese-exam/databases/(default)/documents/teachers/${encodeURIComponent(uid ?? '')}?updateMask.fieldPaths=authorized`, {
    headers: { Authorization: 'Bearer owner' }, data: { fields: { authorized: { booleanValue: false } } },
  });
  expect(revoked.ok()).toBe(true);
  await expect(teacher.getByRole('heading', { name: '等待老師授權' })).toBeVisible();
  await context.close();
  expect(errors).toEqual([]);
});

test('demo navigation remains offline even when a cloud configuration exists', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByLabel('玩家暱稱').fill('示範同學');
  await page.getByRole('button', { name: /加入教室/ }).click();
  const opened = page.waitForEvent('popup');
  await page.getByRole('link', { name: /在新分頁開啟老師控制台/ }).click();
  const teacher = await opened;
  await expect(teacher).toHaveURL(/demo=1/);
  await expect(teacher.getByText('本機教室管理', { exact: true })).toBeVisible();
});
