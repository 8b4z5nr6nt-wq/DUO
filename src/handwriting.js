export const MAX_STROKES = 256;
export const MAX_POINTS = 20000;

export function emptyDrawing() {
  return { version: 1, width: 1000, height: 500, strokes: [] };
}

/** Validate untrusted backups and keep only bounded numeric drawing data. */
export function normalizeDrawing(value) {
  const fail = () => {
    throw Error("手書き回答の形式が不正です。");
  };
  if (
    !value ||
    value.version !== 1 ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width < 100 ||
    value.width > 4000 ||
    value.height < 100 ||
    value.height > 4000 ||
    value.width / value.height < 0.25 ||
    value.width / value.height > 8 ||
    !Array.isArray(value.strokes) ||
    value.strokes.length > MAX_STROKES
  )
    fail();
  let count = 0;
  const strokes = value.strokes.map((stroke) => {
    if (
      !Array.isArray(stroke) ||
      !stroke.length ||
      stroke.length > MAX_POINTS - count
    )
      fail();
    count += stroke.length;
    return stroke.map((point) => {
      if (
        !point ||
        ![point.x, point.y, point.p].every(
          (n) =>
            typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
        )
      )
        fail();
      return { x: point.x, y: point.y, p: point.p };
    });
  });
  return {
    version: 1,
    width: value.width,
    height: value.height,
    strokes,
  };
}

export function hasInk(value) {
  try {
    return normalizeDrawing(value).strokes.length > 0;
  } catch {
    return false;
  }
}

const clamp = (n) => Math.min(1, Math.max(0, n));
const round = (n) => Math.round(n * 100000) / 100000;
const clone = (drawing) => ({
  version: 1,
  width: drawing.width,
  height: drawing.height,
  strokes: drawing.strokes.map((stroke) =>
    stroke.map((point) => ({ ...point })),
  ),
});

/**
 * Mount a local vector writing surface, or a read-only rendering of an answer.
 * Coordinates are normalized; the original aspect ratio is always preserved.
 * Call destroy before removing the canvas to release observers and listeners.
 */
