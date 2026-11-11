const clamp = (v) => Math.max(0, Math.min(1, v));
let nextId = 0;

// A critically damped spring follows the finger; release momentum decays
// independently, so a held/stationary finger does not produce a fling.
export function advanceMeterMotion(motion, dt) {
  const elapsed = Math.max(0, Math.min(0.05, dt));
  const decay = Math.exp(-12 * elapsed);
  const target = motion.target + (motion.momentum * (1 - decay)) / 12;
  motion.target = clamp(target);
  motion.momentum = target === motion.target ? motion.momentum * decay : 0;
  const omega = 34,
    error = motion.position - motion.target;
  const coefficient = motion.velocity + omega * error;
  const spring = Math.exp(-omega * elapsed);
  motion.position = clamp(
    motion.target + (error + coefficient * elapsed) * spring,
  );
  motion.velocity = (motion.velocity - omega * coefficient * elapsed) * spring;
  return (
    Math.abs(motion.position - motion.target) < 0.0002 &&
    Math.abs(motion.velocity) < 0.004 &&
    Math.abs(motion.momentum) < 0.004
  );
}

export function mountGlassMeter(input) {
  const root = input.parentElement;
  const id = `meter-${++nextId}`;
  root.insertAdjacentHTML(
    "afterbegin",
    `<svg class="meter-surface" aria-hidden="true" focusable="false" preserveAspectRatio="none">
    <defs>
      <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#00d5b2"/><stop offset=".32" stop-color="#02656a"/>
        <stop offset=".53" stop-color="#043749"/><stop offset=".78" stop-color="#056288"/>
        <stop offset="1" stop-color="#12b8e8"/>
      </linearGradient>
      <linearGradient id="${id}-edge" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#d0fff2"/><stop offset=".24" stop-color="#71ffdb"/>
        <stop offset=".6" stop-color="#48e8df"/><stop offset="1" stop-color="#79dfff"/>
      </linearGradient>
      <linearGradient id="${id}-grip" x1="0" y1="0" x2="1" y2="0">
        <stop stop-color="#d1fff5"/><stop offset=".2" stop-color="#efffff"/>
        <stop offset=".5" stop-color="#8dc7d9"/><stop offset=".8" stop-color="#ceeff6"/>
        <stop offset="1" stop-color="#efffff"/>
      </linearGradient>
      <filter id="${id}-glow" x="-30%" y="-100%" width="160%" height="300%" color-interpolation-filters="sRGB">
        <feGaussianBlur stdDeviation="2.5"/>
      </filter>
    </defs>
    <path class="meter-aura" fill="none" stroke="url(#${id}-edge)" stroke-width="3" opacity=".55" filter="url(#${id}-glow)"/>
    <path class="meter-body" fill="url(#${id}-body)" stroke="url(#${id}-edge)" stroke-width="1.2"/>
    <path class="meter-sheen" fill="none" stroke="#ddfff8" stroke-width=".65" opacity=".55"/>
    <g class="meter-grip">
      <rect x="-9" y="17" width="18" height="50" rx="9" fill="url(#${id}-grip)" stroke="#d7fffa" stroke-width="1"/>
      <rect x="-6.5" y="20" width="3" height="43" rx="1.5" fill="#fff" opacity=".38"/>
    </g>
  </svg>`,
  );
  const svg = root.querySelector("svg"),
    body = svg.querySelector(".meter-body");
  const aura = svg.querySelector(".meter-aura"),
    sheen = svg.querySelector(".meter-sheen");
  const grip = svg.querySelector(".meter-grip");
  const abort = new AbortController(),
    reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const motion = { position: 0, target: 0, velocity: 0, momentum: 0 };
  let width = root.clientWidth,
    frame = 0,
    lastFrame = 0,
    pointer = null;
  let emitting = false,
    dead = false,
    publishedAt = -Infinity;
  const maximum = () => Math.max(0, Number(input.max) || 0);

  function draw() {
    if (dead) return;
    const center = 40 + Math.max(0, width - 80) * motion.position;
    const start = Math.max(7, center - 52),
      end = Math.min(width - 7, center + 52);
    const left = Math.min(20, (center - start) * 0.65);
    const right = Math.min(20, (end - center) * 0.65);
    // The rail and bulge are ONE closed contour. There is no rectangular
    // image, join, clipping mask or separate rail beneath the glass.
    const top = `M7 39.5 H${start} C${center - left} 39.5 ${center - left} 12 ${center} 12 C${center + right} 12 ${center + right} 39.5 ${end} 39.5 H${width - 7}`;
    const shape = `${top} A2.5 2.5 0 0 1 ${width - 7} 44.5 H${end} C${center + right} 44.5 ${center + right} 72 ${center} 72 C${center - left} 72 ${center - left} 44.5 ${start} 44.5 H7 A2.5 2.5 0 0 1 7 39.5 Z`;
    svg.setAttribute("viewBox", `0 0 ${width} 84`);
    body.setAttribute("d", shape);
    aura.setAttribute("d", shape);
    sheen.setAttribute("d", top);
    grip.setAttribute("transform", `translate(${center} 0)`);
    root.dataset.visualPosition = motion.position.toFixed(6);
  }
  function publish(force = false) {
    const now = performance.now();
    if (!force && now - publishedAt < 75) return;
    const value = Math.round(motion.position * maximum());
    if (!force && value === Number(input.value)) return;
    input.value = value;
    publishedAt = now;
    emitting = true;
    try {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } finally {
      emitting = false;
    }
  }
  function cancelFrame() {
    cancelAnimationFrame(frame);
    frame = 0;
    root.classList.remove("is-moving");
  }
  function tick(now) {
    frame = 0;
    if (dead) return;
    const settled = advanceMeterMotion(motion, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!pointer && settled) {
      const max = maximum();
      motion.position = max ? Math.round(motion.position * max) / max : 0;
      motion.target = motion.position;
      motion.velocity = motion.momentum = 0;
      draw();
      publish(true);
      root.classList.remove("is-moving");
    } else {
      draw();
      publish();
      if (pointer && settled) root.classList.remove("is-moving");
      else {
        root.classList.add("is-moving");
        frame = requestAnimationFrame(tick);
      }
    }
  }
  function schedule() {
    if (frame || dead) return;
    root.classList.add("is-moving");
    lastFrame = performance.now();
    frame = requestAnimationFrame(tick);
  }
  function stop(commit = false) {
    cancelFrame();
    pointer = null;
    if (commit && maximum())
      motion.position = Math.round(motion.position * maximum()) / maximum();
    motion.target = motion.position;
    motion.velocity = motion.momentum = 0;
    if (commit) publish(true);
    draw();
  }
  function follow() {
    if (reduced.matches) {
      motion.position = motion.target;
      draw();
      publish(true);
    } else schedule();
  }
  function point(event) {
    const box = input.getBoundingClientRect();
    return clamp((event.clientX - box.left - 40) / Math.max(1, box.width - 80));
  }
  function listen(target, name, callback) {
    target.addEventListener(name, callback, { signal: abort.signal });
  }
  listen(root, "pointerdown", (event) => {
    if (
      input.disabled ||
      !maximum() ||
      event.button !== 0 ||
      !event.isPrimary ||
      pointer
    )
      return;
    event.preventDefault();
    input.focus({ preventScroll: true });
    stop();
    const p = point(event),
      span = Math.max(1, input.clientWidth - 80);
    const offset =
      Math.abs(p - motion.position) * span <= 24 ? p - motion.position : 0;
    pointer = {
      id: event.pointerId,
      point: p,
      at: event.timeStamp,
      speed: 0,
      offset,
    };
    root.setPointerCapture(event.pointerId);
    motion.target = clamp(p - offset);
    follow();
  });
  listen(root, "pointermove", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const p = point(event),
      dt = (event.timeStamp - pointer.at) / 1000;
    if (dt > 0.001)
      pointer.speed =
        pointer.speed * 0.35 +
        ((p - pointer.point) / Math.max(0.008, dt)) * 0.65;
    pointer.point = p;
    pointer.at = event.timeStamp;
    motion.target = clamp(p - pointer.offset);
    follow();
  });
  listen(root, "pointerup", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const speed = event.timeStamp - pointer.at > 90 ? 0 : pointer.speed;
    motion.momentum =
      reduced.matches || Math.abs(speed) < 0.03
        ? 0
        : Math.max(-2.4, Math.min(2.4, speed));
    pointer = null;
    if (reduced.matches) stop(true);
    else follow();
  });
  for (const name of ["pointercancel", "lostpointercapture"])
    listen(root, name, () => {
      if (pointer) stop(true);
    });
  listen(input, "keydown", () => stop(true));
  listen(input, "blur", () => stop(true));
  listen(document, "visibilitychange", () => {
    if (document.hidden) stop(true);
  });
  listen(reduced, "change", () => {
    if (reduced.matches) stop(true);
  });
  const observer = new ResizeObserver(() => {
    width = root.clientWidth;
    draw();
  });
  observer.observe(root);
  return {
    sync() {
      root.classList.toggle("is-empty", input.disabled);
      if (emitting) return;
      stop();
      motion.position = maximum() ? clamp(Number(input.value) / maximum()) : 0;
      motion.target = motion.position;
      draw();
    },
    destroy() {
      dead = true;
      cancelFrame();
      abort.abort();
      observer.disconnect();
      svg.remove();
    },
  };
}
