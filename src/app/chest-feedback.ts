export function isChestAction(action: string) {
  return action.startsWith('open-') || action === 'claim' || action.startsWith('target-');
}

export function targetLabel(nickname: string, score: number) {
  return `<span>${nickname}</span><span class="target-score"> · ${score} 分</span>`;
}

export function chestStatus(text: string, canCheck = false) {
  return `<div class="chest-feedback"><p role="status">${text}</p>${canCheck ? '<button type="button" class="secondary" data-action="check-chest">確認保存狀態</button>' : ''}</div>`;
}

function identity(node: Node) {
  if (!(node instanceof Element)) return node.nodeType.toString();
  return `${node.tagName}:${node.getAttribute('data-action') ?? ''}`;
}

function updateChildren(current: ParentNode, next: ParentNode) {
  let previous = current.firstChild;
  for (const incoming of [...next.childNodes]) {
    if (!previous) {
      current.append(incoming);
      continue;
    }
    if (identity(previous) !== identity(incoming)) {
      let following = previous.nextSibling;
      while (following && identity(following) !== identity(incoming)) following = following.nextSibling;
      if (!following) {
        current.insertBefore(incoming, previous);
        continue;
      }
      while (previous && previous !== following) {
        const sibling: ChildNode | null = previous.nextSibling;
        previous.remove();
        previous = sibling;
      }
      previous = following;
    }
    if (!previous.isEqualNode(incoming)) {
      if (previous instanceof Element && incoming instanceof Element) {
        for (const attr of previous.getAttributeNames()) {
          if (!incoming.hasAttribute(attr) && !(previous.tagName === 'DETAILS' && attr === 'open')) {
            previous.removeAttribute(attr);
          }
        }
        for (const attr of incoming.attributes) {
          if (previous.getAttribute(attr.name) !== attr.value) previous.setAttribute(attr.name, attr.value);
        }
        updateChildren(previous, incoming);
      } else {
        previous.nodeValue = incoming.nodeValue;
      }
    }
    previous = previous.nextSibling;
  }
  while (previous) {
    const sibling: ChildNode | null = previous.nextSibling;
    previous.remove();
    previous = sibling;
  }
}

export function renderStudentMarkup(root: HTMLElement, markup: string) {
  const question = root.querySelector('[data-question]')?.getAttribute('data-question');
  if (question) {
    const template = document.createElement('template');
    template.innerHTML = markup;
    if (template.content.querySelector('[data-question]')?.getAttribute('data-question') === question) {
      // A snapshot can arrive between the native button's press and release.
      updateChildren(root, template.content);
      return;
    }
  }
  root.innerHTML = markup;
}

let noticeTimer: number | undefined;
let noticeFrame: number | undefined;

export function clearAttackNotice() {
  window.clearTimeout(noticeTimer);
  if (noticeFrame !== undefined) window.cancelAnimationFrame(noticeFrame);
  document.querySelector('[data-attack-notice]')?.remove();
}

export function notifyAttack(nickname: string) {
  const notice = document.querySelector('[data-attack-notice]') ?? document.createElement('p');
  notice.className = 'attack-notice';
  notice.setAttribute('data-attack-notice', '');
  notice.setAttribute('role', 'status');
  if (!notice.isConnected) document.body.append(notice);
  notice.textContent = '';
  // Leave the live region mounted before announcing, including consecutive attacks by one player.
  window.clearTimeout(noticeTimer);
  if (noticeFrame !== undefined) window.cancelAnimationFrame(noticeFrame);
  noticeFrame = requestAnimationFrame(() => {
    notice.textContent = `${nickname}對你使用了寶箱效果。`;
    noticeTimer = window.setTimeout(() => { notice.textContent = ''; }, 8_000);
  });
}
