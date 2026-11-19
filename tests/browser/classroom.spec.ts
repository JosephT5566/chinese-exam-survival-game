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
  await expect(teacher.locator('code')).toHaveText(teacherEmail);
  await teacher.screenshot({ path: testInfo.outputPath('teacher-pending-email.png'), fullPage: true });
  await promisify(execFile)(process.execPath, ['scripts/authorize-teachers.mjs', '--emulator', '--project', 'demo-chinese-exam', '--email', teacherEmail, '--apply']);
  await teacher.getByRole('button', { name: '重新檢查授權' }).click();
  await teacher.getByRole('button', { name: '建立房間' }).click();
  await expect(teacher.locator('[data-share-url]')).toHaveValue(/room=[A-Z0-9]{6}/);
  const link = await teacher.locator('[data-share-url]').inputValue();
  await teacher.getByText('顯示 QR Code／放大投影', { exact: true }).click();
  await expect(teacher.getByRole('img', { name: '學生加入 QR Code', exact: true })).toBeVisible();
  await teacher.screenshot({ path: testInfo.outputPath('teacher-share-qr.png'), fullPage: true });
  await student.goto(link);
  await student.getByLabel('玩家暱稱').fill('測試同學');
  await student.getByRole('button', { name: '加入教室' }).click();
  await expect(student.getByRole('heading', { name: '已入座，等待老師開始' })).toBeVisible();
  await expect(teacher.getByText('測試同學', { exact: true })).toBeVisible();
  await teacher.getByRole('button', { name: '開始闖關' }).click();
  await expect(student.getByRole('radio')).toHaveCount(4);
  await expect(teacher.getByRole('heading', { name: '老師控制台' })).toBeVisible();
  await expect(teacher.getByRole('button', { name: '建立房間', exact: true })).toBeDisabled();
  await teacher.setViewportSize({ width: 1024, height: 768 });
  await teacher.screenshot({ path: testInfo.outputPath('teacher-running-tablet.png'), fullPage: true });
  await expect(teacher.getByText('活動進行中，請先暫停或結束活動', { exact: true })).toBeVisible();
  await student.getByRole('button', { name: '全班排名', exact: true }).click();

  let expectedScore = 0;
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
      await student.getByText('閱讀詳解（不加分）', { exact: true }).click();
      if (ordinal === 40) await expect(student.getByText('冷凍', { exact: false })).toBeVisible();
      if (ordinal === 1) {
        await student.setViewportSize({ width: 390, height: 844 });
        await student.screenshot({ path: testInfo.outputPath('student-mobile-freeze.png'), fullPage: true });
        await student.setViewportSize({ width: 1024, height: 768 });
      }
    } else {
      if (ordinal === 2) await student.screenshot({ path: testInfo.outputPath('student-tablet-three-chests.png'), fullPage: true });
      await student.getByRole('button', { name: '寶箱 2', exact: true }).click();
      await expect(student.locator('.chest-result')).toBeVisible();
      if (ordinal === 2) {
        await student.reload();
        await expect(student.locator('.chest-result')).toBeVisible();
        await expect(student.getByRole('button', { name: '寶箱 2', exact: true })).toHaveCount(0);
        await student.screenshot({ path: testInfo.outputPath('student-tablet-chest.png'), fullPage: true });
      }
      await student.getByRole('button', { name: '確認領取', exact: true }).click();
      await expect(student.locator('.chest-result')).toContainText(/本次 [+-]?\d+ 分/);
      const delta = (await student.locator('.chest-result').innerText()).match(/本次 ([+-]?\d+) 分/);
      if (!delta) throw new Error('Missing applied chest delta');
      expectedScore += Number(delta[1]);
    }
    await student.getByRole('button', { name: ordinal === 40 ? '查看結算 →' : '下一題 →', exact: true }).click();
  }
  await expect(student.getByRole('heading', { name: '冒險結算' })).toBeVisible();
  await expect(student.locator('.result').getByText(`${expectedScore} 分`, { exact: true })).toBeVisible();
  await student.screenshot({ path: testInfo.outputPath('student-summary.png'), fullPage: true });
  if (await student.getByRole('button', { name: '全班排名', exact: true }).isVisible()) await student.getByRole('button', { name: '全班排名', exact: true }).click();
  await expect(student.locator('.rank-list').getByText(`${expectedScore} 分`, { exact: true })).toBeVisible({ timeout: 20_000 });
  teacher.once('dialog', dialog => dialog.accept());
  await teacher.getByRole('button', { name: '結束活動' }).click();
  await expect(teacher.getByRole('button', { name: '封存房間' })).toBeVisible();
  await teacher.getByRole('button', { name: '封存房間' }).click();
  await expect(teacher.locator('.tag')).toHaveText('已封存');
  await teacher.screenshot({ path: testInfo.outputPath('teacher-archived.png'), fullPage: true });
  await teacher.getByRole('button', { name: '建立房間' }).click();
  await expect(teacher.locator('[data-share-url]')).not.toHaveValue(link);
  const secondLink = await teacher.locator('[data-share-url]').inputValue();
  const firstCode = new URL(link).searchParams.get('room');
  const secondCode = new URL(secondLink).searchParams.get('room');
  await teacher.getByText(`${firstCode} · 已封存`, { exact: true }).locator('..').getByRole('button').click();
  await expect(teacher.locator('[data-share-url]')).toHaveValue(link);
  await teacher.getByText(`${secondCode} · 等待開始`, { exact: true }).locator('..').getByRole('button').click();
  await expect(teacher.locator('[data-share-url]')).toHaveValue(secondLink);
  await expect(teacher.getByText('測試同學', { exact: true })).not.toBeVisible();
  await teacher.getByText(`${firstCode} · 已封存`, { exact: true }).locator('..').getByRole('button').click();
  await teacher.getByRole('button', { name: '刪除房間', exact: true }).click();
  await teacher.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await teacher.getByRole('button', { name: '刪除房間', exact: true }).click();
  await teacher.getByLabel('輸入房間碼以確認').fill(firstCode ?? '');
  // A live roster/ranking render cannot erase the confirmation field.
  await teacher.waitForTimeout(300);
  await expect(teacher.getByLabel('輸入房間碼以確認')).toHaveValue(firstCode ?? '');
  await teacher.setViewportSize({ width: 390, height: 844 });
  await teacher.screenshot({ path: testInfo.outputPath('cloud-delete-mobile.png'), fullPage: false });
  expect(await teacher.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await teacher.getByRole('button', { name: '永久刪除', exact: true }).click();
  await expect(teacher.getByRole('alert')).toContainText('房間已刪除');
  await expect(student.getByRole('heading', { name: '房間無法繼續使用' })).toBeVisible();
  await expect(teacher.getByText(`${secondCode} · 等待開始`, { exact: true })).toBeVisible();
  await student.reload();
  await expect(student.getByRole('heading', { name: '加入教室' })).toBeVisible();
  const revoked = await context.request.patch(`http://127.0.0.1:8080/v1/projects/demo-chinese-exam/databases/(default)/documents/teacherEmails/${encodeURIComponent(teacherEmail.toLowerCase())}?updateMask.fieldPaths=authorized`, {
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
  await expect(teacher.getByText('本機房間管理', { exact: true })).toBeVisible();
  await teacher.getByLabel('活動時間（1–60 分鐘）').fill('2');
  await teacher.getByRole('button', { name: '設定時間', exact: true }).click();
  await teacher.getByText('顯示 QR Code／放大投影', { exact: true }).click();
  await expect(teacher.getByRole('img', { name: '學生加入 QR Code', exact: true })).toBeVisible();
  await teacher.getByLabel('活動時間（1–60 分鐘）').focus();
  await expect.poll(async () => teacher.locator('.share-qr-details').getAttribute('open')).not.toBeNull();
  await teacher.getByRole('button', { name: '開始闖關', exact: true }).click();
  await expect(page.locator('[data-question]')).toBeVisible();
  const id = await page.locator('[data-question]').getAttribute('data-question');
  const q = questions.get(id ?? '');
  if (!q) throw new Error('Unknown demo question');
  await page.getByRole('radio').filter({ hasText: q.choices[q.correctChoiceIndex] }).click();
  await page.getByRole('button', { name: /送出答案/ }).click();
  await expect(page.getByRole('button', { name: /寶箱 [123]/ })).toHaveCount(3);
  await page.getByRole('button', { name: '寶箱 1', exact: true }).click();
  await expect(page.locator('.chest-result')).toBeVisible();
  await page.reload();
  await expect(page.locator('.chest-result')).toBeVisible();
  await page.getByRole('button', { name: '確認領取', exact: true }).click();
  await expect(page.locator('.chest-result')).toContainText('本次');
  await page.getByRole('button', { name: '下一題 →', exact: true }).click();
  await expect(page.locator('[data-question]')).not.toHaveAttribute('data-question', id ?? '');
  await teacher.close();
});


test('preauthorized email can enter the teacher console on first Google login', async ({ page }, testInfo) => {
  const email = `preauthorized-${crypto.randomUUID()}@example.test`;
  await promisify(execFile)(process.execPath, ['scripts/authorize-teachers.mjs', '--emulator', '--project', 'demo-chinese-exam', '--email', email, '--apply']);
  await page.goto('/?view=teacher');
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: '使用 Google 登入' }).click();
  const popup = await opened;
  await popup.waitForLoadState();
  await popup.getByText('Add new account').click();
  await popup.locator('#email-input').fill(email);
  await popup.getByRole('button', { name: 'Sign in with Google.com', exact: true }).click();
  await expect(page.getByRole('heading', { name: '老師控制台' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '等待老師授權' })).not.toBeVisible();
  await page.getByRole('button', { name: '建立房間' }).click();
  await expect(page.locator('[data-share-url]')).toHaveValue(/room=[A-Z0-9]{6}/);
  await page.screenshot({ path: testInfo.outputPath('preauthorized-teacher.png'), fullPage: true });
});

