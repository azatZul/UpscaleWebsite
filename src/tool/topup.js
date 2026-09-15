// The top-up panel, shared by on-device and cloud modes. Whoever opens it says
// why (reason), and closes it once their own condition is met. Checkout runs in
// a new tab so the photo and any finished result stay on this page.

export function createTopUp({elements, t, session, trackTap}) {
  const number = value => new Intl.NumberFormat(document.documentElement.lang || 'en').format(value);
  let reason = null;

  function renderAmounts() {
    const list = (session.state.packs || []).slice().sort((a, b) => a.priceCents - b.priceCents);
    const signature = list.map(pack => `${pack.id}:${pack.credits}`).join();
    if (elements['topup-amounts'].dataset.rendered === signature) return;
    elements['topup-amounts'].dataset.rendered = signature;
    elements['topup-amounts'].replaceChildren(...list.map(pack => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-g';
      button.textContent = t('topup_amount', {price: `$${number(pack.priceCents / 100)}`, credits: number(pack.credits)});
      button.addEventListener('click', () => checkout(pack.priceCents));
      return button;
    }));
  }

  async function checkout(amountCents) {
    trackTap('topup', {amount_cents: amountCents, reason});
    // Opened inside the click so no popup blocker intervenes; it goes to Stripe
    // once the session exists.
    const tab = window.open('', '_blank');
    try {
      const {url} = await session.checkout(amountCents);
      if (tab) {
        tab.location.href = url;
        elements['topup-status'].textContent = t('topup_opened');
        elements['topup-status'].hidden = false;
      } else {
        window.location.assign(url);
      }
    } catch {
      tab?.close();
      elements['topup-status'].textContent = t('cloud_network');
      elements['topup-status'].hidden = false;
    }
  }

  elements['topup-refresh'].addEventListener('click', () => { trackTap('topup_refresh', {reason}); session.refresh(); });
  session.subscribe(() => { if (reason) renderAmounts(); });

  return {
    show({title, reason: why}) {
      reason = why;
      elements['topup-title'].textContent = title;
      elements['topup-status'].hidden = true;
      renderAmounts();
      elements['topup-panel'].hidden = false;
    },
    setTitle(title) { if (reason) elements['topup-title'].textContent = title; },
    hide() { reason = null; elements['topup-panel'].hidden = true; },
    isOpen: () => reason !== null,
    reason: () => reason,
  };
}
