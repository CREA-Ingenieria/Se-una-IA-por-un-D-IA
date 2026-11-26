// Sé una IA por un d-IA — cliente (alpha)
// La misma página sirve a los PCs/iPads de la sala (/) y al panel del admin (/admin).
// El servidor manda una "vista" ya filtrada por rol; aquí solo se dibuja y se envían acciones.

const ROLES = ["modelo", "arnes", "revisor"];
const RN = { modelo: "Modelo", arnes: "Arnés", revisor: "Revisor", profesor: "Usuario" };
const RC = { modelo: "var(--m)", arnes: "var(--a)", revisor: "var(--r)", profesor: "var(--y)" };
const RHEX = { modelo: "#D32985", arnes: "#9A6400", revisor: "#0051C6", profesor: "#6E6800" };
const RTX = { modelo: "#fff", arnes: "#000", revisor: "#fff", profesor: "#000" };
const ARTICLE = { modelo: "EL MODELO", arnes: "EL ARNÉS", revisor: "EL REVISOR" };
// La frase que define cada rol
const PHRASE = { modelo: "Piensa", arnes: "Ejecuta lo que diga el Modelo", revisor: "Describe las acciones del Arnés" };
const CHN = { U: "Usuario ↔ Modelo", C: "Modelo → Arnés", R: "Revisor → Modelo" };
// a quién puede escribir cada rol: destino → [canal, nombre, ayuda del campo]
const DEST = {
  modelo: { arnes: ["C", "Arnés", "Órdenes para el Arnés…"], usuario: ["U", "Usuario", "Escríbele al Usuario…"] },
  revisor: { modelo: ["R", "Modelo", "Describe al Modelo lo que hace el Arnés…"] },
};
// componentes que llenan el contexto, en el orden de la barra
const PARTS = ["profesor", "modelo", "revisor"];
// Reglas que cada rol ve siempre a un lado del chat
const RULES = {
  modelo: [
    "Piensas el plan. Eres el único que habla con el Usuario.",
    "Para escribirle al Usuario entras a una cola y esperas tu turno. Cuando te atiende, conversan al instante.",
    "Después de cada conversación con el Usuario debes esperar un rato antes de volver a escribirle.",
    "Le das órdenes al Arnés y recibes la retroalimentación del Revisor. Sus fotos, videos y audios se los puedes reenviar al Usuario.",
    "No le escribes al Revisor.",
  ],
  arnes: [
    "Eres el ejecutor: haces con los materiales lo que diga el Modelo.",
    "Recibes las órdenes del Modelo y ves la retroalimentación que el Revisor le manda al Modelo.",
    "No escribes ni hablas con el Usuario.",
  ],
  revisor: [
    "Describes las acciones del Arnés: qué hace y cómo va.",
    "Solo le escribes al Modelo: reportes, fotos, videos o audios del avance. El Arnés también lo lee.",
    "No le escribes al Arnés ni al Usuario, y no ves lo que escribe el Modelo.",
    "No tocas los materiales.",
  ],
};
const AUTHORS = ["David Octavio Ibarra", "Sebastián Suárez", "Francisco Santamaría", "Ángel Peñaranda"];
const credits = () => `<footer class="credits">Creado por ${AUTHORS.map(esc).join(" · ")} y el equipo CREA · Facultad de Ingeniería, Universidad de los Andes</footer>`;
const clipIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3L15 7.5"/></svg>`;
const camIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="14" r="3.5"/></svg>`;
const HINT = {
  modelo: "Piensa. Recibes el encargo del Usuario y la retroalimentación del Revisor, y lo conviertes en órdenes claras para el Arnés. Para hablar con el Usuario haces fila.",
  arnes: "Ejecuta lo que diga el Modelo. Lees sus órdenes y lo que el Revisor le reporta al Modelo, y construyes con las manos. No escribes.",
  revisor: "Describe las acciones del Arnés. Miras lo que construye y se lo cuentas al Modelo, con texto, fotos, videos o audios. No ves lo que escribe el Modelo.",
};

const IS_ADMIN = location.pathname.replace(/\/+$/, "") === "/admin";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mmss = (s) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
// etiqueta física de un puesto: "B3" (tablero) o "PC 5" (sin tablero)
const whereL = (w) => (w && w.label) ? w.label : "";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};

// id estable de ESTE teléfono (su dueño). El servidor lo usa para seguir a la persona a su asiento actual.
function browserId() {
  let id = store.get("seunaia-device");
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    store.set("seunaia-device", id);
  }
  return id;
}

const L = { view: null, connected: false, err: "", toast: null, answer: null, adminTeam: null, confirm: null, hintUntil: 0, lastRole: null, seen: new Set(), lastHtml: "", firstPaint: true,
  to: null, rulesOpen: true, picking: false, sending: false, skew: 0,
  // sala: la sala de este teléfono/admin (viaja en la dirección: ?sala=2) · salas: las que tiene el servidor
  sala: new URLSearchParams(location.search).get("sala") || null, salas: [] };

// ---------- Salas simultáneas ----------
// El QR de cada sala trae ?sala=N. Sin sala, el teléfono escoge en un selector y el admin al entrar.
const multiSala = () => L.salas.length > 1;
const adminKey = (sala) => "seunaia-admin-" + (sala || "1"); // un token de admin por sala
function setSala(id) {
  L.sala = id || null;
  if (L.salas.length === 1) return; // con una sola sala la dirección queda limpia
  try {
    const u = new URL(location.href);
    if (L.sala) u.searchParams.set("sala", L.sala); else u.searchParams.delete("sala");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
  } catch (_) { /* navegador sin URL/history: la sala sigue en memoria */ }
}
const salaQ = () => (L.sala && multiSala() ? "?sala=" + encodeURIComponent(L.sala) : "");
// segundos que faltan para un instante del reloj del servidor
const secsTo = (at) => Math.max(0, Math.ceil((at - (Date.now() + L.skew)) / 1000));
const socket = io({ reconnectionDelay: 800, reconnectionDelayMax: 4000 });

function toast(text) { L.toast = { text, until: Date.now() + 3200 }; render(); }
function emit(ev, data) {
  return new Promise((res) => socket.timeout(6000).emit(ev, data || {}, (err, r) => {
    if (err) { toast("Sin respuesta del servidor. Revisa la conexión."); return res({ error: "timeout" }); }
    if (r && r.error) toast(r.error);
    res(r || {});
  }));
}

// El teléfono saluda con su sala. Si ya juega en otra, el servidor lo devuelve a esa; si no tiene sala, escoge.
function hello() {
  emit("hello", { browserId: browserId(), sala: L.sala }).then((r) => {
    if (!r.ok) return;
    if (r.salas) L.salas = r.salas;
    if (r.sala && L.sala && r.sala !== L.sala) toast(`Este teléfono ya está jugando en la ${r.salaName}.`);
    setSala(r.sala);
    if (!r.sala) { L.view = { kind: "pick" }; render(); }
  });
}
// el admin vuelve a entrar solo si ya tiene un token de esa sala
function tryToken(sala) {
  const token = sala && store.get(adminKey(sala));
  if (!token) return;
  // si el token ya no sirve (p. ej. el servidor se reinició), vuelve a pedir la clave en vez de dejar un panel congelado
  emit("admin:login", { token, sala }).then((r) => { if (!r.ok) { store.del(adminKey(sala)); if (L.view && L.view.kind === "admin") L.view = null; render(); } });
}
socket.on("connect", () => {
  L.connected = true;
  if (!IS_ADMIN) hello(); // el admin espera la lista de salas (llega al conectar) para entrar
  render();
});
// el servidor manda sus salas en CADA conexión (también al reconectar). Cada conexión es un socket nuevo sin
// sala, así que el admin siempre vuelve a entrar con el token de su sala (si no, quedaría un panel congelado).
socket.on("salas", (list) => {
  L.salas = Array.isArray(list) ? list : [];
  if (IS_ADMIN) {
    if (!L.sala && L.salas.length === 1) setSala(L.salas[0].id);
    tryToken(L.sala);
  }
  render();
});
socket.on("disconnect", () => { L.connected = false; render(); });
socket.on("view", (v) => {
  const prev = L.view;
  L.view = v;
  if (v.now) L.skew = v.now - Date.now();
  // si el rol de este PC cambió (rotación), mostrar la pista del nuevo rol unos segundos
  if (v.kind === "device" && v.you && prev && prev.you && prev.phase === "rotate" && v.phase === "activity") { L.hintUntil = Date.now() + 10000; L.rulesOpen = true; L.to = null; }
  // Modelo: avisar cuando el Usuario lo empieza a atender, y escribirle a él por defecto
  const wasLive = !!(prev && prev.usuario && prev.usuario.live), isLive = !!(v.usuario && v.usuario.live);
  if (isLive && !wasLive) { L.to = "usuario"; toast("¡El Usuario te está atendiendo! Los mensajes llegan al instante."); }
  if (!isLive && wasLive) { L.to = null; toast("El Usuario terminó la conversación."); }
  // admin: avisar cuando un Modelo marca una tarea como terminada
  if (v.kind === "admin" && prev && prev.kind === "admin" && v.tasks && prev.tasks) {
    v.tasks.forEach((k) => {
      const old = (prev.tasks.find((x) => x.id === k.id) || {}).done || {};
      Object.entries(k.done || {}).forEach(([t, d]) => { if (!old[t] && d.by === "modelo") toast(`El Modelo del equipo ${+t + 1} terminó la Tarea ${k.id}.`); });
    });
  }
  // admin: avisar cuando abre una conversación con un Modelo
  if (v.kind === "admin" && v.live && !(prev && prev.live && prev.live.team === v.live.team)) toast(`El Modelo del equipo ${v.live.team + 1} te escribió.`);
  render();
});
// el admin liberó este iPad: se olvida su puesto y vuelve a la pantalla de inicio
socket.on("released", () => {
  store.del("seunaia-device");
  L.view = null;
  hello();
  toast("El admin liberó tu puesto. Entra con tu nickname para volver a él.");
});

// ---------- Piezas ----------
const bean = (role, cls = "") => `<div class="bean ${cls}" style="background:${RC[role]}" aria-hidden="true"><i></i></div>`;
const rolePill = (role, txt) => `<span class="pill" style="background:${RC[role]};color:${RTX[role]}">${esc(txt || RN[role].toUpperCase())}</span>`;
// barra de contexto partida por colores: cuánto ocupa cada componente
function ctxBar(by, limit, cls = "") {
  const segs = PARTS.filter((p) => by[p]).map((p) => `<span style="width:${Math.min(100, (by[p] / limit) * 100)}%;background:${RC[p]}" title="${RN[p]}: ${by[p]}"></span>`).join("");
  return `<div class="bar ctx ${cls}" role="img" aria-label="${PARTS.map((p) => `${RN[p]} ${by[p] || 0}`).join(", ")} de ${limit} caracteres">${segs}</div>`;
}
const ctxLegend = (by) => `<div class="legend">${PARTS.map((p) => `<span><i style="background:${RC[p]}"></i>${RN[p]} <b>${by[p] || 0}</b></span>`).join("")}</div>`;
const logos = () => `<img class="logo-crea" src="/assets/crea.png" alt="CREA"><img class="logo-ua" src="/assets/uniandes-blanco.png" alt="Universidad de los Andes, Facultad de Ingeniería">`;
function topbar(extra = "") {
  return `<div class="topbar"><div class="grp"><img class="logo-crea" src="/assets/crea.png" alt="CREA">${extra}</div>
    <div class="grp"><span class="conn${L.connected ? "" : " off"}"><i></i>${L.connected ? "Conectado" : "Reconectando…"}</span><img class="logo-ua" src="/assets/uniandes-blanco.png" alt="Universidad de los Andes, Facultad de Ingeniería"></div></div>`;
}

// ---------- Vistas de los PCs ----------
// nombre de la sala (solo cuando el servidor tiene varias)
const salaTag = (v) => (v && v.sala && v.sala.multi ? `<span class="pill" style="background:var(--t);color:#000">${esc(v.sala.name.toUpperCase())}</span>` : "");
const lockup = (delay) => `<h1 class="lockup anim" style="animation-delay:${delay}s" aria-label="Sé una IA por un día"><span class="lines"><span class="dots">SÉ UNA</span><span class="dots">POR UN D-</span></span><span class="dots ia">IA</span></h1>`;
// Selector de sala: lo ve quien abre la dirección sin ?sala (el QR de cada sala ya la trae)
function vPick() {
  const fase = { lobby: "esperando", activity: "en curso", rotate: "en curso", end: "terminó" };
  const btns = L.salas.map((s) => `<button type="button" class="btn white" style="min-height:72px;flex-direction:column;gap:2px;display:flex;align-items:center;justify-content:center" data-act="sala" data-sala="${esc(s.id)}"${L.connected ? "" : " disabled"}>
      <b style="font-size:18px;letter-spacing:.08em">${esc(s.name.toUpperCase())}</b><span style="font-size:12px;font-weight:500;opacity:.7">${esc(fase[s.phase] || "")}${s.online ? ` · ${s.online} conectados` : ""}</span></button>`).join("");
  return `<div class="landing">
  <div class="top anim">${logos()}</div>
  <div class="center">
    ${lockup(0.05)}
    <div class="joinbox anim" style="animation-delay:.2s">
      <span class="field"><span>¿EN QUÉ SALA ESTÁS?</span></span>
      <div class="roles">${btns || `<span class="muted">Cargando salas…</span>`}</div>
      <p class="muted" style="margin:0;font-size:13px;text-align:center">Tu profesor te dice cuál. Si escaneas el QR de tu sala, entras directo.</p>
      <a class="btn dark" style="align-self:center;display:inline-flex;align-items:center;text-decoration:none" href="/admin">Soy el admin</a>
    </div>
  </div></div>`;
}
function vLanding() {
  const late = L.view && L.view.phase !== "lobby";
  const sala = L.view && L.view.sala && L.view.sala.multi ? L.view.sala : null;
  return `<div class="landing">
  <div class="top anim">${logos()}</div>
  <div class="center">
    <div class="rings anim" style="animation-delay:.05s"><span class="ring"><i style="background:var(--m)"></i></span><span class="ring"><i style="background:var(--a)"></i></span><span class="ring"><i style="background:var(--r)"></i></span><span class="tp">3 personas · 1 agente</span></div>
    ${lockup(0.12)}
    ${sala ? `<div class="row anim" style="animation-delay:.2s;justify-content:center;gap:10px">${salaTag(L.view)}<button type="button" class="btn dark sm" data-act="changeSala">Cambiar de sala</button></div>` : ""}
    <form class="joinbox anim" style="animation-delay:.3s" data-submit="noop">
      <label class="field"><span>TU NICKNAME</span><input class="input" id="nick" maxlength="16" autocomplete="off" autocapitalize="off" placeholder="robotina_42"></label>
      <span class="field"><span>ESCOGE EL ROL DE TU MESA</span></span>
      <div class="roles">${ROLES.map((r) => `<button type="button" class="btn" style="background:${RC[r]};color:${RTX[r]}" data-act="join" data-role="${r}"${L.connected ? "" : " disabled"}>${RN[r].toUpperCase()}</button>`).join("")}</div>
      <div class="err" role="status">${esc(L.err || (late ? "La actividad ya empezó: entra y el admin te asignará a un equipo." : ""))}</div>
      <div class="back"><span>¿Ya estabas jugando y se te cerró o cambiaste de iPad?</span>
        <button type="button" class="btn white sm" data-act="reclaim"${L.connected ? "" : " disabled"}>Volver a mi puesto con este nickname</button></div>
      <a class="btn dark" style="align-self:center;display:inline-flex;align-items:center;text-decoration:none" href="/admin${salaQ()}">Soy el admin</a>
    </form>
  </div>
  <section class="authors anim" style="animation-delay:.45s" aria-label="Autoría">
    <span class="lbl">CREADO POR</span>
    <p class="names">${AUTHORS.map((n) => `<span>${esc(n)}</span>`).join("")}</p>
    <p class="org">y el <b>equipo CREA</b> · Facultad de Ingeniería, Universidad de los Andes</p>
  </section></div>`;
}

function vWaiting(v) {
  const r = v.you.role;
  const unassigned = v.you.team === null;
  return `${topbar(`${salaTag(v)}<span class="muted" style="font-size:13px">Sesión ${esc(v.code)}</span>`)}<div class="stage">
    <span class="muted" style="font-size:12px;letter-spacing:.3em;font-weight:600">TU PUESTO: ${esc(whereL(v.you.where))}${v.you.nick ? " · " + esc(v.you.nick) : ""}</span>
    ${rolePill(r, "ERES " + ARTICLE[r])}
    <div class="phrase" style="color:${RC[r]}">${esc(RN[r])}: ${esc(PHRASE[r])}</div>
    <div class="hintcard anim">${bean(r, "lg")}<div><b style="font-size:11px;letter-spacing:.14em;color:${RHEX[r]}">PISTA</b><p style="margin:4px 0 0;font-size:15px;line-height:1.45">${HINT[r]}</p></div></div>
    <div class="card rules" style="width:min(560px,100%);text-align:left">${rulesList(r, false)}</div>
    <div class="spin" role="img" aria-label="Cargando"></div>
    <div style="font-size:13px;font-weight:600;letter-spacing:.2em">${unassigned ? "ESPERANDO A QUE EL ADMIN TE ASIGNE UN EQUIPO" : `ESPERANDO JUGADORES · <b class="dots" style="font-size:22px">${v.counts.online}</b> CONECTADOS`}</div>
  </div>`;
}

// Casilla de reglas del rol (siempre visible en el chat; se puede plegar)
function rulesList(r, foldable) {
  const items = RULES[r].map((x) => `<li>${esc(x)}</li>`).join("");
  const title = `<span class="rt" style="color:${RC[r]}">REGLAS DE TU ROL · ${RN[r].toUpperCase()}${r === "arnes" ? " (EJECUTOR)" : ""}</span>`;
  const phrase = `<p class="rphrase" style="border-color:${RC[r]}">${esc(RN[r])}: <b>${esc(PHRASE[r])}</b></p>`;
  if (!foldable) return `${title}${phrase}<ul>${items}</ul>`;
  return `<details id="rules"${L.rulesOpen ? " open" : ""}><summary>${title}</summary>${phrase}<ul>${items}</ul></details>`;
}

// foto, video, audio u otro archivo dentro de un mensaje
function fileView(f, small) {
  if (!f) return "";
  const u = esc(f.url);
  if (f.kind === "image") return `<a href="${u}" target="_blank" rel="noopener" class="photo"><img${small ? ' class="thumb"' : ""} src="${u}" alt="Foto del Revisor" loading="lazy"></a>`;
  if (f.kind === "video") return `<video class="media${small ? " thumb" : ""}" src="${u}" controls playsinline preload="metadata"></video>`;
  if (f.kind === "audio") return `<audio class="media" src="${u}" controls preload="metadata"></audio>`;
  return `<a class="filelink" href="${u}" target="_blank" rel="noopener">${clipIcon}<span>${esc(f.name || "Archivo")}</span></a>`;
}
function bubble(m, extra = "") {
  // el mensaje con que el Usuario inició una tarea lleva su número
  const name = m.mine ? "TÚ" : m.role === "profesor" ? "USUARIO (PROFESOR)" + (m.task ? " · TAREA " + m.task : "") : (RN[m.role] || m.role).toUpperCase() + " · " + m.nick;
  return `<div class="bubble"><span class="n" style="color:${RHEX[m.role]}">${esc(name)}</span>${fileView(m.file)}${m.text ? (m.cut ? "…" : "") + esc(m.text) : ""}${extra}</div>`;
}

// destino actual del interruptor (el primero si no se ha escogido)
function curTo(v) {
  const keys = Object.keys(DEST[v.you.role] || {});
  return keys.includes(L.to) ? L.to : keys[0];
}
// cuenta regresiva: el número lo actualiza tickCountdowns() sin redibujar la pantalla,
// así el campo de texto no se reemplaza cada segundo y el teclado del iPad no se cierra
const cd = (at) => `<b class="cd" data-until="${at}"></b>`;
function tickCountdowns() {
  document.querySelectorAll("#app [data-until]").forEach((el) => { const t = mmss(secsTo(+el.dataset.until)); if (el.textContent !== t) el.textContent = t; });
}
// estado del Modelo frente al Usuario: conversación abierta, en cola, enfriamiento o libre
function usuarioStatus(u) {
  if (u.live) return `<div class="ustat live"><b class="t">EN CONVERSACIÓN CON EL USUARIO</b>Los mensajes llegan al instante. Se cierra sola en ${cd(u.liveEndsAt)} si nadie escribe.</div>`;
  if (u.queue) {
    const s = secsTo(u.queue.readyAt), n = u.queue.ahead;
    const parts = [s > 0 ? `espera mínima ${cd(u.queue.readyAt)}` : "", n ? `${n} ${n === 1 ? "equipo" : "equipos"} antes que tú` : ""].filter(Boolean);
    return `<div class="ustat queue"><b class="t">EN LA COLA DEL USUARIO · PUESTO ${u.queue.pos}</b>${parts.join(" · ") || "Ya casi te atiende."}</div>`;
  }
  const cool = secsTo(u.coolUntil);
  if (cool > 0) return `<div class="ustat cool">Podrás volver a escribirle al Usuario en ${cd(u.coolUntil)}</div>`;
  return `<div class="ustat">Para hablar con el Usuario entras a la cola: espera mínima ${mmss(u.queueSec)}${u.waiting ? ` · ${u.waiting} en la cola` : ""}</div>`;
}

// Modelo: alerta pequeña cuando la ventana de contexto le borró (todo o parte de) una instrucción del Usuario.
// Así decide si seguir con lo que tiene o volver a preguntarle. Se oculta al escoger; vuelve si se pierde otra.
const lostKey = (v) => `seunaia-olvido-${(v.sala && v.sala.id) || "1"}-${v.code}-${v.you.team}`;
function lostAlert(v) {
  const l = v.usuario && v.usuario.lost;
  if (!l) return "";
  const n = l.total - (Number(store.get(lostKey(v))) || 0);
  if (n <= 0) return "";
  // tareas (sin terminar) cuyo enunciado ya no está en su memoria
  const done = new Set((v.tasks || []).filter((k) => k.done).map((k) => k.id));
  const tl = (l.tasks || []).filter((id) => !done.has(id));
  const tasksTxt = tl.length ? ` Ya no tienes el enunciado de la ${tl.length === 1 ? "Tarea " + tl[0] : "Tareas " + listY(tl)}.` : "";
  return `<div class="lostline" role="status"><span>⚠ <b>Tu memoria olvidó ${n === 1 ? "un mensaje" : n + " mensajes"} del Usuario${l.none ? ": ya no te queda ninguna instrucción suya" : ""}.</b>${tasksTxt} ¿Sigues con lo que tienes o le vuelves a preguntar?</span>
    <span class="acts"><button type="button" class="btn dark sm" data-act="lostOk" data-total="${l.total}">Seguir así</button><button type="button" class="btn sm" style="background:var(--y);color:#000" data-act="lostAsk" data-total="${l.total}">Volver a preguntar</button></span></div>`;
}
// "1, 2 y 3"
const listY = (a) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " y " + a[a.length - 1]);
// Modelo: sus tareas, solo con el número (el enunciado está en el chat y se puede olvidar). Marca cada una al
// terminarla (con confirmación: dos toques). El Arnés y el Revisor no ven tareas.
function tasksBar(v) {
  const ts = v.tasks || [];
  if (!ts.length) return "";
  const chips = ts.map((k) => (k.done
    ? `<span class="tchip done">✓ Tarea ${k.id} terminada</span>`
    : `<button type="button" class="tchip" data-act="taskMark" data-task="${k.id}"${v.paused ? " disabled" : ""}>${L.confirm === "task:" + k.id ? `¿Terminaste la Tarea ${k.id}? Toca otra vez` : `Tarea ${k.id} · marcar terminada`}</button>`)).join("");
  return `<div class="tasksbar" role="group" aria-label="Tus tareas"><span class="ttl">TUS TAREAS</span>${chips}</div>`;
}

function vChat(v) {
  const r = v.you.role, c = v.context, u = v.usuario, live = !!(u && u.live), pct = Math.min(100, (c.used / c.limit) * 100);
  const now = Date.now(), forgot = c.forgot && now - c.forgot.at < 3000;
  let last = null, html = "";
  // el Modelo puede reenviarle al Usuario los archivos que le manda el Revisor
  const canFwd = !!u && !v.paused && !L.sending && (live || !(u.queue || secsTo(u.coolUntil) > 0));
  const fwd = (m) => (u && m.ch === "R" && m.file ? `<button type="button" class="btn sm fwd" data-act="forward" data-id="${m.id}"${canFwd ? "" : " disabled"}>${live ? "Reenviar al Usuario" : "Reenviar al Usuario (hace fila)"}</button>` : "");
  v.msgs.forEach((m) => {
    if (m.ch !== last) { html += `<div class="sep">${m.ch} · ${esc(CHN[m.ch] || "").toUpperCase()}</div>`; last = m.ch; }
    const old = m.id === c.oldestId && pct > 85;
    html += `<div data-id="${m.id}" class="msg${m.mine ? " me" : ""}${old ? " old" : ""}${L.seen.has(m.id) ? "" : " new"}">${bean(m.role)}${bubble(m, fwd(m))}</div>`;
  });
  if (!v.msgs.length) html = `<div class="empty">${r === "modelo" ? '<div class="spin" style="width:40px;height:40px"></div>Esperando el encargo del Usuario…' : r === "revisor" ? "Mira lo que hace el Arnés y descríbeselo al Modelo." : "Aún no te llega nada. Espera tu mensaje o juega al lado."}</div>`;
  // mensaje del Modelo esperando en la cola del Usuario (todavía no ocupa contexto)
  if (u && u.queue) html += `<div class="msg me pending">${bean(r)}<div class="bubble"><span class="n" style="color:${RHEX.profesor}">EN COLA PARA EL USUARIO</span>${esc(u.queue.text)}</div></div>`;
  const dis = v.paused || L.sending ? " disabled" : "";
  let compose;
  const dests = DEST[r];
  if (dests) {
    const to = curTo(v), [, name, place] = dests[to];
    const blocked = r === "modelo" && to === "usuario" && !live && (u.queue || secsTo(u.coolUntil) > 0);
    const off = dis || (blocked ? " disabled" : "");
    const hold = blocked ? (u.queue ? "Ya estás en la cola del Usuario…" : "Espera para volver a escribirle al Usuario…") : place;
    const many = Object.keys(dests).length > 1;
    compose = `${r === "revisor" && v.reviewTarget ? `<div class="reviewbar">👁️ Revisa al <b>Arnés ${esc(v.reviewTarget)}</b> y descríbele al Modelo lo que hace</div>` : ""}${u ? tasksBar(v) : ""}${u ? lostAlert(v) : ""}${u ? usuarioStatus(u) : ""}<div class="revbar" role="group" aria-label="Destino del mensaje"><span class="muted">${many ? "Escribirle a:" : "Le escribes a:"}</span>
        ${Object.entries(dests).map(([k, d]) => `<button type="button" class="seg${to === k ? " on" : ""}" aria-pressed="${to === k}" data-act="to" data-to="${k}">${d[1]}</button>`).join("")}</div>
      <form class="compose" data-submit="send"><input class="input" id="msg" maxlength="280" autocomplete="off" placeholder="${hold}" aria-label="Mensaje para ${name}"${off}>
        ${r === "revisor" ? `<label class="btn dark camera${dis ? " off" : ""}" for="photo" data-act="pick" aria-label="Mandar foto, video, audio o archivo a ${name}" title="Mandar foto, video, audio o archivo">${camIcon}</label>
        <input type="file" id="photo" accept="image/*,video/*,audio/*,application/pdf" hidden${dis}>` : ""}
        <button class="btn" style="background:${to === "usuario" ? RC.profesor : RC[r]};color:${to === "usuario" ? "#000" : RTX[r]}"${off}>${to === "usuario" && !live ? "HACER FILA" : "ENVIAR"}</button></form>`;
  } else compose = `<div class="ro">SOLO LECTURA · EJECUTA LO QUE DIGA EL MODELO</div>
      <button type="button" class="btn" style="background:${RC.arnes};color:#000;width:100%;margin-top:8px;min-height:50px;font-weight:700" data-act="deliver"${dis}>🏁 ENTREGAR · avisar que el trabajo está listo</button>`;
  const hint = now < L.hintUntil ? `<div class="hintcard anim" style="width:100%;margin-bottom:14px">${bean(r, "lg")}<p style="margin:0;font-size:15px;line-height:1.45"><b>Ahora eres ${RN[r]}: ${esc(PHRASE[r])}.</b> ${HINT[r]}</p></div>` : "";
  // la pista y el aviso de olvido van en contenedores fijos, para que el resto de la pantalla no se mueva al actualizarla
  return `${topbar(`${rolePill(r)}<span class="dots" style="font-size:26px">${esc(whereL(v.you.where))}</span><span class="muted">${esc(v.you.nick || "")}</span>`)}<div class="slot-hint">${hint}</div>
    <div class="pchead"><span class="phrase sm" style="color:${RC[r]}">${esc(RN[r])}: ${esc(PHRASE[r])}</span>
      <div class="hud"><span><b>${c.used}</b> / ${c.limit} CARACTERES${c.bonus ? ` <span class="muted">(base ${c.base})</span>` : ""}</span>${ctxBar(c.by || {}, c.limit, forgot ? "flash" : "")}${ctxLegend(c.by || {})}${c.bonus ? `<span class="bonus">${esc(c.bonusLog)} · total +${c.bonus}</span>` : ""}</div></div>
    <div class="pcgrid${live ? " live" : ""}"><section class="card chat${live ? " live" : ""}" aria-label="Chat">
      <div class="slot-forgot">${forgot ? `<div class="forgot">Se olvidaron ${c.forgot.n} caracteres</div>` : ""}</div>
      <div class="msgs" id="msgs">${html}</div>${compose}
      ${v.paused ? `<div class="overlay"><span class="dots" style="font-size:44px">PAUSA</span><span class="muted">El admin pausó la actividad</span></div>` : ""}
    </section><div class="side"><div class="card rules">${rulesList(r, true)}</div>${v.quizMax ? vMini(v) : ""}</div></div>`;
}

