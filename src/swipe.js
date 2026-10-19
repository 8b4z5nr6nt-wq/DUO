const BLOCKED_TARGETS =
  'button, input, textarea, select, summary, label, [role="button"], a.button, [contenteditable]:not([contenteditable="false"]), [data-no-swipe]';

/** Resolve a deliberate horizontal stroke without consuming vertical scrolling. */
export function classifySwipe({ dx, dy, duration }) {
  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    !Number.isFinite(duration) ||
    duration < 0 ||
    duration > 1000 ||
    Math.abs(dx) < 60 ||
    Math.abs(dx) < Math.abs(dy) * 1.4
  ) {
    return null;
  }
  return dx < 0 ? "next" : "previous";
}

/**
 * Install once on a stable app element. Callbacks can look up the current view;
 * a false return value indicates a boundary, which still consumes the gesture.
 * Surfaces should use touch-action: pan-y pinch-zoom in their stylesheet.
 */
export function installSwipeNavigation(
  root,
  { previous, next, selector = "[data-swipe-surface]" },
) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const clock = () => win?.performance.now() ?? Date.now();
  const contacts = new Set();
  const removers = [];
  let pointer = null;
  let ghostClick = null;
  let wheel = null;

  function listen(target, name, callback, options) {
    target.addEventListener(name, callback, options);
    removers.push(() => target.removeEventListener(name, callback, options));
  }

  function hasSelection() {
    const selection = doc.getSelection();
    return !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
  }

  function surfaceFor(target) {
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    if (!element || !root.contains(element)) return null;
    if (element.closest(BLOCKED_TARGETS)) return null;
    const surface = element.closest(selector);
    return surface && root.contains(surface) ? surface : null;
  }

  function navigate(direction) {
    const callback = direction === "previous" ? previous : next;
    if (typeof callback === "function") return callback() === true;
    return false;
  }

  function reset() {
    contacts.clear();
    pointer = null;
    wheel = null;
    ghostClick = null;
  }

  function pointerDown(event) {
    // A new physical click must never be mistaken for the preceding touch click.
    ghostClick = null;
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    contacts.add(event.pointerId);
    if (contacts.size !== 1 || !event.isPrimary) {
      pointer = null;
      return;
    }
    const surface = surfaceFor(event.target);
    if (!surface || event.button !== 0 || hasSelection()) return;
    pointer = {
      id: event.pointerId,
      surface,
      x: event.clientX,
      y: event.clientY,
      at: clock(),
    };
  }

  function pointerMove(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = Math.abs(event.clientX - pointer.x);
    const dy = Math.abs(event.clientY - pointer.y);
    if (
      !root.contains(pointer.surface) ||
      hasSelection() ||
      (dy > 12 && dy > dx)
    ) {
      pointer = null;
    }
  }

  function pointerUp(event) {
    contacts.delete(event.pointerId);
    if (!pointer || event.pointerId !== pointer.id) return;
    const gesture = pointer;
    pointer = null;
    if (!root.contains(gesture.surface) || hasSelection()) return;
    const direction = classifySwipe({
      dx: event.clientX - gesture.x,
      dy: event.clientY - gesture.y,
      duration: clock() - gesture.at,
    });
    if (!direction) return;
    // Safari may synthesize an anchor click after the pointer sequence. Suppress
    // only that release, even at a navigation boundary or after a DOM refresh.
    ghostClick = {
      x: event.clientX,
      y: event.clientY,
      until: clock() + 500,
    };
    navigate(direction);
  }

  function pointerCancel(event) {
    contacts.delete(event.pointerId);
    if (pointer?.id === event.pointerId) pointer = null;
  }

  function click(event) {
    const release = ghostClick;
    if (!release) return;
    ghostClick = null;
    if (
      event.detail === 0 ||
      clock() > release.until ||
      Math.abs(event.clientX - release.x) > 32 ||
      Math.abs(event.clientY - release.y) > 32
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function wheelMove(event) {
    if (event.ctrlKey || hasSelection()) return;
    const surface = surfaceFor(event.target);
    if (!surface) return;
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? root.clientWidth || win?.innerWidth || 800
          : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    if (Math.abs(dx) < 1 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (event.cancelable) event.preventDefault();
    pointer = null;
    const at = clock();
    const direction = dx > 0 ? "next" : "previous";
    if (!wheel || wheel.surface !== surface || at - wheel.lastAt > 180) {
      wheel = {
        surface,
        direction,
        total: 0,
        lastAt: at,
        locked: false,
        cooldownUntil: wheel?.cooldownUntil ?? 0,
      };
    }
    wheel.lastAt = at;
    if (wheel.locked) return;
    if (at < wheel.cooldownUntil) {
      wheel.locked = true;
      return;
    }
    if (wheel.direction !== direction) {
      wheel.direction = direction;
      wheel.total = 0;
    }
    wheel.total += Math.abs(dx);
    if (wheel.total < 80) return;
    wheel.locked = true;
    wheel.cooldownUntil = at + 450;
    navigate(direction);
  }

  const capturePassive = { capture: true, passive: true };
  listen(doc, "pointerdown", pointerDown, capturePassive);
  listen(doc, "pointermove", pointerMove, capturePassive);
  listen(doc, "pointerup", pointerUp, capturePassive);
  listen(doc, "pointercancel", pointerCancel, capturePassive);
  listen(doc, "selectionchange", () => {
    if (hasSelection()) pointer = null;
  });
  listen(doc, "visibilitychange", () => {
    if (doc.hidden) reset();
  });
  if (win) listen(win, "blur", reset);
  listen(root, "click", click, { capture: true });
  listen(root, "wheel", wheelMove, { passive: false });

  return () => {
    reset();
    for (const remove of removers) remove();
  };
}
