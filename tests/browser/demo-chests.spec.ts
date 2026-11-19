import { expect, test, type Page } from '@playwright/test';
import { answer, claimChest, newPlayer, nextQuestion, openChest, type Player } from '../../src/game/session';
import type { Room } from '../../src/game/local';
import { questions } from '../../src/questions/bank';

const roomKey = 'literature-quest.v2.DEMO01';
const demoUrl = '/?demo=1&room=DEMO01';

function runningRoom(players: Player[]): Room {
  return { code: 'DEMO01', rulesVersion: 2, status: 'running', durationMinutes: 20,
    remainingMs: 1_200_000, runningSince: Date.now(), players, entries: [], updated: 0 };
}

function correctChoice(player: Player) {
  const id = player.order[player.cursor]!;
  return { id, choice: player.choices[id]!.indexOf(questions.get(id)!.correctChoiceIndex) };
}

function prepareChest(player: Player, kind: 'gain' | 'steal' | 'swap') {
  const { id, choice } = correctChoice(player);
  answer(player, id, choice);
  const chest = openChest(player, id, 0);
  if (!chest) throw new Error('Expected a chest for the correct answer');
  chest.outcome = kind === 'gain' ? { kind, amount: 20 } : { kind, amount: 0 };
  return id;
}

async function enterDemo(page: Page, room: Room, player: Player) {
  await page.goto(demoUrl + '&guest=1');
  await page.evaluate(({ roomKey, room, id }) => {
    localStorage.setItem(roomKey, JSON.stringify(room));
    sessionStorage.setItem('quest.tab.DEMO01', id);
  }, { roomKey, room, id: player.id });
  await page.goto(demoUrl);
}

async function saveFromAnotherTab(page: Page, room: Room) {
  const writer = await page.context().newPage();
  try {
    await writer.goto(demoUrl + '&guest=1');
    await writer.evaluate(({ roomKey, room }) => localStorage.setItem(roomKey, JSON.stringify(room)), { roomKey, room });
  } finally {
    await writer.close();
  }
}

test('a score gaining a digit does not move the next target out from under a press', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const actor = newPlayer('開箱玩家');
  const first = newPlayer('甲甲甲甲甲甲甲甲甲甲');
  const target = newPlayer('目標玩家');
  first.totalScore = 999;
  target.totalScore = 80;
  prepareChest(actor, 'steal');
  const room = runningRoom([actor, first, target]);
  await enterDemo(page, room, actor);
  const button = page.getByRole('button', { name: '目標玩家 · 80 分', exact: true });
  await button.scrollIntoViewIfNeeded();
  const bounds = await button.boundingBox();
  if (!bounds) throw new Error('Missing target bounds');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 8);
  await page.mouse.down();
  first.totalScore = 1099;
  await saveFromAnotherTab(page, room);
  await expect(page.getByRole('button', { name: /1099 分/ })).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.chest-result')).toContainText('本次 +80 分', { timeout: 3_000 });
  await page.screenshot({ path: info.outputPath('narrow-target-settled.png'), fullPage: true });
});

test('the last correct demo answer is saved while its chest is still pending', async ({ page }) => {
  const player = newPlayer('闖關玩家');
  while (player.cursor < 39) {
    const id = prepareChest(player, 'gain');
    claimChest(player, id, null);
    nextQuestion(player);
  }
  const { choice } = correctChoice(player);
  await enterDemo(page, runningRoom([player]), player);
  await page.getByRole('radio').nth(choice).click();
  await page.getByRole('button', { name: /送出答案/ }).click();
  await expect(page.getByRole('button', { name: '寶箱 1', exact: true })).toBeVisible();
  await expect(page.locator('.progress-label')).toContainText('已保存 40 / 40 題', { timeout: 3_000 });
  await expect(page.getByRole('heading', { name: '冒險結算' })).toHaveCount(0);
  await page.getByRole('button', { name: '寶箱 1', exact: true }).click();
  await page.getByRole('button', { name: '確認領取', exact: true }).click();
  await expect(page.getByRole('heading', { name: '冒險結算' })).toBeVisible();
});

test('a single demo storage update announces both saved attackers', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const target = newPlayer('目標玩家');
  const first = newPlayer('小魚');
  const second = newPlayer('阿明');
  const firstId = prepareChest(first, 'steal');
  const secondId = prepareChest(second, 'swap');
  const room = runningRoom([target, first, second]);
  await enterDemo(page, room, target);
  const choice = page.getByRole('radio').first();
  await choice.focus();
  claimChest(first, firstId, target, true);
  claimChest(second, secondId, target, true);
  await saveFromAnotherTab(page, room);
  const notice = page.getByRole('status').filter({ hasText: '對你使用了寶箱效果' });
  await expect(notice).toContainText('阿明');
  await expect(notice).toContainText('小魚', { timeout: 3_000 });
  await expect(choice).toBeFocused();
  await page.screenshot({ path: info.outputPath('batched-attack-notice.png'), fullPage: true });
});