function vMini(v) {
  const q = v.question, a = L.answer && Date.now() - L.answer.at < 2600 ? L.answer : null;
  const foot = `<p class="muted" style="margin:4px 0 0;font-size:12.5px;line-height:1.45">Máximo ${v.quizMax} preguntas por turno. Cada acierto le da <b style="color:var(--y)">+${v.quizBonus} caracteres</b> a tu equipo.</p>`;
  if (!q && !a) return `<aside class="card mini" aria-label="Minijuego"><span class="flag">MINIJUEGO</span><div class="q">Ya respondiste las ${v.quizMax} preguntas de este turno.</div><p class="muted" style="margin:0;font-size:13px">Después de la rotación hay más.</p></aside>`;
  const shown = a || q;
  return `<aside class="card mini" aria-label="Minijuego"><span class="flag">MINIJUEGO · ${shown.n} DE ${v.quizMax}</span>
    <div class="q">${esc(shown.text)}</div>
    ${shown.options.map((o) => {
      let cls = "";
      if (a) { if (o.k === 0) cls = " ok"; else if (o.k === a.picked) cls = " bad"; }
      return `<button class="opt${cls}" data-act="answer" data-q="${shown.id}" data-k="${o.k}"${a ? " disabled" : ""}>${esc(o.text)}</button>`;
    }).join("")}
    ${foot}</aside>`;
}

