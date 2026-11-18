import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('靜態 SPA 發布設定', () => {
  it('發布 build 產物並讓房間深連結回到 SPA', () => {
    const configuration: unknown = JSON.parse(readFileSync('firebase.json', 'utf8'));
    expect(configuration).toMatchObject({
      hosting: {
        public: 'dist',
        rewrites: [{ source: '**', destination: '/index.html' }],
      },
      firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
    });
  });

  it('入口標示中文且不載入遠端第三方腳本', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('lang="zh-Hant"');
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
  });
});
