import './style.css';
import { readConfig } from '../firebase/config';

try {
  const demo = new URLSearchParams(location.search).get('demo') === '1';
  if (demo || !readConfig(import.meta.env)) await import('./demo');
  else await import('./cloud');
} catch (error) {
  const root = document.querySelector('#app');
  if (root) {
    const heading = document.createElement('h1');
    heading.textContent = '無法啟動教室';
    const detail = document.createElement('p');
    detail.textContent = error instanceof Error ? error.message : '請檢查連線後重新整理。';
    const link = document.createElement('a');
    link.href = '?demo=1'; link.textContent = '開啟本機示範';
    root.replaceChildren(heading, detail, link);
  }
}
