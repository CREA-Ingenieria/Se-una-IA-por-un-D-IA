// Fondo interactivo: una retícula de caracteres casi invisible que se enciende
// en turquesa alrededor del puntero (o del dedo en iPad) y deja una estela corta.
// Un clic o toque lanza una onda que se expande. Respeta prefers-reduced-motion.
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0";
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");
  const base = document.createElement("canvas");
  const bctx = base.getContext("2d");

  const GLYPHS = "01アイウエオカキクケコサシスセソタチツテトナニヌネノ<>/*#%+=ABCDEFIA".split("");
  const CW = 16, CH = 20, RADIUS = 130;
  let W = 0, H = 0, dpr = 1, cols = 0, rows = 0;
  let chars = [], energy;
  const waves = [];
  let px = -999, py = -999, running = false, last = 0;

  const pick = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    for (const c of [canvas, base]) { c.width = W * dpr; c.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(W / CW); rows = Math.ceil(H / CH);
    chars = Array.from({ length: cols * rows }, pick);
    energy = new Float32Array(cols * rows);
    bctx.clearRect(0, 0, W, H);
    bctx.font = "13px 'Share Tech Mono', ui-monospace, monospace";
    bctx.textBaseline = "top";
    bctx.fillStyle = "rgba(0,175,201,0.07)";
    for (let i = 0; i < chars.length; i++) {
      bctx.fillText(chars[i], (i % cols) * CW + 3, ((i / cols) | 0) * CH + 3);
    }
    draw();
  }

  function excite(x, y, r, amount) {
    const c0 = Math.max(0, ((x - r) / CW) | 0), c1 = Math.min(cols - 1, ((x + r) / CW) | 0);
    const r0 = Math.max(0, ((y - r) / CH) | 0), r1 = Math.min(rows - 1, ((y + r) / CH) | 0);
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
      const dx = cc * CW + CW / 2 - x, dy = rr * CH + CH / 2 - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r) continue;
      const i = rr * cols + cc, e = amount * (1 - d / r);
      if (e > energy[i]) { energy[i] = e; if (Math.random() < 0.35) chars[i] = pick(); }
    }
  }

  function draw() {
    if (!W || !H) return false; // pestaña oculta o sin tamaño todavía
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0, W, H);
    ctx.font = "13px 'Share Tech Mono', ui-monospace, monospace";
    ctx.textBaseline = "top";
    let alive = false;
    for (let i = 0; i < energy.length; i++) {
      const e = energy[i];
      if (e < 0.02) continue;
      alive = true;
      ctx.fillStyle = e > 0.75 ? `rgba(235,255,255,${e * 0.7})` : `rgba(0,175,201,${e * 0.65})`;
      ctx.fillText(chars[i], (i % cols) * CW + 3, ((i / cols) | 0) * CH + 3);
    }
    return alive;
  }

  function frame(t) {
    const dt = Math.min(64, t - (last || t)); last = t;
    const decay = Math.pow(0.9, dt / 16);
    for (let i = 0; i < energy.length; i++) energy[i] *= decay;
    for (let k = waves.length - 1; k >= 0; k--) {
      const w = waves[k];
      w.r += dt * 0.6;
      // anillo: excita solo el borde de la onda
      const ring = 26;
      const c0 = Math.max(0, ((w.x - w.r) / CW) | 0), c1 = Math.min(cols - 1, ((w.x + w.r) / CW) | 0);
      const r0 = Math.max(0, ((w.y - w.r) / CH) | 0), r1 = Math.min(rows - 1, ((w.y + w.r) / CH) | 0);
      for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
        const dx = cc * CW + CW / 2 - w.x, dy = rr * CH + CH / 2 - w.y;
        const off = Math.abs(Math.sqrt(dx * dx + dy * dy) - w.r);
        if (off < ring) { const i = rr * cols + cc, e = w.a * (1 - off / ring); if (e > energy[i]) energy[i] = e; }
      }
      w.a *= 0.985;
      if (w.r > Math.max(W, H) * 0.6 || w.a < 0.05) waves.splice(k, 1);
    }
    const alive = draw();
    if (alive || waves.length) requestAnimationFrame(frame);
    else { running = false; last = 0; }
  }
  function wake() { if (!running) { running = true; requestAnimationFrame(frame); } }

  if (reduce) { window.addEventListener("resize", resize); resize(); return; }

  window.addEventListener("pointermove", (e) => {
    const nx = e.clientX, ny = e.clientY;
    // interpolar para que movimientos rápidos dejen una estela continua
    const steps = px < -900 ? 1 : Math.min(8, Math.ceil(Math.hypot(nx - px, ny - py) / 24));
    for (let s = 1; s <= steps; s++) {
      excite(px < -900 ? nx : px + (nx - px) * s / steps, py < -900 ? ny : py + (ny - py) * s / steps, RADIUS, 0.85);
    }
    px = nx; py = ny; wake();
  }, { passive: true });
  window.addEventListener("pointerdown", (e) => { waves.push({ x: e.clientX, y: e.clientY, r: 0, a: 0.9 }); wake(); }, { passive: true });
  window.addEventListener("pointerleave", () => { px = py = -999; });
  window.addEventListener("resize", resize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
  resize();
})();
