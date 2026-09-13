// Shared focus, inert-region and scroll locking for full-screen layers.
export function nextFocus(items, current, backwards = false) {
  if (!items.length) return undefined;
  const index = items.indexOf(current);
  if (index < 0) return backwards ? items[items.length - 1] : items[0];
  return items[(index + (backwards ? -1 : 1) + items.length) % items.length];
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const visible = node => !node.hidden && !node.closest('[hidden]') && node.getClientRects().length > 0;
let locks = 0;

export function createOverlay({root, regions, onClose}) {
  let open = false;
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const items = [...root.querySelectorAll(FOCUSABLE)].filter(visible);
    const target = nextFocus(items, document.activeElement, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    target.focus();
  }
  function set(value) {
    if (value === open) return;
    open = value;
    locks += value ? 1 : -1;
    document.body.classList.toggle('album-expanded-lock', locks > 0);
    for (const node of document.querySelectorAll(regions)) node.inert = value;
    value ? document.addEventListener('keydown', onKey) : document.removeEventListener('keydown', onKey);
  }
  return {open: () => set(true), close: () => set(false), isOpen: () => open};
}
