(function () {
  'use strict';

  const ribbon = document.querySelector('.bf-ribbon');
  const offer = document.querySelector('.bf-offer');
  if (!ribbon && !offer) return;

  const { bfStarts, bfEnds } = (ribbon || offer).dataset;
  const starts = Date.parse(bfStarts);
  const ends = Date.parse(bfEnds);
  if (!(starts < ends)) return;

  const code = offer?.querySelector('.bf-code');
  const upcomingStatus = offer?.querySelector('.bf-status-upcoming');
  const endedStatus = offer?.querySelector('.bf-status-ended');
  let timer;

  function updateOffer() {
    clearTimeout(timer);
    const now = Date.now();
    const upcoming = now < starts;
    const ended = now >= ends;
    const active = !upcoming && !ended;

    if (ribbon) ribbon.hidden = !active;
    if (code) code.hidden = !active;
    if (upcomingStatus) upcomingStatus.hidden = !upcoming;
    if (endedStatus) endedStatus.hidden = !ended;

    if (!ended) {
      const nextChange = upcoming ? starts : ends;
      timer = setTimeout(updateOffer, Math.min(nextChange - now, 2147483647));
    }
  }

  updateOffer();
  window.addEventListener('pageshow', updateOffer);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') updateOffer();
  });
})();