function vRotate(v) {
  const R = v.rotation, o = R.outgoing;
  const w = o && o.where ? o.where : null;
  const big = w ? w.label : (o ? "PC " + o.toPc : "");
  const sub = w && w.row != null ? `FILA ${esc(w.row)} · COLUMNA ${esc(w.col)}` : "";
  return `${topbar(salaTag(v))}<div class="stage rotate">
    ${o ? `<div class="go">${esc(o.nick)}, levántate y ve a tu puesto</div><div class="divider"></div>
      <span class="muted" style="font-size:13px;font-weight:600;letter-spacing:.3em">AHORA ERES</span>
      ${rolePill(o.toRole, ARTICLE[o.toRole])}
      <span class="big" style="font-size:clamp(90px,18vw,220px);text-shadow:0 0 30px rgba(255,255,255,.45)">${esc(big)}</span>
      ${sub ? `<div style="font-size:16px;font-weight:700;letter-spacing:.14em;color:#fff">${sub}</div>` : ""}
      <div class="phrase" style="color:${RC[o.toRole]}">${esc(RN[o.toRole])}: ${esc(PHRASE[o.toRole])}</div>`
    : `<span class="muted" style="font-size:16px">Espera la siguiente ronda…</span>`}
    ${R.me ? (R.me.ready
      ? `<span class="pill" style="background:var(--t);color:#000;height:44px;font-size:14px">✓ Estás en tu puesto</span>`
      : (secsTo(R.me.readyAt) > 0
        ? `<button class="btn white" style="min-width:240px;min-height:56px;font-size:18px;opacity:.5" disabled>Camina a tu puesto… ${cd(R.me.readyAt)}</button>`
        : `<button class="btn white" style="min-width:240px;min-height:56px;font-size:20px;animation:pulse 2s ease-in-out infinite" data-act="ready">¡YA LLEGUÉ A MI PUESTO!</button>`)) : ""}
    <span class="muted" style="font-size:12px;font-weight:600;letter-spacing:.2em">LISTOS <b class="dots" style="font-size:22px;color:#fff">${R.ready}/${R.total}</b></span>
  </div>`;
}

