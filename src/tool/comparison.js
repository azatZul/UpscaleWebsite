// Uses the website's .cmp/.cmp-bar presentation with pointer and keyboard
// controls. One instance is reused and reset between single-photo sessions.
export function createComparison(frame, before, handle) {
  let position = 50;
  let pointer;
  function setPosition(value) {
    position = Math.max(0, Math.min(100, value));
    handle.style.left = `${position}%`;
    before.style.clipPath = `inset(0 ${100 - position}% 0 0)`;
    handle.setAttribute('aria-valuenow', String(Math.round(position)));
    handle.setAttribute('aria-valuetext', `${Math.round(position)}% original photo`);
  }
  function move(event) {
    const bounds = frame.getBoundingClientRect();
    if (bounds.width) setPosition((event.clientX - bounds.left) / bounds.width * 100);
  }
  frame.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    pointer = event.pointerId;
    frame.setPointerCapture(pointer);
    handle.focus({preventScroll: true});
    move(event);
  });
  frame.addEventListener('pointermove', event => { if (pointer === event.pointerId) move(event); });
  function end(event) {
    if (pointer !== event.pointerId) return;
    if (frame.hasPointerCapture(pointer)) frame.releasePointerCapture(pointer);
    pointer = undefined;
  }
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  frame.addEventListener('lostpointercapture', () => { pointer = undefined; });
  handle.addEventListener('keydown', event => {
    const next = {ArrowLeft: position - 4, ArrowRight: position + 4, Home: 0, End: 100}[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setPosition(next);
  });
  setPosition(50);
  return {reset() { pointer = undefined; setPosition(50); }};
}
