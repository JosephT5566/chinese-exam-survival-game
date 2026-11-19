import qrcode from 'qrcode-generator';
import './share.css';

qrcode.stringToBytes = (value: string) => Array.from(new TextEncoder().encode(value));

const mounted = new WeakSet<HTMLElement>();

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

export function sharePanel(url: string, demo = false): string {
  let local = false;
  try {
    local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    local = true;
  }
  return `<section class="share-panel" aria-label="分享加入連結">
    <div class="share-actions"><button type="button" class="secondary" data-share-action="share">分享連結</button><button type="button" class="secondary" data-share-action="copy">複製連結</button></div>
    <label class="share-link">學生加入連結<input data-share-url readonly value="${escape(url)}" aria-label="學生加入連結"></label>
    ${demo ? '<p class="share-warning">示範房間只在同一個瀏覽器共用，請在同一瀏覽器開啟學生頁面；其他裝置無法加入。</p>' : ''}
    ${local ? '<p class="share-warning">這是本機網址，其他裝置無法使用。請改用已部署的公開網址。</p>' : ''}
    <details class="share-qr-details"><summary>顯示 QR Code／放大投影</summary><div class="share-qr" aria-label="學生加入 QR Code"></div><p>請掃描 QR Code 加入房間。</p></details>
    <p class="share-status" role="status" aria-live="polite"></p>
  </section>`;
}

function showQr(panel: Element): void {
  const input = panel.querySelector<HTMLInputElement>('[data-share-url]');
  const target = panel.querySelector('.share-qr');
  if (!input || !target || target.childElementCount) return;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(input.value);
    qr.make();
    const size = qr.getModuleCount();
    let path = '';
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        if (qr.isDark(row, column)) path += `M${column + 4} ${row + 4}h1v1h-1z`;
      }
    }
    target.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 8} ${size + 8}" role="img" aria-label="學生加入 QR Code" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${path}" fill="black"/></svg>`;
  } catch {
    setStatus(panel, 'QR Code 無法產生，請複製上方連結。');
  }
}

function setStatus(panel: Element, message: string): void {
  const status = panel.querySelector('.share-status');
  if (status) status.textContent = message;
}

function selectLink(input: HTMLInputElement): void {
  input.focus();
  input.select();
  input.setSelectionRange(0, input.value.length);
}

async function copy(panel: Element, input: HTMLInputElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(input.value);
    setStatus(panel, '已複製加入連結。');
    return;
  } catch {
    selectLink(input);
  }
  try {
    if (document.execCommand('copy')) {
      setStatus(panel, '已複製加入連結。');
      return;
    }
  } catch {
    // Clipboard permission can also block the legacy copy command.
  }
  setStatus(panel, '無法自動複製，已選取連結。請長按或按 Ctrl+C／⌘C 複製。');
}

export function mountShare(root: HTMLElement): void {
  if (mounted.has(root)) return;
  mounted.add(root);
  root.addEventListener('toggle', (event) => {
    if (!(event.target instanceof HTMLDetailsElement) || !event.target.matches('.share-qr-details') || !event.target.open) return;
    const panel = event.target.closest('.share-panel');
    if (panel) showQr(panel);
  }, true);
  root.addEventListener('click', async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-share-action]');
    const panel = button?.closest('.share-panel');
    const input = panel?.querySelector<HTMLInputElement>('[data-share-url]');
    if (!button || !panel || !input) return;
    if (button.dataset.shareAction === 'share' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: '國文段考生存戰', url: input.value });
        setStatus(panel, '已開啟分享。');
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setStatus(panel, '已取消分享。');
          return;
        }
      }
    }
    await copy(panel, input);
  });
}