function vDevice(v) {
  if (v && v.kind === "pick") return vPick();
  if (!v || !v.registered) return vLanding();
  if (v.phase === "end") return `${topbar()}<div class="stage"><span class="big" style="font-size:clamp(60px,12vw,140px)">FIN</span><p class="muted">Gracias por ser una IA por un día.</p></div>`;
  if (v.phase === "rotate" && v.rotation && (v.rotation.outgoing || v.rotation.me)) return vRotate(v);
  if (v.phase === "activity" && v.context) return vChat(v);
  return vWaiting(v);
}

// ---------- Panel admin ----------
function vLogin() {
  // con varias salas, el admin escoge la suya (cada sala tiene su admin, su gente y su cola)
  const salaSel = multiSala() ? `<div class="field" style="width:100%"><span style="color:#2e2e2e">TU SALA</span>
      <div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap" role="group" aria-label="Sala">${L.salas.map((s) => {
        const on = L.sala === s.id;
        return `<button type="button" class="btn sm" style="background:${on ? "var(--y)" : "#EEF1F5"};color:#000;border:1px solid ${on ? "var(--y)" : "#d5d9e0"}" aria-pressed="${on}" data-act="loginSala" data-sala="${esc(s.id)}">${esc(s.name)}</button>`;
      }).join("")}</div></div>` : "";
  return `<div class="stage"><div class="card anim" style="background:#fff;color:#000;padding:28px;width:min(420px,100%);display:flex;flex-direction:column;gap:16px;align-items:center;border-radius:28px">
    <img class="logo-crea" src="/assets/crea.png" alt="CREA"><h1 class="h1" style="font-size:34px">MODO ADMIN</h1>
    ${salaSel}
    <form data-submit="login" style="width:100%;display:flex;flex-direction:column;gap:12px">
      <label class="field"><span style="color:#2e2e2e">CLAVE DE LA SESIÓN</span><input class="input" id="pw" type="password" style="background:#EEF1F5;color:#000;border-color:#d5d9e0" autocomplete="current-password"></label>
      <div class="row" style="justify-content:center"><a class="btn dark" style="display:inline-flex;align-items:center;text-decoration:none" href="/">Volver</a><button class="btn" style="background:var(--y)"${L.connected ? "" : " disabled"}>Entrar</button></div>
    </form></div></div>`;
}

const QUEUE_OPTS = [0, 15, 30, 60, 90, 120, 180, 300, 600];
const COOL_OPTS = [0, 15, 30, 60, 90, 120, 180, 300, 600, 900];
const LIVE_OPTS = [30, 60, 90, 120, 180, 300, 600];
// opciones en segundos; si el valor actual no está en la lista, se agrega
function secOpts(list, cur) {
  return [...new Set([...list, cur])].sort((a, b) => a - b).map((s) => `<option value="${s}"${s === cur ? " selected" : ""}>${s ? mmss(s) + " min" : "Sin espera"}</option>`).join("");
}
function teamOptions(v, d) {
  const opts = [`<option value=""${d.team === null ? " selected" : ""}>Sin equipo</option>`];
  v.teams.forEach((_, t) => opts.push(`<option value="${t}"${d.team === t ? " selected" : ""}>Equipo ${t + 1}</option>`));
  if (v.teams.length < (v.maxTeams || 8)) opts.push(`<option value="${v.teams.length}">+ Equipo nuevo</option>`);
  return opts.join("");
}
function devTable(v) {
  if (!v.devices.length) return `<div class="card" style="padding:20px;text-align:center" class="muted">Todavía no se conecta nadie. Abre la dirección del servidor en los iPads.</div>`;
  return `<div class="card tablewrap"><table class="devs"><thead><tr><th>PUESTO</th><th>PERSONA</th><th>ROL (MESA)</th><th>EQUIPO</th><th></th></tr></thead><tbody>
    ${v.devices.map((d) => `<tr><td><span class="online${d.online ? "" : " no"}" title="${d.online ? "En línea" : "Desconectado"}"></span><b class="dots" style="font-size:18px">${esc(whereL(d.where))}</b>${d.where && d.where.row != null ? ` <span class="muted" style="font-size:11px">PC ${d.pc}</span>` : ""}</td>
      <td>${esc(d.nick || "—")}</td>
      <td><select aria-label="Rol del PC ${d.pc}" data-change="role" data-id="${esc(d.id)}">${ROLES.map((r) => `<option value="${r}"${d.role === r ? " selected" : ""}>${RN[r]}</option>`).join("")}</select></td>
      <td><select aria-label="Equipo del PC ${d.pc}" data-change="team" data-id="${esc(d.id)}">${teamOptions(v, d)}</select></td>
      <td style="text-align:right;white-space:nowrap">${d.online && d.nick ? `<button class="btn dark sm" data-act="release" data-id="${esc(d.id)}" title="Para cuando un iPad se traba: la persona vuelve desde otro iPad con su nickname">${L.confirm === "release:" + d.id ? "¿Seguro? Liberar" : "Liberar"}</button> ` : ""}<button class="btn dark sm" data-act="kick" data-id="${esc(d.id)}">${L.confirm === "kick:" + d.id ? "¿Seguro? Quitar" : "Quitar"}</button></td></tr>`).join("")}
  </tbody></table></div>`;
}
function teamCard(v, tm, t, live) {
  const devs = v.devices.filter((d) => d.team === t);
  const slots = ROLES.map((r) => { const d = devs.find((x) => x.role === r);
    return `<div class="slot"><span class="dot" style="background:${RC[r]}"></span>${d ? esc(d.nick || "—") : "<span class='muted'>vacío</span>"}<span class="pc">${RN[r]}${d ? " · " + esc(whereL(d.where)) : ""}</span></div>`; }).join("");
  const feed = live ? `${ctxBar(tm.by || {}, tm.limit)}${ctxLegend(tm.by || {})}
    <div class="feed">${tm.msgs.slice(-5).map((m) => `<span><b style="color:${RC[m.role]}">${m.ch}›</b> ${m.task ? `<b style="color:var(--t)">[Tarea ${m.task}]</b> ` : ""}${m.file ? "[archivo] " : ""}${esc(m.text)}</span>`).join("") || "<span class='muted'>Sin mensajes todavía</span>"}</div>` : "";
  // estado del Modelo de este equipo frente al Usuario
  const talking = live && v.live && v.live.team === t, qi = live ? v.queue.findIndex((q) => q.team === t) : -1, cool = live ? secsTo(tm.coolUntil) : 0;
  const state = talking ? `<span class="pill" style="background:var(--y);color:#000">CONVERSANDO CONTIGO</span>`
    : qi >= 0 ? `<span class="pill" style="background:var(--pill);color:#fff">EN COLA · PUESTO ${qi + 1}</span>`
    : cool > 0 ? `<span class="pill" style="background:var(--pill);color:#c8c8c8">ENFRIAMIENTO ${mmss(cool)}</span>` : "";
  // tareas de este equipo: cuáles terminó (y quién la marcó); el admin puede marcar o reabrir
  const tasks = live ? teamTasksOf(v, t).map((k) => {
    const d = k.done && k.done[t];
    return d
      ? `<div class="trow"><span class="tchip done" title="${esc(k.text)}">✓ Tarea ${k.id} · ${doneWhen(v, d)} · ${d.by === "modelo" ? "la marcó el Modelo" : "la marcaste tú"}</span><button class="btn dark sm" data-act="taskDone" data-t="${t}" data-task="${k.id}" data-done="0" title="Por si fue un error: la tarea vuelve a estar en curso">Reabrir</button></div>`
      : `<div class="trow"><span class="tchip" title="${esc(k.text)}">Tarea ${k.id} · en curso</span><button class="btn dark sm" data-act="taskDone" data-t="${t}" data-task="${k.id}" title="Márcala tú si el Modelo te dijo que terminó">Marcar terminada</button></div>`;
  }).join("") : "";
  // el Modelo ya no tiene (toda) la instrucción del Usuario en su memoria
  const lt = live && tm.lostU ? (tm.lostU.tasks || []).filter((id) => !teamTasksOf(v, t).some((k) => k.id === id && k.done && k.done[t])) : [];
  const lost = live && tm.lostU ? `<span class="warn">▲ el Modelo olvidó ${tm.lostU.total === 1 ? "1 mensaje" : tm.lostU.total + " mensajes"} tuyos${lt.length ? ` (ya no tiene el enunciado de la Tarea ${listY(lt)})` : tm.lostU.none ? " (ya no tiene tu instrucción)" : ""}</span>` : "";
  return `<div class="card team${talking ? " asking" : ""}"><h3>EQUIPO ${t + 1}${live ? `<span class="muted">${tm.used}/${tm.limit}${tm.bonus ? " (+" + tm.bonus + ")" : ""}</span>` : ""}</h3>
    ${state}${tasks}${feed}${slots}${tm.warnings.map((w) => `<span class="warn">▲ ${esc(w)}</span>`).join("")}${lost}
    ${live ? `<button class="btn dark sm" data-act="openTeam" data-t="${t}">Ver los canales</button>` : ""}</div>`;
}
const teamTasksOf = (v, t) => (v.tasks || []).filter((k) => k.teams.includes(t));
// "a los 12:34" desde que se inició la actividad (o la ronda, si no hay hora de inicio)
const doneWhen = (v, d) => (v.startedAt ? "a los " + mmss(Math.max(0, Math.round((d.at - v.startedAt) / 1000))) : "ronda " + d.round);
// Disposición física del salón: cuántas columnas y cómo se nombran filas/columnas, + mapa de puestos
function boardCard(v) {
  const b = v.cfg.board || { cols: 0, rowStyle: "letters", colStyle: "numbers" };
  const styleOpts = (sel) => `<option value="letters"${sel === "letters" ? " selected" : ""}>Letras (A, B, C…)</option><option value="numbers"${sel === "numbers" ? " selected" : ""}>Números (1, 2, 3…)</option>`;
  return `<div class="card"><h3 style="margin:0 0 12px;font:700 13px var(--ui);letter-spacing:.1em;color:var(--y)">DISPOSICIÓN DE LA SALA</h3>
    <div class="cfg" style="padding:0${b.cols ? ";margin-bottom:16px" : ""}">
      <label class="field"><span>COLUMNAS DEL SALÓN · 0 = sin tablero ("PC N")</span><input class="input" type="number" min="0" max="26" value="${b.cols}" data-change="boardCols"></label>
      <label class="field"><span>NOMBRE DE LAS FILAS</span><select class="input" data-change="boardRow">${styleOpts(b.rowStyle)}</select></label>
      <label class="field"><span>NOMBRE DE LAS COLUMNAS</span><select class="input" data-change="boardCol">${styleOpts(b.colStyle)}</select></label>
    </div>
    ${b.cols ? boardPreview(v) : `<p class="muted" style="margin:0;font-size:13px">Sin tablero, la rotación dice "ve al PC N". Pon las columnas de tu salón y al rotar cada quien verá la <b>fila y columna</b> de su puesto físico (ej. <b>B3</b>).</p>`}</div>`;
}
function boardPreview(v) {
  const b = v.cfg.board, seats = v.devices.slice().sort((a, c) => a.pc - c.pc);
  if (!seats.length) return `<p class="muted" style="margin:0;font-size:13px">Cuando entre gente verás aquí el mapa de puestos con su nombre de fila y columna.</p>`;
  const cells = seats.map((d) => `<div class="bcell" title="PC ${d.pc}"><b>${esc(whereL(d.where))}</b><span style="color:${RC[d.role]}">${esc(d.nick || "—")}</span></div>`).join("");
  return `<div class="muted" style="font-size:12px;font-weight:600;letter-spacing:.1em;margin-bottom:8px">MAPA DE PUESTOS (${seats.length}) · fila por ${b.rowStyle === "letters" ? "letra" : "número"}, columna por ${b.colStyle === "letters" ? "letra" : "número"}</div>
    <div class="tablewrap"><div class="board" style="grid-template-columns:repeat(${b.cols},minmax(56px,1fr))">${cells}</div></div>`;
}
function vAdmin(v) {
  const multi = v.sala && v.sala.multi;
  // con varias salas, el nombre de la sala va siempre arriba para que ningún admin se confunda de panel
  const salaHead = multi ? `${salaTag(v)}<a class="btn dark sm" style="display:inline-flex;align-items:center;text-decoration:none" href="/admin" title="Entrar al panel de otra sala">Cambiar de sala</a>` : "";
  const head = (title, right) => `${topbar(`<span class="lbl" style="font-size:11px;font-weight:700;letter-spacing:.18em;color:var(--y)">PANEL ADMIN · ${esc(v.code)}</span>${salaHead}`)}<div class="admhead"><h1 class="h1" style="font-size:34px;color:var(--y)">${multi ? esc(v.sala.name.toUpperCase()) + " · " : ""}${title}</h1><div class="row">${right}</div></div>`;
  const resetBtn = `<button class="btn dark" data-act="reset">${L.confirm === "reset" ? "¿Seguro? Se borra todo" : "Nueva sesión"}</button>`;
  const exportBtn = `<button class="btn dark" data-act="export" title="Descarga los chats de la sesión en JSON para analizarlos">Descargar historial</button>`;
  const ac = v.acceso;
  const connBtn = `<a class="btn dark" style="display:inline-flex;align-items:center;text-decoration:none" href="/conectar${multi ? "?sala=" + encodeURIComponent(v.sala.id) : ""}" target="_blank" rel="noopener">Pantalla de conexión (QR) ↗</a>`;
  const accessCard = ac ? `<div class="card" style="padding:14px 18px;display:flex;flex-wrap:wrap;gap:10px 24px;align-items:center">
    <span class="muted" style="font-size:12px;font-weight:600;letter-spacing:.14em">LOS IPADS ENTRAN CON EL QR O EN</span>
    <b class="dots" style="font-size:28px;color:var(--t)">${esc(ac.qrUrl.replace("http://", ""))}</b>
    <span class="muted" style="font-size:13px">${ac.ips.slice(1).map((x) => "o " + esc(x.url.replace("http://", "")) + (x.hotspot ? " (hotspot)" : "")).join(" · ")} · a veces ${esc(ac.url.replace("http://", ""))}</span>
    ${ac.hotspot ? `<span class="pill" style="background:var(--y);color:#000">WIFI: ${esc(ac.hotspot.nombre)}</span>` : ""}
    <span style="margin-left:auto">${connBtn}</span></div>` : "";
  if (v.phase === "lobby") {
    const online = v.devices.filter((d) => d.online).length;
    return `<div class="adm">${head(`LOBBY · ${online} EN LÍNEA`, resetBtn)}
      ${accessCard}
      <div class="card cfg">
        <label class="field"><span>CONTEXTO BASE POR EQUIPO (CARACTERES)</span><input class="input" id="cfgLimit" type="number" min="50" max="5000" step="50" value="${v.cfg.limit}" data-change="cfgLimit"></label>
        <label class="field"><span>AL LLENARSE, SE BORRA…</span><select class="input" data-change="cfgMode"><option value="mensaje"${v.cfg.mode === "mensaje" ? " selected" : ""}>El mensaje más viejo completo</option><option value="recortar"${v.cfg.mode === "recortar" ? " selected" : ""}>Letra por letra (recorta frases)</option></select></label>
        <label class="field"><span>TIEMPO ENTRE ROTACIONES</span><select class="input" data-change="cfgRot">${[60, 120, 180, 300, 420, 600, 900].map((s) => `<option value="${s}"${v.cfg.rotSec === s ? " selected" : ""}>${mmss(s)} min</option>`).join("")}</select></label>
        <label class="field"><span>COLA: ESPERA MÍNIMA PARA HABLAR CONTIGO</span><select class="input" data-change="cfgQueue">${secOpts(QUEUE_OPTS, v.cfg.queueSec)}</select></label>
        <label class="field"><span>ENFRIAMIENTO DEL MODELO TRAS HABLAR CONTIGO</span><select class="input" data-change="cfgCool">${secOpts(COOL_OPTS, v.cfg.coolSec)}</select></label>
        <label class="field"><span>LA CONVERSACIÓN SE CIERRA SOLA TRAS… SIN MENSAJES</span><select class="input" data-change="cfgLive">${secOpts(LIVE_OPTS, v.cfg.liveSec)}</select></label>
      </div>
      ${boardCard(v)}
      <p class="muted" style="margin:0;font-size:13px">El sistema arma los equipos a medida que entran (1 persona por rol). Cambia el rol o el equipo de cualquier puesto en la tabla; si el puesto ya está ocupado, se intercambian.</p>
      <div class="teams">${v.teams.map((tm, t) => teamCard(v, tm, t, false)).join("") || "<p class='muted'>Aún no hay equipos.</p>"}</div>
      ${devTable(v)}
      <div class="row" style="justify-content:flex-end"><button class="btn dark" data-act="reshuffle">Rearmar al azar</button><button class="btn" style="background:var(--y);box-shadow:0 0 24px rgba(235,226,18,.45)" data-act="start">INICIAR ACTIVIDAD</button></div>
    </div>`;
  }
  if (v.phase === "end") {
    return `<div class="adm">${head("RESUMEN", exportBtn + resetBtn)}<div class="teams">${v.teams.map((tm, t) => `<div class="card team"><h3>EQUIPO ${t + 1}</h3>${teamTasksOf(v, t).map((k) => { const d = k.done && k.done[t]; return d ? `<span style="color:var(--t)">✓ Tarea ${k.id} terminada ${doneWhen(v, d)}</span>` : `<span class="muted">✗ Tarea ${k.id} sin terminar</span>`; }).join("")}<span>${tm.sent} mensajes enviados</span><span>${tm.forgotTotal} caracteres olvidados</span><span>+${tm.bonus} caracteres ganados en el minijuego</span></div>`).join("")}</div></div>`;
  }
  const rot = v.phase === "rotate";
  const ready = rot ? v.rotation.filter((x) => x.ready).length : 0;
  const auto = v.cfg.autoRot !== false;
  const right = `<span style="font-size:12px;font-weight:600;letter-spacing:.12em">${rot ? "LISTOS" : "RONDA " + v.round + (auto ? " · ROTACIÓN EN" : " · ROTACIÓN DETENIDA")} <b class="dots" style="font-size:26px">${rot ? ready + "/" + v.rotation.length : mmss(v.timerLeft)}</b></span>
    ${rot ? `<button class="btn" style="background:var(--t)" data-act="forceResume">Reanudar sin esperar</button>` : `<button class="btn dark" data-act="pause">${v.paused ? "Reanudar actividad" : "Pausar actividad"}</button><button class="btn" style="background:var(--m);color:#fff" data-act="rotate">Rotar ya</button>`}
    <button class="btn dark" data-act="end">${L.confirm === "end" ? "¿Seguro? Terminar" : "Terminar"}</button>${exportBtn}${connBtn}`;
  // controles en vivo: rotación y contexto base se pueden cambiar en plena actividad
  const controls = rot ? "" : `<div class="card ctl">
    <div class="ctlgrp"><span class="ctlt">ROTACIÓN</span>
      <button type="button" class="switch${auto ? " on" : ""}" role="switch" aria-checked="${auto}" data-act="autoRot"><i></i>${auto ? "Automática" : "Detenida"}</button>
      <button class="btn dark sm" data-act="timer" data-d="-60">−1 min</button><button class="btn dark sm" data-act="timer" data-d="60">+1 min</button>
      <button class="btn dark sm" data-act="timerReset">Reiniciar a ${mmss(v.cfg.rotSec)}</button>
      <label class="row" style="gap:6px"><span class="muted" style="font-size:12px">Cada</span><select class="input sm" data-change="cfgRot" aria-label="Tiempo entre rotaciones">${[60, 120, 180, 300, 420, 600, 900, 1200].map((s) => `<option value="${s}"${v.cfg.rotSec === s ? " selected" : ""}>${mmss(s)} min</option>`).join("")}</select></label></div>
    <div class="ctlgrp"><span class="ctlt">CONTEXTO BASE</span>
      <button class="btn dark sm" data-act="limit" data-d="-50" aria-label="Quitar 50 caracteres">−50</button>
      <b class="dots" style="font-size:24px;min-width:70px;text-align:center">${v.cfg.limit}</b>
      <button class="btn dark sm" data-act="limit" data-d="50" aria-label="Sumar 50 caracteres">+50</button>
      <span class="muted" style="font-size:12px">caracteres por equipo (más lo ganado en el minijuego)</span></div>
    <div class="ctlgrp"><span class="ctlt">COLA</span><select class="input sm" data-change="cfgQueue" aria-label="Espera mínima en la cola">${secOpts(QUEUE_OPTS, v.cfg.queueSec)}</select>
      <span class="ctlt">ENFRIAMIENTO</span><select class="input sm" data-change="cfgCool" aria-label="Enfriamiento del Modelo tras hablar contigo">${secOpts(COOL_OPTS, v.cfg.coolSec)}</select>
      <span class="ctlt">CIERRE SIN MENSAJES</span><select class="input sm" data-change="cfgLive" aria-label="La conversación se cierra sola tras este tiempo sin mensajes">${secOpts(LIVE_OPTS, v.cfg.liveSec)}</select></div></div>`;
  const usuario = rot ? "" : vUsuario(v);
  const readyL = rot ? `<div class="card" style="padding:14px"><div class="readyl">${v.rotation.map((x) => `<span class="pill" style="background:${x.ready ? "var(--t)" : "var(--pill)"};color:${x.ready ? "#000" : "#c8c8c8"}">${x.ready ? "✓" : x.online ? "…" : "⚠"} ${esc(x.nick)} → ${esc(whereL(x.where))}</span>`).join("")}</div></div>` : "";
  // El Usuario decide qué mensaje es una TAREA nueva (Nueva tarea) y cuál es solo una aclaración
  const nextTask = (v.tasks || []).length + 1;
  const bc = rot ? "" : `<form class="card bc" data-submit="prompt"><textarea id="bc" maxlength="600" placeholder="Escribe una tarea nueva para los Modelos (ej: Dibujen un pato) o una aclaración." aria-label="Mensaje para los Modelos"></textarea>
    <div class="row"><select class="input" id="bcTarget" style="width:auto" aria-label="Destino"><option value="all">Todos los equipos</option>${v.teams.map((_, t) => `<option value="${t}">Solo equipo ${t + 1}</option>`).join("")}</select>
      <button class="btn dark" data-kind="msg" title="Solo un mensaje: no crea tarea">ENVIAR ACLARACIÓN</button>
      <button class="btn" style="background:var(--y)" data-kind="task" title="Crea la Tarea ${nextTask}: los Modelos la podrán marcar como terminada">＋ NUEVA TAREA ${nextTask}</button></div>
    <p class="muted" style="margin:0;font-size:12.5px;line-height:1.4"><b>Nueva tarea</b> crea la Tarea ${nextTask} con este texto; el Modelo la marca cuando la termine. <b>Aclaración</b> es solo un mensaje (por ejemplo, si un Modelo olvidó la instrucción): no crea tarea.</p></form>`;
  // lista de tareas con su enunciado y cuántos equipos la terminaron
  const tcard = rot || !(v.tasks || []).length ? "" : `<div class="card tcard"><span class="ctlt">TAREAS (${v.tasks.length})</span>${v.tasks.map((k) => {
    const n = k.teams.length, d = Object.keys(k.done || {}).length;
    return `<div class="trow"><b>Tarea ${k.id}</b><span class="ttext">${esc(k.text)}</span><span class="muted" style="font-size:12.5px">${n === v.teams.length ? "todos los equipos" : (n > 1 ? "equipos " : "equipo ") + listY(k.teams.map((x) => x + 1))} · <b style="color:var(--t)">${d}/${n} terminada${n > 1 ? "s" : ""}</b></span></div>`;
  }).join("")}</div>`;
  return `<div class="adm">${head(rot ? "ROTANDO" : v.paused ? "EN PAUSA" : "EN VIVO", right)}${readyL}${usuario}${controls}${bc}${tcard}
    <div class="teams">${v.teams.map((tm, t) => teamCard(v, tm, t, true)).join("")}</div>
    <details id="devs" class="card" style="padding:14px"><summary style="cursor:pointer;font-weight:600">Dispositivos (${v.devices.length}) · asignar personas que llegan tarde</summary><div style="margin-top:12px">${devTable(v)}</div></details>
    ${L.adminTeam !== null && v.teams[L.adminTeam] ? vTeamModal(v, L.adminTeam) : ""}</div>`;
}
// El Usuario (admin) atiende a un Modelo a la vez: chat amplio de la conversación abierta y la cola
function vUsuario(v) {
  const chat = (t) => {
    const msgs = v.teams[t].msgs.filter((m) => m.ch === "U");
    return msgs.map((m) => `<div data-id="${m.id}" class="msg${m.role === "profesor" ? " me" : ""}${L.seen.has(m.id) ? "" : " new"}">${bean(m.role)}<div class="bubble"><span class="n" style="color:${RHEX[m.role]}">${m.role === "profesor" ? "TÚ" + (m.task ? " · TAREA " + m.task : "") : "MODELO · " + esc(m.nick)}</span>${fileView(m.file)}${m.cut ? "…" : ""}${esc(m.text)}</div></div>`).join("")
      || "<div class='empty'>Sin mensajes todavía.</div>";
  };
  const queue = v.queue.length ? `<ol class="queue">${v.queue.map((q, i) => {
    const s = secsTo(q.readyAt);
    const st = s > 0 ? `espera mínima ${mmss(s)}` : i === 0 && v.live ? "listo · cuando termines" : i === 0 ? "pasa ya" : "listo · espera su turno";
    return `<li><b>Equipo ${q.team + 1}</b> <span class="muted">${esc(q.nick)}</span> <span class="qst">${st}</span><span class="qtx">${q.file ? "[archivo] " : ""}${esc(q.text)}</span>${!v.live ? `<button class="btn sm" style="background:var(--y);color:#000;margin-top:6px;align-self:flex-start" data-act="serveNow" data-t="${q.team}">Atender ahora</button>` : ""}</li>`;
  }).join("")}</ol>` : `<p class="muted" style="margin:0;font-size:13px">Ningún Modelo esperando.</p>`;
  const qcard = `<div class="card qcard"><span class="ctlt">COLA DE MODELOS (${v.queue.length})</span>${queue}
    <p class="muted" style="margin:0;font-size:12px">Cada Modelo espera al menos ${v.cfg.queueSec ? mmss(v.cfg.queueSec) : "0:00"} y a que termines con los que llegaron antes. Después de hablar contigo espera ${v.cfg.coolSec ? mmss(v.cfg.coolSec) : "0:00"} para volver a escribirte. Si nadie escribe en ${mmss(v.cfg.liveSec)}, la conversación se cierra sola.</p></div>`;
  if (!v.live || !v.teams[v.live.team]) return `<div class="usr">${qcard}</div>`;
  const t = v.live.team;
  return `<div class="usr"><section class="card livechat" aria-label="Conversación con el Modelo del equipo ${t + 1}">
      <div class="admhead"><div><h2 class="h1" style="font-size:24px;color:var(--y)">CONVERSANDO CON EL MODELO · EQUIPO ${t + 1}</h2>
        <span class="muted" style="font-size:12.5px">Se cierra sola en ${cd(v.live.endsAt)} si nadie escribe</span></div>
        <div class="row" style="gap:8px">${teamTasksOf(v, t).filter((k) => !(k.done && k.done[t])).map((k) => `<button class="btn sm" style="background:var(--t);color:#000" data-act="taskDone" data-t="${t}" data-task="${k.id}" title="${esc(k.text)}">✓ Tarea ${k.id} terminada</button>`).join("")}
        <button class="btn" style="background:var(--m);color:#fff" data-act="endLive">Terminar${v.queue.length ? " y atender al siguiente" : ""}</button></div></div>
      <div class="msgs" id="msgs">${chat(t)}</div>
      <form class="compose" data-submit="reply" data-t="${t}"><input class="input" id="reply" maxlength="280" autocomplete="off" placeholder="Respóndele al Modelo…" aria-label="Mensaje para el Modelo"><button class="btn" style="background:var(--y)">ENVIAR</button></form>
    </section>${qcard}</div>`;
}
function vTeamModal(v, t) {
  const tm = v.teams[t];
  return `<div class="modal" data-act="closeTeam"><div class="card" data-stop="1" role="dialog" aria-label="Canales del equipo ${t + 1}"><div class="admhead"><h2 class="h1" style="font-size:28px">EQUIPO ${t + 1}</h2><button class="btn dark" data-act="closeTeam">Cerrar</button></div>
    <div class="chgrid">${["U", "C", "R"].map((c) => `<div class="chcol${c === "U" ? " e" : ""}"><h4>${c} · ${CHN[c].toUpperCase()}</h4>${tm.msgs.filter((m) => m.ch === c).map((m) => `<p><b style="color:${RC[m.role]}">${esc(m.role === "profesor" ? "tú" : m.nick)}:</b> ${m.task ? `<b style="color:var(--t)">[Tarea ${m.task}]</b> ` : ""}${fileView(m.file, true)}${m.cut ? "…" : ""}${esc(m.text)}</p>`).join("") || "<p class='muted'>—</p>"}
      ${c === "U" && !(v.live && v.live.team === t) ? `<form class="replyf" data-submit="reply" data-t="${t}"><input class="input" id="replyTeam" maxlength="280" autocomplete="off" placeholder="Escribirle al Modelo…" aria-label="Mensaje para el Modelo"><button class="btn sm" style="background:var(--y)">Enviar</button></form>` : ""}</div>`).join("")}</div></div></div>`;
}

// ---------- Render ----------
// Actualiza la pantalla cambiando solo lo que cambió. Así el campo donde se escribe no se reemplaza
// cuando llega un mensaje y el teclado del iPad no se cierra en plena conversación.
function morph(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); return; }
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  morphChildren(a, b);
}
function morphChildren(a, b) {
  const ac = [...a.childNodes], bc = [...b.childNodes];
  bc.forEach((n, i) => (i < ac.length ? morph(ac[i], n) : a.appendChild(n)));
  ac.slice(bc.length).forEach((n) => n.remove());
}
function render() {
  // con un menú desplegable abierto no se redibuja (se cerraría); el intervalo lo intenta de nuevo
  if (document.activeElement && document.activeElement.tagName === "SELECT") return;
  // mientras se escoge una foto no se redibuja: en iPad se perdería la foto elegida
  if (L.picking && Date.now() - L.picking < 120000) return;
  const a = document.activeElement, fid = a && a.id, ss = a && a.selectionStart;
  const keep = {};
  ["nick", "pw", "msg", "bc", "cfgLimit", "reply", "replyTeam"].forEach((id) => { const el = document.getElementById(id); if (el) keep[id] = el.value; });
  const bcT = $("#bcTarget") && $("#bcTarget").value;
  const details = $("#devs") && $("#devs").open;
  const m = $("#msgs"), stick = !m || m.scrollHeight - m.scrollTop - m.clientHeight < 60, prevTop = m ? m.scrollTop : 0;

  let html;
  if (IS_ADMIN) html = L.view && L.view.kind === "admin" ? vAdmin(L.view) : vLogin();
  else html = L.view ? vDevice(L.view) : `<div class="stage"><div class="spin"></div><p class="muted">Conectando con el servidor…</p></div>`;
  // la landing muestra la autoría en grande; las demás pantallas, pequeña al pie
  const onLanding = !IS_ADMIN && L.view && L.view.kind !== "pick" && !L.view.registered;
  if (!onLanding) html += credits();
  // la pestaña dice la sala: útil si alguien tiene abiertos los paneles de varias salas
  const sv = L.view && L.view.sala && L.view.sala.multi ? L.view.sala.name + " · " : "";
  const title = sv + (IS_ADMIN ? "Admin · " : "") + "Sé una IA por un d-IA";
  if (document.title !== title) document.title = title;

  if (html !== L.lastHtml) {
    const next = document.createElement("div");
    next.innerHTML = html;
    morphChildren($("#app"), next);
    L.lastHtml = html;
    Object.entries(keep).forEach(([id, val]) => { const el = document.getElementById(id); if (el && (id !== "cfgLimit" || id === fid)) el.value = val; });
    if (bcT && $("#bcTarget")) $("#bcTarget").value = bcT;
    if (details && $("#devs")) $("#devs").open = true;
    if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { if (ss != null) el.setSelectionRange(ss, ss); } catch (_) {} } }
    const m2 = $("#msgs"); if (m2) m2.scrollTop = stick ? m2.scrollHeight : prevTop;
    $("#app").classList.toggle("settled", !L.firstPaint); // las animaciones de entrada solo en la primera pintada
    L.firstPaint = false;
    document.querySelectorAll("#app .msg[data-id]").forEach((el) => L.seen.add(+el.dataset.id));
  }
  tickCountdowns();
  const tEl = $("#toast");
  if (L.toast && Date.now() < L.toast.until) { if (tEl.dataset.t !== L.toast.text) { tEl.innerHTML = `<div class="toast" role="status">${esc(L.toast.text)}</div>`; tEl.dataset.t = L.toast.text; } }
  else if (tEl.innerHTML) { tEl.innerHTML = ""; tEl.dataset.t = ""; }
}
// refresco suave para que expiren avisos, la estela de "olvido" y el resultado del minijuego
setInterval(render, 500);
function fresh() { L.firstPaint = true; render(); }

// ---------- Acciones ----------
document.addEventListener("click", async (e) => {
  // qué botón de envío tocó el admin: "＋ Nueva tarea" o "Enviar aclaración" (respaldo si el navegador no da e.submitter)
  const kind = e.target.closest("[data-kind]");
  if (kind) L.bcKind = kind.dataset.kind;
  const el = e.target.closest("[data-act]");
  if (!el) return;
  if (el.dataset.act === "closeTeam" && e.target.closest("[data-stop]") && !e.target.closest("button")) return;
  const act = el.dataset.act, id = el.dataset.id;
  const twoStep = (key) => { if (L.confirm === key) { L.confirm = null; return true; } L.confirm = key; render(); setTimeout(() => { if (L.confirm === key) { L.confirm = null; render(); } }, 4000); return false; };

  if (act === "join" || act === "reclaim") {
    const nick = ($("#nick").value || "").trim();
    if (!nick) { L.err = act === "join" ? "Escribe tu nickname para entrar." : "Escribe arriba el nickname con el que estabas jugando."; render(); $("#nick").focus(); return; }
    L.err = "";
    const r = await emit(act, act === "join" ? { nick, role: el.dataset.role } : { nick });
    if (r.ok) { if (r.reclaimed) toast(`Volviste a tu puesto: PC ${r.pc}.`); fresh(); }
    return;
  }
  // el teléfono escoge su sala en el selector
  if (act === "sala") { setSala(el.dataset.sala); L.view = null; hello(); render(); return; }
  // volver al selector (solo antes de entrar a jugar): página nueva, sin sala
  if (act === "changeSala") { location.assign("/"); return; }
  // el admin escoge su sala; si ya tiene token de esa sala entra solo
  if (act === "loginSala") { setSala(el.dataset.sala); tryToken(L.sala); render(); const pw = $("#pw"); if (pw) pw.focus(); return; }
  if (act === "to") { L.to = el.dataset.to; render(); $("#msg") && !$("#msg").disabled && $("#msg").focus(); return; }
  if (act === "endLive") { await emit("admin:endLive"); return; }
  // admin: marca (o reabre) una tarea de un equipo
  if (act === "taskDone") {
    const reopen = el.dataset.done === "0", t = +el.dataset.t, k = +el.dataset.task;
    const r = await emit("admin:taskDone", { team: t, task: k, done: !reopen });
    if (r.ok) toast(reopen ? `La Tarea ${k} del equipo ${t + 1} vuelve a estar en curso.` : `Tarea ${k} del equipo ${t + 1} terminada.`);
    return;
  }
  // Modelo: marca una de sus tareas como terminada (dos toques, para no marcarla por error)
  if (act === "taskMark") {
    const k = +el.dataset.task;
    if (!twoStep("task:" + k)) return;
    const r = await emit("task:done", { task: k });
    if (r.ok) toast(`Marcaste la Tarea ${k} como terminada. El Usuario ya lo ve.`);
    return;
  }
  // Modelo: decide qué hacer tras olvidar una instrucción del Usuario
  if (act === "lostOk" || act === "lostAsk") {
    store.set(lostKey(L.view), el.dataset.total);
    if (act === "lostAsk") { L.to = "usuario"; render(); const m = $("#msg"); if (m && !m.disabled) m.focus(); return; }
    render();
    return;
  }
  if (act === "deliver") { const r = await emit("arnes:deliver"); if (r.ok) toast("Avisaste al Modelo que el trabajo está listo."); return; }
  if (act === "serveNow") { const r = await emit("admin:serveNow", { team: +el.dataset.t }); if (r.ok) toast("Conversación abierta con ese Modelo."); return; }
  if (act === "export") {
    const r = await emit("admin:export");
    if (r.ok && r.data) {
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "seunaia-" + (r.data.sala && multiSala() ? "sala" + r.data.sala + "-" : "") + (r.data.sesion || "sesion") + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("Historial descargado.");
    }
    return;
  }
  if (act === "pick") { L.picking = Date.now(); return; } // abre el selector de fotos (lo hace el <label>)
  if (act === "autoRot") { await emit("admin:config", { autoRot: !(L.view.cfg.autoRot !== false) }); return; }
  if (act === "timer") { await emit("admin:setTimer", { sec: Math.max(5, L.view.timerLeft + Number(el.dataset.d)) }); return; }
  if (act === "timerReset") { await emit("admin:setTimer", { sec: L.view.cfg.rotSec }); return; }
  if (act === "limit") { await emit("admin:config", { limit: L.view.cfg.limit + Number(el.dataset.d) }); return; }
  if (act === "release") { if (twoStep("release:" + id)) { const r = await emit("admin:release", { deviceId: id }); if (r.ok) toast("Puesto liberado: la persona puede volver con su nickname desde cualquier iPad."); } return; }
  if (act === "answer") {
    const k = +el.dataset.k, q = L.view.question;
    const r = await emit("answer", { qid: +el.dataset.q, k });
    if (r.ok) {
      L.answer = { at: Date.now(), picked: k, ...q };
      toast(r.correct ? `¡Correcto! +${r.bonus} caracteres para tu equipo.` : `Casi. La respuesta era: ${r.correctText}`);
    }
    return;
  }
  if (act === "forward") {
    // si el Modelo está escribiéndole al Usuario, ese texto viaja con el archivo
    const inp = $("#msg"), caption = curTo(L.view) === "usuario" && inp ? inp.value.trim() : "";
    const r = await emit("forward", { id: +id, text: caption });
    if (r.ok) { if (caption) inp.value = ""; toast(r.queued ? `Archivo en la cola del Usuario: puesto ${r.pos}.` : "Archivo reenviado al Usuario."); }
    return;
  }
  if (act === "ready") { await emit("ready"); return; }
  if (act === "start") { const r = await emit("admin:start"); if (r.ok) toast("¡Actividad iniciada! Envía el prompt a los Modelos."); return; }
  if (act === "reshuffle") { const r = await emit("admin:reshuffle"); if (r.ok) toast("Equipos rearmados."); return; }
  if (act === "pause") { await emit("admin:pause"); return; }
  if (act === "plus") { await emit("admin:addTime", { sec: 60 }); return; }
  if (act === "rotate") { const r = await emit("admin:rotate"); if (r.ok) toast("¡Hora de rotar!"); return; }
  if (act === "forceResume") { await emit("admin:forceResume"); return; }
  if (act === "end") { if (twoStep("end")) await emit("admin:end"); return; }
  if (act === "reset") { if (twoStep("reset")) { const r = await emit("admin:reset"); if (r.ok) toast("Sesión nueva lista."); } return; }
  if (act === "kick") { if (twoStep("kick:" + id)) await emit("admin:kick", { deviceId: id }); return; }
  if (act === "openTeam") { L.adminTeam = +el.dataset.t; render(); return; }
  if (act === "closeTeam") { L.adminTeam = null; render(); return; }
});
// Reduce la foto en el iPad (máx. 1280 px, JPEG) antes de mandarla, para que viaje rápido por la WiFi
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const out = (q) => c.toBlob((b) => (b && b.size > 1000000 && q > 0.3 ? out(q - 0.15) : b ? resolve(b) : reject(new Error("No se pudo leer la foto."))), "image/jpeg", q);
      out(0.75);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la foto.")); };
    img.src = url;
  });
}
const MAX_FILE = 80 * 1024 * 1024;
// sube el archivo al servidor (con avance) y devuelve su id
function uploadFile(blob, type, name) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/subir");
    x.setRequestHeader("Content-Type", type);
    x.setRequestHeader("X-Device", browserId());
    x.setRequestHeader("X-Name", encodeURIComponent(name || ""));
    x.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 300000) toast(`Subiendo… ${Math.round((e.loaded / e.total) * 100)}%`); };
    x.onload = () => { let r = {}; try { r = JSON.parse(x.responseText); } catch (_) {} if (r.id) resolve(r.id); else reject(new Error(r.error || "No se pudo subir el archivo.")); };
    x.onerror = () => reject(new Error("No se pudo subir el archivo. Revisa la conexión."));
    x.send(blob);
  });
}
// El Revisor manda una foto, video, audio u otro archivo (con el texto escrito como pie)
async function sendFile(file) {
  L.picking = false;
  if (!file) { render(); return; }
  L.sending = true; render(); toast("Enviando archivo…");
  try {
    let blob = file, type = file.type || "application/octet-stream";
    // las fotos se achican; los GIF quedan como están para no perder la animación
    if (/^image\/(jpeg|png|webp|heic|heif)$/.test(type)) { blob = await shrinkPhoto(file); type = "image/jpeg"; }
    if (blob.size > MAX_FILE) throw new Error("El archivo es muy grande (máximo 80 MB).");
    const fileId = await uploadFile(blob, type, file.name);
    const caption = ($("#msg") && $("#msg").value.trim()) || "";
    const to = curTo(L.view);
    const r = await emit("send", { text: caption, to, file: fileId });
    if (r.ok) { if ($("#msg")) $("#msg").value = ""; toast(`Archivo enviado al ${DEST.revisor[to][1]}.`); }
  } catch (err) { toast(err.message); }
  const inp = $("#photo"); if (inp) inp.value = "";
  L.sending = false; render();
}
document.addEventListener("toggle", (e) => { if (e.target.id === "rules") L.rulesOpen = e.target.open; }, true);
// si se cierra el selector de fotos sin escoger, seguir dibujando
window.addEventListener("focus", () => setTimeout(() => { if (L.picking && !($("#photo") && $("#photo").files.length)) { L.picking = false; render(); } }, 800));
document.addEventListener("change", (e) => {
  if (e.target.id === "photo") { sendFile(e.target.files && e.target.files[0]); return; }
  const k = e.target.dataset.change;
  if (!k) return;
  // soltar el menú para que el panel se redibuje con el valor nuevo al instante
  if (e.target.tagName === "SELECT") e.target.blur();
  const id = e.target.dataset.id;
  if (k === "role") emit("admin:assign", { deviceId: id, role: e.target.value });
  if (k === "team") emit("admin:assign", { deviceId: id, team: e.target.value === "" ? null : +e.target.value });
  if (k === "cfgLimit") emit("admin:config", { limit: +e.target.value });
  if (k === "cfgMode") emit("admin:config", { mode: e.target.value });
  if (k === "cfgRot") emit("admin:config", { rotSec: +e.target.value });
  if (k === "cfgQueue") emit("admin:config", { queueSec: +e.target.value });
  if (k === "cfgCool") emit("admin:config", { coolSec: +e.target.value });
  if (k === "cfgLive") emit("admin:config", { liveSec: +e.target.value });
  if (k === "boardCols") emit("admin:config", { board: { cols: +e.target.value } });
  if (k === "boardRow") emit("admin:config", { board: { rowStyle: e.target.value } });
  if (k === "boardCol") emit("admin:config", { board: { colStyle: e.target.value } });
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const k = e.target.dataset.submit;
  if (k === "login") {
    if (multiSala() && !L.sala) { toast("Escoge primero tu sala."); return; }
    const r = await emit("admin:login", { password: $("#pw").value, sala: L.sala });
    if (r.ok) { setSala(r.sala || L.sala); store.set(adminKey(L.sala), r.token); fresh(); } else { $("#pw").value = ""; }
    return;
  }
  if (k === "send") {
    const inp = $("#msg"), text = (inp.value || "").trim();
    if (!text) return;
    inp.value = "";
    const r = await emit("send", { text, to: curTo(L.view) });
    if (!r.ok) inp.value = text;
    else if (r.queued) toast(`Entraste a la cola del Usuario: puesto ${r.pos}.`);
    $("#msg") && $("#msg").focus();
    return;
  }
  if (k === "reply") {
    const inp = e.target.querySelector("input"), text = (inp.value || "").trim();
    if (!text) return;
    inp.value = "";
    const r = await emit("admin:reply", { team: +e.target.dataset.t, text });
    if (!r.ok) inp.value = text;
    inp.focus();
    return;
  }
  if (k === "prompt") {
    const ta = $("#bc"), text = (ta.value || "").trim();
    if (!text) return;
    const target = $("#bcTarget").value;
    const isTask = ((e.submitter && e.submitter.dataset.kind) || L.bcKind) === "task";
    L.bcKind = null;
    const n = (L.view.tasks || []).length + 1;
    const r = await emit("admin:prompt", { text, team: target === "all" ? "all" : +target, task: isTask });
    const to = target === "all" ? "todos los Modelos" : `el equipo ${+target + 1}`;
    if (r.ok) { ta.value = ""; toast(isTask ? `Tarea ${n} creada y enviada a ${to}.` : `Aclaración enviada a ${to}.`); }
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && L.adminTeam !== null) { L.adminTeam = null; render(); } });

// iPad: al abrir el teclado, el chat se encoge al espacio que queda visible y baja hasta el último
// mensaje, para que el teclado no tape la conversación (Safari no achica la página por sí solo)
const vv = window.visualViewport;
function fitKeyboard() {
  if (!vv) return;
  const a = document.activeElement, chat = a && a.matches("input.input") && a.closest(".chat, .livechat");
  const open = !!chat && window.innerHeight - vv.height > 120;
  document.documentElement.style.setProperty("--vvh", Math.round(vv.height) + "px");
  document.documentElement.classList.toggle("kb", open);
  if (!open) return;
  window.scrollTo(0, chat.getBoundingClientRect().top + window.scrollY - 8);
  const m = $("#msgs"); if (m) m.scrollTop = m.scrollHeight;
}
if (vv) vv.addEventListener("resize", fitKeyboard);
document.addEventListener("focusin", () => setTimeout(fitKeyboard, 350));
document.addEventListener("focusout", () => setTimeout(fitKeyboard, 350));

// mantener la pantalla del iPad encendida cuando el navegador lo permite
let wake = null;
async function keepAwake() { try { if ("wakeLock" in navigator && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => (wake = null)); } } catch (_) {} }
document.addEventListener("pointerdown", keepAwake, { once: false, passive: true });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });

render();
