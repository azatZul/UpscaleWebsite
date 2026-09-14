// Pan and zoom for the expanded result, ported from the gallery album viewer in
// assets/site.js: wheel and pinch zoom around the pointer, one pointer pans, and
// the photo cannot be dragged past its own edges. site.css already styles the
// expanded stage (touch-action:none, grab cursor) and counter-scales the divider
// from the --album-zoom and --pan-* properties set here.
export const MAX_ZOOM = 6;

// Zoom by factor around a point given relative to the stage centre, so the photo
// pixel under that point stays put.
export function zoomAround(view, factor, x, y) {
  const zoom = Math.max(1, Math.min(MAX_ZOOM, view.zoom * factor));
  return {zoom, panX: x - zoom * (x - view.panX) / view.zoom, panY: y - zoom * (y - view.panY) / view.zoom};
}

// Like a phone's scroll view: a photo smaller than the stage stays centred.
export function clampPan(view, photo, stage) {
  const limitX = Math.max(0, (photo.width * view.zoom - stage.width) / 2);
  const limitY = Math.max(0, (photo.height * view.zoom - stage.height) / 2);
  return {zoom: view.zoom, panX: Math.max(-limitX, Math.min(limitX, view.panX)),
    panY: Math.max(-limitY, Math.min(limitY, view.panY))};
}

export function createPanZoom({root, stage, frame, active}) {
  let view = {zoom: 1, panX: 0, panY: 0};
  let points = [], pinch = null, pan = null, barPoint = null;

  function apply(next) {
    // offsetWidth ignores the zoom transform, so it is the photo's unscaled size.
    view = clampPan(next, {width: frame.offsetWidth, height: frame.offsetHeight}, stage.getBoundingClientRect());
    root.style.setProperty('--album-zoom', view.zoom);
    root.style.setProperty('--pan-x', `${view.panX}px`);
    root.style.setProperty('--pan-y', `${view.panY}px`);
    root.classList.toggle('is-zoomed', view.zoom > 1.01);
  }
  function fromCentre(x, y) {
    const box = stage.getBoundingClientRect();
    return [x - box.left - box.width / 2, y - box.top - box.height / 2];
  }
  const pointAt = id => points.find(point => point.id === id);
  function pinchState() {
    const [a, b] = points;
    return {dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
  }
  function startPan(point) {
    pan = {x: point.x, y: point.y, panX: view.panX, panY: view.panY};
    stage.classList.add('is-panning');
  }
  function endPan() {
    pan = null;
    stage.classList.remove('is-panning');
  }
  // A second finger turns a divider drag into a pinch: cancel the drag and take the pointer.
  function adoptBarPoint() {
    const adopted = barPoint;
    barPoint = null;
    adopted.target.dispatchEvent(new PointerEvent('pointercancel', {pointerId: adopted.id, bubbles: true}));
    stage.setPointerCapture(adopted.id);
    points.push({id: adopted.id, x: adopted.x, y: adopted.y});
  }

  stage.addEventListener('wheel', event => {
    if (!active()) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.02 : 0.0015));
    apply(zoomAround(view, factor, ...fromCentre(event.clientX, event.clientY)));
  }, {passive: false});
  // Firefox has no -webkit-user-drag, so the image drag is cancelled here too.
  stage.addEventListener('dragstart', event => { if (active()) event.preventDefault(); });

  // Capture phase keeps panning and a second pointer away from the comparison drag.
  stage.addEventListener('pointerdown', event => {
    if (!active() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.target.closest('.album-ctl')) return;
    if (!points.length && !barPoint && event.target.closest('.cmp-bar')) {
      barPoint = {id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target};
      return;
    }
    if (barPoint) adoptBarPoint();
    points.push({id: event.pointerId, x: event.clientX, y: event.clientY});
    if (event.cancelable) event.preventDefault();
    stage.setPointerCapture(event.pointerId);
    if (points.length >= 2) { endPan(); pinch = pinchState(); event.stopPropagation(); } else startPan(points[0]);
  }, true);
  stage.addEventListener('pointermove', event => {
    if (barPoint?.id === event.pointerId) { barPoint.x = event.clientX; barPoint.y = event.clientY; }
    const point = pointAt(event.pointerId);
    if (point) { point.x = event.clientX; point.y = event.clientY; }
    if (pinch && points.length >= 2) {
      const now = pinchState();
      // Zoom around the previous midpoint, then follow the midpoint as it moves.
      const zoomed = zoomAround(view, now.dist / pinch.dist, ...fromCentre(pinch.x, pinch.y));
      apply({zoom: zoomed.zoom, panX: zoomed.panX + now.x - pinch.x, panY: zoomed.panY + now.y - pinch.y});
      pinch = now;
      event.stopPropagation();
      return;
    }
    if (pan) apply({zoom: view.zoom, panX: pan.panX + event.clientX - pan.x, panY: pan.panY + event.clientY - pan.y});
  }, true);
  for (const name of ['pointerup', 'pointercancel']) stage.addEventListener(name, event => {
    if (barPoint?.id === event.pointerId) barPoint = null;
    const tracked = pointAt(event.pointerId);
    points = points.filter(point => point.id !== event.pointerId);
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (!tracked) return;
    pinch = null;
    if (points.length === 1) startPan(points[0]);
    else if (!points.length) endPan();
  });

  return {
    reset() {
      points = []; pinch = null; barPoint = null;
      endPan();
      apply({zoom: 1, panX: 0, panY: 0});
    },
    // The stage resized (rotation, window resize): keep the photo inside its edges.
    clamp() { apply(view); },
  };
}