export function mountHandwriting(
  canvas,
  {
    drawing: initial = emptyDrawing(),
    onChange = () => {},
    onLimit = () => {},
    readOnly = false,
    disabled: initialDisabled = false,
  } = {},
) {
  const win = canvas.ownerDocument.defaultView;
  const context = canvas.getContext("2d");
  if (!context || !win) throw Error("この端末では手書き入力を利用できません。");
  let drawing = normalizeDrawing(initial);
  let points = drawing.strokes.reduce((n, stroke) => n + stroke.length, 0);
  let disabled = !!initialDisabled;
  let active = null;
  let frame = 0;
  let destroyed = false;
  let notifiedLimit = false;
  const removers = [];
  const originalTouchAction = canvas.style.touchAction;
  const originalAspectRatio = canvas.style.aspectRatio;
  canvas.style.touchAction = readOnly ? "auto" : "none";
  if (readOnly)
    canvas.style.aspectRatio = `${drawing.width} / ${drawing.height}`;

  function listen(target, event, callback, options) {
    target.addEventListener(event, callback, options);
    removers.push(() => target.removeEventListener(event, callback, options));
  }

  function bounds() {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(
      rect.width / drawing.width,
      rect.height / drawing.height,
    );
    return {
      rect,
      scale,
      left: (rect.width - drawing.width * scale) / 2,
      top: (rect.height - drawing.height * scale) / 2,
    };
  }

  function fitEmptySurface() {
    if (readOnly || drawing.strokes.length) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    drawing.width = 1000;
    drawing.height = Math.max(
      125,
      Math.min(4000, Math.round((1000 * rect.height) / rect.width)),
    );
  }

  function render() {
    frame = 0;
    if (destroyed) return;
    fitEmptySurface();
    const { rect, scale, left, top } = bounds();
    if (!rect.width || !rect.height || !Number.isFinite(scale)) return;
    const ratio = Math.min(3, Math.max(1, win.devicePixelRatio || 1));
    const width = Math.max(1, Math.min(8192, Math.round(rect.width * ratio)));
    const height = Math.max(1, Math.min(8192, Math.round(rect.height * ratio)));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.setTransform(width / rect.width, 0, 0, height / rect.height, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);

    if (!readOnly) {
      context.strokeStyle = "rgba(90, 140, 190, 0.17)";
      context.lineWidth = 1;
      context.lineCap = "butt";
      for (const y of [0.25, 0.5, 0.75]) {
        context.beginPath();
        context.moveTo(left, top + y * drawing.height * scale);
        context.lineTo(
          left + drawing.width * scale,
          top + y * drawing.height * scale,
        );
        context.stroke();
      }
    }
    context.strokeStyle = "#183e6a";
    context.fillStyle = "#183e6a";
    context.lineCap = "round";
    context.lineJoin = "round";
    const position = (p) => ({
      x: left + p.x * drawing.width * scale,
      y: top + p.y * drawing.height * scale,
    });
    const thickness = (pressure) =>
      drawing.width * 0.004 * (0.35 + pressure) * scale;
    for (const stroke of drawing.strokes) {
      const start = position(stroke[0]);
      context.beginPath();
      context.arc(start.x, start.y, thickness(stroke[0].p) / 2, 0, Math.PI * 2);
      context.fill();
      for (let i = 1; i < stroke.length; i++) {
        const from = position(stroke[i - 1]);
        const to = position(stroke[i]);
        context.lineWidth = thickness((stroke[i - 1].p + stroke[i].p) / 2);
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
      }
    }
  }

  function repaint() {
    if (!frame && !destroyed) frame = win.requestAnimationFrame(render);
  }

  function changed() {
    repaint();
    onChange(clone(drawing));
  }

  function limit(kind) {
    if (!notifiedLimit) {
      notifiedLimit = true;
      onLimit({ kind, maximum: kind === "strokes" ? MAX_STROKES : MAX_POINTS });
    }
  }

  function stop() {
    if (!active) return;
    const id = active.id;
    active = null;
    try {
      if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    } catch {
      // Safari may release capture before dispatching pointercancel.
    }
  }

  function eventPoint(event, allowOutside = true) {
    const { rect, scale, left, top } = bounds();
    if (!rect.width || !rect.height || !scale) return null;
    const x = (event.clientX - rect.left - left) / (drawing.width * scale);
    const y = (event.clientY - rect.top - top) / (drawing.height * scale);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (!allowOutside && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
    const previous = active?.stroke.at(-1);
    const pressure = event.pressure > 0 ? event.pressure : (previous?.p ?? 0.5);
    return {
      x: round(clamp(x)),
      y: round(clamp(y)),
      p: round(clamp(pressure)),
    };
  }

  function down(event) {
    if (readOnly || disabled || event.button !== 0 || event.isPrimary === false)
      return;
    if (active) {
      if (event.pointerType !== "pen" || active.type === "pen") return;
      // Prefer the pencil if a palm contact arrived just before it.
      points -= active.stroke.length;
      drawing.strokes.pop();
      stop();
      changed();
    }
    fitEmptySurface();
    const point = eventPoint(event, false);
    if (!point) return;
    event.preventDefault();
    notifiedLimit = false;
    if (drawing.strokes.length >= MAX_STROKES) return limit("strokes");
    if (points >= MAX_POINTS) return limit("points");
    const stroke = [point];
    drawing.strokes.push(stroke);
    points++;
    active = { id: event.pointerId, type: event.pointerType, stroke };
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Window listeners also finish strokes when pointer capture is unavailable.
    }
    changed();
  }

  function append(event) {
    if (!active || disabled || event.pointerId !== active.id) return;
    event.preventDefault();
    let events;
    try {
      events = event.getCoalescedEvents?.();
    } catch {
      // Older Safari implementations may expose but not support this method.
    }
    if (!events?.length) events = [event];
    let updated = false;
    for (const sample of events) {
      const point = eventPoint(sample);
      if (!point) continue;
      const previous = active.stroke.at(-1);
      if (point.x === previous.x && point.y === previous.y) continue;
      if (points >= MAX_POINTS) {
        limit("points");
        break;
      }
      active.stroke.push(point);
      points++;
      updated = true;
    }
    if (updated) changed();
  }

  function up(event) {
    if (event.pointerId !== active?.id) return;
    append(event);
    stop();
  }

  if (!readOnly) {
    listen(canvas, "pointerdown", down, { passive: false });
    listen(win, "pointermove", append, { passive: false });
    listen(win, "pointerup", up, { passive: false });
    listen(win, "pointercancel", (event) => {
      if (event.pointerId === active?.id) stop();
    });
    listen(canvas, "lostpointercapture", (event) => {
      if (event.pointerId === active?.id) stop();
    });
    listen(win, "blur", stop);
    listen(canvas.ownerDocument, "visibilitychange", () => {
      if (canvas.ownerDocument.hidden) stop();
    });
  }
  const observer = win.ResizeObserver ? new win.ResizeObserver(repaint) : null;
  if (observer) observer.observe(canvas);
  listen(win, "resize", repaint);
  repaint();

  return {
    getDrawing: () => clone(drawing),
    setDrawing(value) {
      if (destroyed) return;
      const next = normalizeDrawing(value);
      stop();
      drawing = next;
      if (readOnly)
        canvas.style.aspectRatio = `${drawing.width} / ${drawing.height}`;
      points = drawing.strokes.reduce((n, stroke) => n + stroke.length, 0);
      changed();
    },
    setDisabled(value) {
      disabled = !!value;
      if (disabled) stop();
    },
    undo() {
      if (readOnly || disabled || destroyed) return;
      stop();
      const stroke = drawing.strokes.pop();
      if (stroke) {
        points -= stroke.length;
        changed();
      }
    },
    clear() {
      if (readOnly || disabled || destroyed) return;
      stop();
      drawing.strokes = [];
      points = 0;
      notifiedLimit = false;
      changed();
    },
    destroy() {
      stop();
      destroyed = true;
      if (frame) win.cancelAnimationFrame(frame);
      observer?.disconnect();
      removers.forEach((remove) => remove());
      canvas.style.touchAction = originalTouchAction;
      canvas.style.aspectRatio = originalAspectRatio;
    },
  };
}
