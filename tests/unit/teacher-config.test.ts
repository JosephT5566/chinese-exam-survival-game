import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = 'scripts/authorize-teachers.mjs';
const base = ['--project', 'demo-chinese-exam', '--validate-env'];
function validate(value?: string) {
  const env = { ...process.env };
  delete env.TEACHER_EMAILS;
  if (value !== undefined) env.TEACHER_EMAILS = value;
  return spawnSync(process.execPath, [script, ...base], { env, encoding: 'utf8' });
}

describe('部署老師 email 名單', () => {
  it('離線驗證、正規化與去重，不輸出 email 名單或取得憑證', () => {
    const result = validate('[" Teacher@Example.com ","teacher@example.com"]');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 email');
    expect(result.stdout).not.toMatch(/teacher@example/i);
    expect(result.stderr).toBe('');
  });
  it('允許上限 100 個 email', () => {
    expect(validate(JSON.stringify(Array.from({ length: 100 }, (_, n) => `t${n}@example.com`))).status).toBe(0);
  });
  it('明確空陣列表示清空', () => {
    const result = validate('[]');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 email');
  });
  it.each([undefined, '', ' ', 'null', '{}', '"teacher@example.com"', '[1]', '[""]',
    '["bad"]', '["a/b@example.com"]', '["a\\\\b@example.com"]', '["a@example.com?x"]',
    JSON.stringify(Array.from({ length: 101 }, (_, n) => `t${n}@example.com`)),
  ])('拒絕缺值或無效名單 %j', value => {
    const result = validate(value);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('gcloud');
    expect(result.stderr).toMatch(/TEACHER_EMAILS|email/i);
  });
  it('互斥模式、過多手動 email 與不合法 project 在取憑證前失敗', () => {
    for (const args of [
      [...base, '--apply'], [...base, '--email', 't@example.com'],
      [...base, '--sync-env'], ['--project', 'other-project', '--email', 't@example.com', '--emulator'],
      ['--project', '../bad', '--email', 't@example.com'],
      ['--project', 'demo-chinese-exam', ...Array.from({ length: 11 }, () => ['--email', 't@example.com']).flat()],
    ]) {
      const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain('Administrator authentication failed');
    }
  });
  it('腳本語法正確', () => {
    expect(() => execFileSync(process.execPath, ['--check', script])).not.toThrow();
  });
});