test('demo teacher focuses active controls and permanently deletes with typed confirmation', async ({ browser }, testInfo) => {
  const context = await browser.newContext();
  const teacher = await context.newPage(), student = await context.newPage();
  await teacher.goto('/?demo=1&view=teacher&room=DEMO01');
  await student.goto('/?demo=1&room=DEMO01');
  await student.getByLabel('玩家暱稱').fill('持續作答同學');
  await student.getByRole('button', { name: /加入教室/ }).click();
  await expect(student.getByRole('heading', { name: '已入座，等待老師開始' })).toBeVisible();
  await teacher.getByRole('button', { name: '開始闖關', exact: true }).click();
  await expect(teacher.getByRole('button', { name: '暫停作答', exact: true })).toBeEnabled();
  await teacher.getByText('房間管理', { exact: true }).click();
  await expect(teacher.getByRole('button', { name: '建立新示範房間', exact: true })).toBeDisabled();
  await expect(teacher.getByRole('button', { name: '刪除房間', exact: true })).toBeDisabled();
  await expect(teacher.getByText('活動進行中，請先暫停或結束活動', { exact: true })).toBeVisible();
  await teacher.screenshot({ path: testInfo.outputPath('demo-running-desktop.png'), fullPage: true });
  await teacher.getByRole('button', { name: '暫停作答', exact: true }).click();
  await expect(teacher.getByRole('button', { name: '恢復作答', exact: true })).toBeEnabled();
  await expect(teacher.getByRole('button', { name: '刪除房間', exact: true })).toBeDisabled();
  teacher.once('dialog', dialog => dialog.accept());
  await teacher.getByRole('button', { name: '結束活動', exact: true }).click();
  await teacher.getByRole('button', { name: '刪除房間', exact: true }).click();
  const dialog = teacher.getByRole('dialog');
  await expect(dialog).toContainText('DEMO01');
  await expect(dialog.getByRole('button', { name: '永久刪除', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await teacher.reload();
  await expect(teacher.getByText('已結束', { exact: true })).toBeVisible();
  await teacher.getByRole('button', { name: '刪除房間', exact: true }).click();
  await teacher.getByLabel('輸入房間碼以確認').fill('demo01');
  await teacher.setViewportSize({ width: 390, height: 844 });
  await teacher.screenshot({ path: testInfo.outputPath('demo-delete-mobile.png'), fullPage: false });
  expect(await teacher.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await teacher.getByRole('button', { name: '永久刪除', exact: true }).click();
  await expect(teacher.getByRole('heading', { name: '房間已刪除' })).toBeVisible();
  await expect(student.getByRole('heading', { name: '房間已刪除' })).toBeVisible();
  await student.reload();
  await expect(student.getByRole('heading', { name: '房間已刪除' })).toBeVisible();
  await teacher.reload();
  await expect(teacher.getByRole('heading', { name: '房間已刪除' })).toBeVisible();
  await teacher.getByRole('button', { name: '建立新示範房間', exact: true }).click();
  await expect(teacher.getByRole('button', { name: '開始闖關', exact: true })).toBeVisible();
  await expect(teacher).not.toHaveURL(/room=DEMO01/);
  await context.close();
});

test('demo review preserves an unsaved duration and focus when a student joins', async ({ browser }) => {
  const context = await browser.newContext();
  const teacher = await context.newPage(), student = await context.newPage();
  await teacher.goto('/?demo=1&view=teacher&room=DEMO01');
  const duration = teacher.getByLabel('活動時間（1–60 分鐘）');
  await duration.fill('37');
  await student.goto('/?demo=1&room=DEMO01');
  await student.getByLabel('玩家暱稱').fill('加入觸發更新');
  await student.getByRole('button', { name: /加入教室/ }).click();
  await expect(teacher.getByText('加入觸發更新', { exact: true })).toBeVisible();
  await expect(duration).toHaveValue('37');
  await expect(duration).toBeFocused();
  await teacher.getByRole('button', { name: '設定時間', exact: true }).click();
  await expect.poll(() => teacher.evaluate(() => localStorage.getItem('literature-quest.v2.DEMO01'))).toContain('"durationMinutes":37');
  await teacher.reload();
  await expect(duration).toHaveValue('37');
  await context.close();
});

for (const target of ['literature-quest.v2.DEMO01', 'quest.identity.DEMO01']) {
  test(`demo review keeps pending deletion after ${target} cleanup fails and reloads`, async ({ page }, testInfo) => {
    await page.addInitScript(({ target }) => {
      const remove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function(key: string) {
        if (key === target && localStorage.getItem('test.fail-delete') === '1') throw new DOMException('Test blocked cleanup', 'QuotaExceededError');
        return remove.call(this, key);
      };
    }, { target });
    await page.goto('/?demo=1&view=teacher&room=DEMO01');
    // Use the visible settings control to create the lobby save before deletion.
    await page.getByRole('button', { name: '設定時間', exact: true }).click();
    await page.evaluate(() => {
      localStorage.setItem('quest.identity.DEMO01', 'synthetic-student');
      localStorage.setItem('test.fail-delete', '1');
    });
    await page.getByRole('button', { name: '刪除房間', exact: true }).click();
    await page.getByLabel('輸入房間碼以確認').fill('DEMO01');
    await page.getByRole('button', { name: '永久刪除', exact: true }).click();
    await expect(page.getByRole('heading', { name: '房間刪除尚未完成' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '房間已刪除', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: '房間刪除尚未完成' })).toBeVisible();
    await expect(page.getByRole('button', { name: '繼續刪除', exact: true })).toBeEnabled();
    expect(await page.evaluate(target => localStorage.getItem(target), target)).not.toBeNull();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('heading', { name: '房間刪除尚未完成' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('demo-deletion-pending-mobile.png'), fullPage: false });
    await page.evaluate(() => localStorage.removeItem('test.fail-delete'));
    await page.getByRole('button', { name: '繼續刪除', exact: true }).click();
    await expect(page.getByRole('heading', { name: '房間已刪除', exact: true })).toBeVisible();
    expect(await page.evaluate(() => ({ room: localStorage.getItem('literature-quest.v2.DEMO01'), identity: localStorage.getItem('quest.identity.DEMO01') }))).toEqual({ room: null, identity: null });
    await page.reload();
    await expect(page.getByRole('heading', { name: '房間已刪除', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '繼續刪除', exact: true })).toHaveCount(0);
  });
}
