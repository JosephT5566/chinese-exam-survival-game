// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jsQR from 'jsqr';
import { mountShare, sharePanel } from '../../src/app/share';

let root: HTMLDivElement;
const url = 'https://class.example/學生?room=ABC123&name=國文';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function click(action: string): void {
  root.querySelector<HTMLButtonElement>(`[data-share-action="${action}"]`)?.click();
}
function status(): string | null | undefined { return root.querySelector('.share-status')?.textContent; }
function setNavigator(name: string, value: unknown): void {
  Object.defineProperty(navigator, name, { configurable: true, value });
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  root.innerHTML = sharePanel(url);
  mountShare(root);
  setNavigator('share', undefined);
  setNavigator('clipboard', undefined);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
});
afterEach(() => { root.remove(); vi.restoreAllMocks(); });

describe('classroom sharing', () => {
  it('escapes URL attributes and warns about demo and local-only links', () => {
    root.innerHTML = sharePanel('http://localhost:5173/?x="/><img src=x onerror=alert(1)>', true);
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('同一個瀏覽器');
    expect(root.textContent).toContain('其他裝置無法使用');
    expect(root.querySelector<HTMLInputElement>('input')?.value).toContain('<img');
  });

  it('copies after rerenders and only mounts once', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator('clipboard', { writeText });
    mountShare(root);
    root.innerHTML = sharePanel('https://example.com/?room=SECOND');
    click('copy');
    await flush();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://example.com/?room=SECOND');
    expect(status()).toContain('已複製');
  });

  it('shares directly from a user click', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator('share', share);
    click('share');
    await flush();
    expect(share).toHaveBeenCalledExactlyOnceWith({ title: '國文段考生存戰', url });
    expect(status()).toContain('已開啟分享');
  });

  it('treats share cancellation normally without copying', async () => {
    const writeText = vi.fn();
    setNavigator('clipboard', { writeText });
    setNavigator('share', vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')));
    click('share');
    await flush();
    expect(writeText).not.toHaveBeenCalled();
    expect(status()).toContain('已取消');
  });

  it.each([undefined, vi.fn().mockRejectedValue(new Error('blocked'))])('copies when native share is missing or fails', async (share) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator('share', share);
    setNavigator('clipboard', { writeText });
    click('share');
    await flush();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(url);
  });

  it('uses legacy copy when clipboard permission fails', async () => {
    setNavigator('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    const command = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: command });
    click('copy');
    await flush();
    expect(command).toHaveBeenCalledWith('copy');
    expect(status()).toContain('已複製');
  });

  it('keeps the full link selected when all copy methods fail', async () => {
    click('copy');
    await flush();
    const input = root.querySelector<HTMLInputElement>('input');
    expect(document.activeElement).toBe(input);
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe(url.length);
    expect(status()).toContain('無法自動複製');
  });

  it('preserves a selectable URL if QR encoding fails', () => {
    root.innerHTML = sharePanel('https://example.com/?data=' + 'x'.repeat(10000));
    const details = root.querySelector('details');
    if (!details) throw new Error('Missing QR disclosure');
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(root.querySelector('svg')).toBeNull();
    expect(status()).toContain('QR Code 無法產生');
    expect(root.querySelector<HTMLInputElement>('input')?.readOnly).toBe(true);
  });

  it('lazily generates a locally decodable QR after a rerender with a four-module quiet zone', () => {
    root.innerHTML = sharePanel(url);
    expect(root.querySelector('svg')).toBeNull();
    const details = root.querySelector('details');
    if (!details) throw new Error('Missing QR disclosure');
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    const svg = root.querySelector('svg');
    const modules = Number(svg?.getAttribute('viewBox')?.split(' ')[2]);
    const scale = 6;
    const width = modules * scale;
    const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
    const path = svg?.querySelector('path')?.getAttribute('d') ?? '';
    expect(path).not.toBe('');
    for (const match of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
      const x = Number(match[1]);
      const y = Number(match[2]);
      expect(x).toBeGreaterThanOrEqual(4);
      expect(y).toBeGreaterThanOrEqual(4);
      expect(x).toBeLessThan(modules - 4);
      expect(y).toBeLessThan(modules - 4);
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const index = ((y * scale + dy) * width + x * scale + dx) * 4;
          pixels[index] = pixels[index + 1] = pixels[index + 2] = 0;
        }
      }
    }
    expect(jsQR(pixels, width, width)?.data).toBe(url);
    details.dispatchEvent(new Event('toggle'));
    expect(root.querySelectorAll('svg')).toHaveLength(1);
  });
});
