// Sé una IA por un d-IA — cliente (alpha)
// La misma página sirve a los PCs/iPads de la sala (/) y al panel del admin (/admin).
// El servidor manda una "vista" ya filtrada por rol; aquí solo se dibuja y se envían acciones.

const ROLES = ["thinking", "modelo", "arnes", "revisor"];
const RN = { thinking: "Thinking", modelo: "Modelo", arnes: "Arnés", revisor: "Revisor", profesor: "Usuario" };
const RC = { thinking: "var(--t)", modelo: "var(--m)", arnes: "var(--a)", revisor: "var(--r)", profesor: "var(--y)" };
const RHEX = { thinking: "#007F92", modelo: "#D32985", arnes: "#9A6400", revisor: "#0051C6", profesor: "#6E6800" };
const RTX = { thinking: "#000", modelo: "#fff", arnes: "#000", revisor: "#fff", profesor: "#000" };
const ARTICLE = { thinking: "THINKING", modelo: "EL MODELO", arnes: "EL ARNÉS", revisor: "EL REVISOR" };
const CHN = { A: "Usuario → Thinking", B: "Thinking → Modelo", C: "Modelo → Arnés", D: "Revisor → Thinking", E: "Revisor ↔ Usuario" };
const PLACE = { B: "Pregúntale al Modelo…", C: "Órdenes para el Arnés…", D: "Reporte para Thinking…", E: "Pregunta o confirma con el Usuario…" };
// Reglas que cada rol ve siempre a un lado del chat
const RULES = {
  thinking: [
    "Piensas el plan y se lo explicas al Modelo.",
    "Todo lo que escribes sale como pregunta: el sistema le agrega ¿ ? automáticamente.",
    "Recibes el prompt del Usuario y los reportes y fotos del Revisor.",
    "No hablas con el Arnés y no tocas los materiales.",
  ],
  modelo: [
    "Solo escribes órdenes al Arnés para que las haga físicamente.",
    "No ves el prompt del Usuario: solo lo que te pregunta Thinking.",
    "No tocas los materiales ni le dices al Arnés cómo pensar: solo qué hacer.",
  ],
  arnes: [
    "Eres el ejecutor: solo haces cosas físicas con los materiales.",
    "Haces exactamente lo que ordena el Modelo, nada más.",
    "No escribes ni hablas con nadie.",
  ],
  revisor: [
    "Observas lo que hace el Arnés y se lo reportas a Thinking.",
    "Puedes mandarle fotos del avance a Thinking.",
    "Si necesitas confirmar algo con el Usuario (profesor), cambia el interruptor a Usuario.",
    "No tocas los materiales ni le das órdenes al Arnés.",
  ],
};
const AUTHORS = ["David Octavio Ibarra", "Sebastián Suárez", "Francisco Santamaría", "Ángel Peñaranda"];
const credits = () => `<footer class="credits">Creado por ${AUTHORS.map(esc).join(" · ")} y el equipo CREA · Facultad de Ingeniería, Universidad de los Andes</footer>`;
const RULE_ALL ="Prohibido usar internet, el celular o buscar información: el agente solo sabe lo que está en el chat.";
const camIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="14" r="3.5"/></svg>`;
const HINT = {
  thinking: "Recibes el prompt del profesor y el feedback del Revisor. Piensa el plan y escríbeselo al Modelo. No hablas con el Arnés.",
  modelo: "Recibes el razonamiento de Thinking y lo conviertes en instrucciones claras y cortas para el Arnés. Nunca ves el prompt original.",
  arnes: "Solo lees las instrucciones del Modelo y construyes con las manos. No puedes escribir: haz exactamente lo que dice.",
  revisor: "Lees lo que el Modelo le pide al Arnés y miras el puente. Escríbele feedback a Thinking para cerrar el ciclo.",
};

const IS_ADMIN = location.pathname.replace(/\/+$/, "") === "/admin";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mmss = (s) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};

function deviceId() {
  let id = store.get("seunaia-device");
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    store.set("seunaia-device", id);
  }
  return id;
}

const L = { view: null, connected: false, err: "", toast: null, answer: null, adminTeam: null, confirm: null, hintUntil: 0, lastRole: null, seen: new Set(), lastHtml: "", firstPaint: true,
  revTo: "thinking", rulesOpen: true, picking: false, sending: false, waiting: new Set() };
const socket = io({ reconnectionDelay: 800, reconnectionDelayMax: 4000 });

function toast(text) { L.toast = { text, until: Date.now() + 3200 }; render(); }
function emit(ev, data) {
  return new Promise((res) => socket.timeout(6000).emit(ev, data || {}, (err, r) => {
    if (err) { toast("Sin respuesta del servidor. Revisa la conexión."); return res({ error: "timeout" }); }
    if (r && r.error) toast(r.error);
    res(r || {});
  }));
}

socket.on("connect", () => {
  L.connected = true;
  if (IS_ADMIN) {
    const token = store.get("seunaia-admin");
    if (token) emit("admin:login", { token }).then((r) => { if (!r.ok) { store.del("seunaia-admin"); render(); } });
  } else socket.emit("hello", { deviceId: deviceId() });
  render();
});
socket.on("disconnect", () => { L.connected = false; render(); });
socket.on("view", (v) => {
  const prev = L.view;
  L.view = v;
  // si el rol de este PC cambió (rotación), mostrar la pista del nuevo rol unos segundos
  if (v.kind === "device" && v.you && prev && prev.you && prev.phase === "rotate" && v.phase === "activity") { L.hintUntil = Date.now() + 10000; L.rulesOpen = true; L.revTo = "thinking"; }
  // admin: avisar cuando un Revisor escribe y espera respuesta
  if (v.kind === "admin") {
    v.teams.forEach((tm, t) => { if (tm.waiting && !L.waiting.has(t)) toast(`El Revisor del equipo ${t + 1} te escribió.`); });
    L.waiting = new Set(v.teams.map((tm, t) => (tm.waiting ? t : -1)).filter((t) => t >= 0));
  }
  render();
});
// el admin liberó este iPad: se olvida su puesto y vuelve a la pantalla de inicio
socket.on("released", () => {
  store.del("seunaia-device");
  L.view = null;
  socket.emit("hello", { deviceId: deviceId() });
  toast("El admin liberó este iPad. Entra con tu nickname para volver a tu puesto.");
});

// ---------- Piezas ----------
const bean = (role, cls = "") => `<div class="bean ${cls}" style="background:${RC[role]}" aria-hidden="true"><i></i></div>`;
const rolePill = (role, txt) => `<span class="pill" style="background:${RC[role]};color:${RTX[role]}">${esc(txt || RN[role].toUpperCase())}</span>`;
const logos = () => `<img class="logo-crea" src="/assets/crea.png" alt="CREA"><img class="logo-ua" src="/assets/uniandes-blanco.png" alt="Universidad de los Andes, Facultad de Ingeniería">`;
function topbar(extra = "") {
  return `<div class="topbar"><div class="grp"><img class="logo-crea" src="/assets/crea.png" alt="CREA">${extra}</div>
    <div class="grp"><span class="conn${L.connected ? "" : " off"}"><i></i>${L.connected ? "Conectado" : "Reconectando…"}</span><img class="logo-ua" src="/assets/uniandes-blanco.png" alt="Universidad de los Andes, Facultad de Ingeniería"></div></div>`;
}

// ---------- Vistas de los PCs ----------
function vLanding() {
  const late = L.view && L.view.phase !== "lobby";
  return `<div class="landing">
  <div class="top anim">${logos()}</div>
  <div class="center">
    <div class="rings anim" style="animation-delay:.05s"><span class="ring"><i style="background:var(--t)"></i></span><span class="ring"><i style="background:var(--m)"></i></span><span class="ring"><i style="background:var(--a)"></i></span><span class="ring"><i style="background:var(--r)"></i></span><span class="tp">4 personas · 1 agente</span></div>
    <h1 class="lockup anim" style="animation-delay:.12s" aria-label="Sé una IA por un día"><span class="lines"><span class="dots">SÉ UNA</span><span class="dots">POR UN D-</span></span><span class="dots ia">IA</span></h1>
    <form class="joinbox anim" style="animation-delay:.3s" data-submit="noop">
      <label class="field"><span>TU NICKNAME</span><input class="input" id="nick" maxlength="16" autocomplete="off" autocapitalize="off" placeholder="robotina_42"></label>
      <span class="field"><span>ESCOGE EL ROL DE TU MESA</span></span>
      <div class="roles">${ROLES.map((r) => `<button type="button" class="btn" style="background:${RC[r]};color:${RTX[r]}" data-act="join" data-role="${r}"${L.connected ? "" : " disabled"}>${RN[r].toUpperCase()}</button>`).join("")}</div>
      <div class="err" role="status">${esc(L.err || (late ? "La actividad ya empezó: entra y el admin te asignará a un equipo." : ""))}</div>
      <div class="back"><span>¿Ya estabas jugando y se te cerró o cambiaste de iPad?</span>
        <button type="button" class="btn white sm" data-act="reclaim"${L.connected ? "" : " disabled"}>Volver a mi puesto con este nickname</button></div>
      <a class="btn dark" style="align-self:center;display:inline-flex;align-items:center;text-decoration:none" href="/admin">Soy el admin</a>
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
  return `${topbar(`<span class="muted" style="font-size:13px">Sesión ${esc(v.code)}</span>`)}<div class="stage">
    <span class="muted" style="font-size:12px;letter-spacing:.3em;font-weight:600">ESTE ES EL PC ${v.you.pc}${v.you.nick ? " · " + esc(v.you.nick) : ""}</span>
    ${rolePill(r, "ERES " + ARTICLE[r])}
    <div class="hintcard anim">${bean(r, "lg")}<div><b style="font-size:11px;letter-spacing:.14em;color:${RHEX[r]}">PISTA</b><p style="margin:4px 0 0;font-size:15px;line-height:1.45">${HINT[r]}</p></div></div>
    <div class="card rules" style="width:min(560px,100%);text-align:left">${rulesList(r, false)}</div>
    <div class="spin" role="img" aria-label="Cargando"></div>
    <div style="font-size:13px;font-weight:600;letter-spacing:.2em">${unassigned ? "ESPERANDO A QUE EL ADMIN TE ASIGNE UN EQUIPO" : `ESPERANDO JUGADORES · <b class="dots" style="font-size:22px">${v.counts.online}</b> CONECTADOS`}</div>
  </div>`;
}

// Casilla de reglas del rol (siempre visible en el chat; se puede plegar)
function rulesList(r, foldable) {
  const items = RULES[r].map((x) => `<li>${esc(x)}</li>`).join("") + `<li class="all">${esc(RULE_ALL)}</li>`;
  const title = `<span class="rt" style="color:${RC[r]}">REGLAS DE TU ROL · ${RN[r].toUpperCase()}${r === "arnes" ? " (EJECUTOR)" : ""}</span>`;
  if (!foldable) return `${title}<ul>${items}</ul>`;
  return `<details id="rules"${L.rulesOpen ? " open" : ""}><summary>${title}</summary><ul>${items}</ul></details>`;
}

function bubble(m) {
  const name = m.mine ? "TÚ" : m.role === "profesor" ? "USUARIO (PROFESOR)" : RN[m.role].toUpperCase() + " · " + m.nick;
  const photo = m.img ? `<a href="${esc(m.img)}" target="_blank" rel="noopener" class="photo"><img src="${esc(m.img)}" alt="Foto del Revisor" loading="lazy"></a>` : "";
  return `<div class="bubble"><span class="n" style="color:${RHEX[m.role]}">${esc(name)}</span>${photo}${m.text ? (m.cut ? "…" : "") + esc(m.text) : ""}</div>`;
}

function vChat(v) {
  const r = v.you.role, c = v.context, pct = Math.min(100, (c.used / c.limit) * 100);
  const now = Date.now(), forgot = c.forgot && now - c.forgot.at < 3000;
  let last = null, html = "";
  v.msgs.forEach((m) => {
    if (m.ch !== last) { html += `<div class="sep">${m.ch} · ${esc(CHN[m.ch]).toUpperCase()}</div>`; last = m.ch; }
    const old = m.id === c.oldestId && pct > 85;
    html += `<div data-id="${m.id}" class="msg${m.mine ? " me" : ""}${old ? " old" : ""}${L.seen.has(m.id) ? "" : " new"}">${bean(m.role)}${bubble(m)}</div>`;
  });
  if (!v.msgs.length) html = `<div class="empty">${r === "thinking" ? '<div class="spin" style="width:40px;height:40px"></div>Esperando el prompt del Usuario…' : "Aún no te llega nada. Espera tu mensaje o juega al lado."}</div>`;
  const dis = v.paused || L.sending ? " disabled" : "";
  let compose;
  if (v.revisor) {
    // interruptor: a quién le escribe el Revisor
    const ch = L.revTo === "profesor" ? "E" : "D";
    compose = `<div class="revbar" role="group" aria-label="Destino del mensaje"><span class="muted">Escribirle a:</span>
        <button type="button" class="seg${L.revTo === "thinking" ? " on" : ""}" aria-pressed="${L.revTo === "thinking"}" data-act="revTo" data-to="thinking">Thinking</button>
        <button type="button" class="seg${L.revTo === "profesor" ? " on" : ""}" aria-pressed="${L.revTo === "profesor"}" data-act="revTo" data-to="profesor">Usuario (profesor)</button></div>
      <form class="compose" data-submit="send"><input class="input" id="msg" maxlength="280" autocomplete="off" placeholder="${PLACE[ch]}" aria-label="Mensaje"${dis}>
        <label class="btn dark camera${dis ? " off" : ""}" for="photo" data-act="pick" aria-label="Mandar foto a ${L.revTo === "profesor" ? "el Usuario" : "Thinking"}" title="Mandar foto">${camIcon}</label>
        <input type="file" id="photo" accept="image/*" capture="environment" hidden${dis}>
        <button class="btn" style="background:${RC.revisor};color:#fff"${dis}>ENVIAR</button></form>`;
  } else if (v.channel) {
    compose = `${r === "thinking" ? `<div class="qnote">Todo lo que escribas se envía como pregunta: <b>¿…?</b></div>` : ""}
      <form class="compose" data-submit="send"><input class="input" id="msg" maxlength="280" autocomplete="off" placeholder="${PLACE[v.channel]}" aria-label="Mensaje"${dis}><button class="btn" style="background:${RC[r]};color:${RTX[r]}"${dis}>ENVIAR</button></form>`;
  } else compose = `<div class="ro">SOLO LECTURA · TÚ CONSTRUYES CON LAS MANOS</div>`;
  const hint = now < L.hintUntil ? `<div class="hintcard anim" style="width:100%;margin-bottom:14px">${bean(r, "lg")}<p style="margin:0;font-size:15px;line-height:1.45"><b>Ahora eres ${RN[r]}.</b> ${HINT[r]}${v.fallback ? " En tu equipo no hay Revisor: también haces su trabajo (reportes, fotos y preguntas al Usuario)." : ""}</p></div>` : "";
  return `${topbar(`${rolePill(r)}<span class="dots" style="font-size:26px">PC ${v.you.pc}</span><span class="muted">${esc(v.you.nick || "")}</span>`)}${hint}
    <div class="pchead"><span class="muted" style="font-size:13px">${v.fallback ? "Sin Revisor en tu equipo: tú das el feedback." : ""}</span>
      <div class="hud"><span><b>${c.used}</b> / ${c.limit} CARACTERES${c.bonus ? ` <span class="muted">(base ${c.base})</span>` : ""}</span><div class="bar${forgot ? " flash" : ""}"><span style="width:${pct}%;background:${RC[r]}"></span></div>${c.bonus ? `<span class="bonus">${esc(c.bonusLog)} · total +${c.bonus}</span>` : ""}</div></div>
    <div class="pcgrid"><section class="card chat" aria-label="Chat">
      ${forgot ? `<div class="forgot">Se olvidaron ${c.forgot.n} caracteres</div>` : ""}
      <div class="msgs" id="msgs">${html}</div>${compose}
      ${v.paused ? `<div class="overlay"><span class="dots" style="font-size:44px">PAUSA</span><span class="muted">El admin pausó la actividad</span></div>` : ""}
    </section><div class="side"><div class="card rules">${rulesList(r, true)}</div>${v.question ? vMini(v) : ""}</div></div>`;
}

function vMini(v) {
  const q = v.question, a = L.answer && Date.now() - L.answer.at < 2600 ? L.answer : null;
  const opts = a ? a.options : q.options;
  return `<aside class="card mini" aria-label="Minijuego"><span class="flag">MINIJUEGO</span>
    <div class="q">${esc(a ? a.text : q.text)}</div>
    ${opts.map((o) => {
      let cls = "";
      if (a) { if (o.k === 1) cls = " ok"; else if (o.k === a.picked) cls = " bad"; }
      return `<button class="opt${cls}" data-act="answer" data-q="${q.id}" data-k="${o.k}"${a ? " disabled" : ""}>${esc(o.text)}</button>`;
    }).join("")}
    <p class="muted" style="margin:4px 0 0;font-size:12.5px;line-height:1.45">Cada acierto le da <b style="color:var(--y)">+40 caracteres</b> a tu vecino de mesa${v.neighborPc ? ` (PC ${v.neighborPc})` : ""}, nunca a ti.</p></aside>`;
}

function vRotate(v) {
  const R = v.rotation;
  return `${topbar()}<div class="stage rotate">
    ${R.outgoing ? `<div class="go">${esc(R.outgoing.nick)}, levántate y ve al <b>PC ${R.outgoing.toPc}</b></div><div class="divider"></div>` : ""}
    <span class="muted" style="font-size:13px;font-weight:600;letter-spacing:.3em">ESTE ES EL</span>
    <span class="big" style="font-size:clamp(110px,22vw,260px);text-shadow:0 0 30px rgba(255,255,255,.45)">PC ${v.you.pc}</span>
    ${R.incoming ? `<div style="font-size:15px;color:var(--soft)">Aquí se sienta: <b style="color:#fff">${esc(R.incoming.nick)}</b></div>
      ${R.incoming.ready ? `<span class="pill" style="background:var(--t);color:#000;height:44px;font-size:14px">✓ ${esc(R.incoming.nick)} está listo</span>`
      : `<button class="btn white" style="min-width:220px;min-height:56px;font-size:20px;animation:pulse 2s ease-in-out infinite" data-act="ready" data-id="${R.incoming.id}">¡LISTO!</button>`}` : ""}
    <span class="muted" style="font-size:12px;font-weight:600;letter-spacing:.2em">LISTOS <b class="dots" style="font-size:22px;color:#fff">${R.ready}/${R.total}</b></span>
  </div>`;
}

function vDevice(v) {
  if (!v || !v.registered) return vLanding();
  if (v.phase === "end") return `${topbar()}<div class="stage"><span class="big" style="font-size:clamp(60px,12vw,140px)">FIN</span><p class="muted">Gracias por ser una IA por un día.</p></div>`;
  if (v.phase === "rotate" && v.rotation && (v.rotation.outgoing || v.rotation.incoming)) return vRotate(v);
  if (v.phase === "activity" && v.context) return vChat(v);
  return vWaiting(v);
}

// ---------- Panel admin ----------
function vLogin() {
  return `<div class="stage"><div class="card anim" style="background:#fff;color:#000;padding:28px;width:min(380px,100%);display:flex;flex-direction:column;gap:16px;align-items:center;border-radius:28px">
    <img class="logo-crea" src="/assets/crea.png" alt="CREA"><h1 class="h1" style="font-size:34px">MODO ADMIN</h1>
    <form data-submit="login" style="width:100%;display:flex;flex-direction:column;gap:12px">
      <label class="field"><span style="color:#2e2e2e">CLAVE DE LA SESIÓN</span><input class="input" id="pw" type="password" style="background:#EEF1F5;color:#000;border-color:#d5d9e0" autocomplete="current-password"></label>
      <div class="row" style="justify-content:center"><a class="btn dark" style="display:inline-flex;align-items:center;text-decoration:none" href="/">Volver</a><button class="btn" style="background:var(--y)"${L.connected ? "" : " disabled"}>Entrar</button></div>
    </form></div></div>`;
}

function teamOptions(v, d) {
  const opts = [`<option value=""${d.team === null ? " selected" : ""}>Sin equipo</option>`];
  v.teams.forEach((_, t) => opts.push(`<option value="${t}"${d.team === t ? " selected" : ""}>Equipo ${t + 1}</option>`));
  if (v.teams.length < 8) opts.push(`<option value="${v.teams.length}">+ Equipo nuevo</option>`);
  return opts.join("");
}
function devTable(v) {
  if (!v.devices.length) return `<div class="card" style="padding:20px;text-align:center" class="muted">Todavía no se conecta nadie. Abre la dirección del servidor en los iPads.</div>`;
  return `<div class="card tablewrap"><table class="devs"><thead><tr><th>PC</th><th>PERSONA</th><th>ROL (MESA)</th><th>EQUIPO</th><th></th></tr></thead><tbody>
    ${v.devices.map((d) => `<tr><td><span class="online${d.online ? "" : " no"}" title="${d.online ? "En línea" : "Desconectado"}"></span><b class="dots" style="font-size:18px">PC ${d.pc}</b></td>
      <td>${esc(d.nick || "—")}</td>
      <td><select aria-label="Rol del PC ${d.pc}" data-change="role" data-id="${esc(d.id)}">${ROLES.map((r) => `<option value="${r}"${d.role === r ? " selected" : ""}>${RN[r]}</option>`).join("")}</select></td>
      <td><select aria-label="Equipo del PC ${d.pc}" data-change="team" data-id="${esc(d.id)}">${teamOptions(v, d)}</select></td>
      <td style="text-align:right;white-space:nowrap">${d.online && d.nick ? `<button class="btn dark sm" data-act="release" data-id="${esc(d.id)}" title="Para cuando un iPad se traba: la persona vuelve desde otro iPad con su nickname">${L.confirm === "release:" + d.id ? "¿Seguro? Liberar" : "Liberar"}</button> ` : ""}<button class="btn dark sm" data-act="kick" data-id="${esc(d.id)}">${L.confirm === "kick:" + d.id ? "¿Seguro? Quitar" : "Quitar"}</button></td></tr>`).join("")}
  </tbody></table></div>`;
}
function teamCard(v, tm, t, live) {
  const devs = v.devices.filter((d) => d.team === t);
  const slots = ROLES.map((r) => { const d = devs.find((x) => x.role === r);
    return `<div class="slot"><span class="dot" style="background:${RC[r]}"></span>${d ? esc(d.nick || "—") : "<span class='muted'>vacío</span>"}<span class="pc">${RN[r]}${d ? " · PC " + d.pc : ""}</span></div>`; }).join("");
  const feed = live ? `<div class="bar"><span style="width:${Math.min(100, (tm.used / tm.limit) * 100)}%;background:${tm.used / tm.limit > 0.85 ? "var(--m)" : "var(--t)"}"></span></div>
    <div class="feed">${tm.msgs.slice(-5).map((m) => `<span><b style="color:${RC[m.role]}">${m.ch}›</b> ${m.img ? "[foto] " : ""}${esc(m.text)}</span>`).join("") || "<span class='muted'>Sin mensajes todavía</span>"}</div>` : "";
  const ask = live && tm.waiting ? `<button class="btn sm askbtn" data-act="openTeam" data-t="${t}">El Revisor te escribió · Responder</button>` : "";
  return `<div class="card team${live && tm.waiting ? " asking" : ""}"><h3>EQUIPO ${t + 1}${live ? `<span class="muted">${tm.used}/${tm.limit}${tm.bonus ? " (+" + tm.bonus + ")" : ""}</span>` : ""}</h3>
    ${ask}${feed}${slots}${tm.warnings.map((w) => `<span class="warn">▲ ${esc(w)}</span>`).join("")}
    ${live ? `<button class="btn dark sm" data-act="openTeam" data-t="${t}">Ver los canales</button>` : ""}</div>`;
}
function vAdmin(v) {
  const head = (title, right) => `${topbar(`<span class="lbl" style="font-size:11px;font-weight:700;letter-spacing:.18em;color:var(--y)">PANEL ADMIN · ${esc(v.code)}</span>`)}<div class="admhead"><h1 class="h1" style="font-size:34px;color:var(--y)">${title}</h1><div class="row">${right}</div></div>`;
  const resetBtn = `<button class="btn dark" data-act="reset">${L.confirm === "reset" ? "¿Seguro? Se borra todo" : "Nueva sesión"}</button>`;
  const ac = v.acceso;
  const connBtn = `<a class="btn dark" style="display:inline-flex;align-items:center;text-decoration:none" href="/conectar" target="_blank" rel="noopener">Pantalla de conexión (QR) ↗</a>`;
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
      </div>
      <p class="muted" style="margin:0;font-size:13px">El sistema arma los equipos a medida que entran (1 persona por rol). Cambia el rol o el equipo de cualquier PC en la tabla; si el puesto ya está ocupado, se intercambian.</p>
      <div class="teams">${v.teams.map((tm, t) => teamCard(v, tm, t, false)).join("") || "<p class='muted'>Aún no hay equipos.</p>"}</div>
      ${devTable(v)}
      <div class="row" style="justify-content:flex-end"><button class="btn dark" data-act="reshuffle">Rearmar al azar</button><button class="btn" style="background:var(--y);box-shadow:0 0 24px rgba(235,226,18,.45)" data-act="start">INICIAR ACTIVIDAD</button></div>
    </div>`;
  }
  if (v.phase === "end") {
    return `<div class="adm">${head("RESUMEN", resetBtn)}<div class="teams">${v.teams.map((tm, t) => `<div class="card team"><h3>EQUIPO ${t + 1}</h3><span>${tm.sent} mensajes enviados</span><span>${tm.forgotTotal} caracteres olvidados</span><span>+${tm.bonus} caracteres ganados en el minijuego</span></div>`).join("")}</div></div>`;
  }
  const rot = v.phase === "rotate";
  const ready = rot ? v.rotation.filter((x) => x.ready).length : 0;
  const auto = v.cfg.autoRot !== false;
  const right = `<span style="font-size:12px;font-weight:600;letter-spacing:.12em">${rot ? "LISTOS" : "RONDA " + v.round + (auto ? " · ROTACIÓN EN" : " · ROTACIÓN DETENIDA")} <b class="dots" style="font-size:26px">${rot ? ready + "/" + v.rotation.length : mmss(v.timerLeft)}</b></span>
    ${rot ? `<button class="btn" style="background:var(--t)" data-act="forceResume">Reanudar sin esperar</button>` : `<button class="btn dark" data-act="pause">${v.paused ? "Reanudar actividad" : "Pausar actividad"}</button><button class="btn" style="background:var(--m);color:#fff" data-act="rotate">Rotar ya</button>`}
    <button class="btn dark" data-act="end">${L.confirm === "end" ? "¿Seguro? Terminar" : "Terminar"}</button>${connBtn}`;
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
      <span class="muted" style="font-size:12px">caracteres por equipo (más lo ganado en el minijuego)</span></div></div>`;
  const readyL = rot ? `<div class="card" style="padding:14px"><div class="readyl">${v.rotation.map((x) => `<span class="pill" style="background:${x.ready ? "var(--t)" : "var(--pill)"};color:${x.ready ? "#000" : "#c8c8c8"}">${x.ready ? "✓" : x.online ? "…" : "⚠"} ${esc(x.nick)} → PC ${x.toPc}</span>`).join("")}</div></div>` : "";
  const bc = rot ? "" : `<form class="card bc" data-submit="prompt"><textarea id="bc" maxlength="600" placeholder="Prompt para los Thinking. Ej: Construyan un puente de pasta que aguante un celular." aria-label="Prompt"></textarea>
    <div class="row"><select class="input" id="bcTarget" style="width:auto" aria-label="Destino"><option value="all">Todos los equipos</option>${v.teams.map((_, t) => `<option value="${t}">Solo equipo ${t + 1}</option>`).join("")}</select><button class="btn" style="background:var(--y)">ENVIAR PROMPT</button></div></form>`;
  return `<div class="adm">${head(rot ? "ROTANDO" : v.paused ? "EN PAUSA" : "EN VIVO", right)}${readyL}${controls}${bc}
    <div class="teams">${v.teams.map((tm, t) => teamCard(v, tm, t, true)).join("")}</div>
    <details id="devs" class="card" style="padding:14px"><summary style="cursor:pointer;font-weight:600">Dispositivos (${v.devices.length}) · asignar personas que llegan tarde</summary><div style="margin-top:12px">${devTable(v)}</div></details>
    ${L.adminTeam !== null && v.teams[L.adminTeam] ? vTeamModal(v, L.adminTeam) : ""}</div>`;
}
function vTeamModal(v, t) {
  const tm = v.teams[t];
  return `<div class="modal" data-act="closeTeam"><div class="card" data-stop="1" role="dialog" aria-label="Canales del equipo ${t + 1}"><div class="admhead"><h2 class="h1" style="font-size:28px">EQUIPO ${t + 1}</h2><button class="btn dark" data-act="closeTeam">Cerrar</button></div>
    <div class="chgrid">${["E", "A", "B", "C", "D"].map((c) => `<div class="chcol${c === "E" ? " e" : ""}"><h4>${c} · ${CHN[c].toUpperCase()}</h4>${tm.msgs.filter((m) => m.ch === c).map((m) => `<p><b style="color:${RC[m.role]}">${esc(m.role === "profesor" ? "tú" : m.nick)}:</b> ${m.img ? `<a href="${esc(m.img)}" target="_blank" rel="noopener"><img class="thumb" src="${esc(m.img)}" alt="Foto del Revisor"></a>` : ""}${m.cut ? "…" : ""}${esc(m.text)}</p>`).join("") || "<p class='muted'>—</p>"}
      ${c === "E" ? `<form class="replyf" data-submit="reply" data-t="${t}"><input class="input" id="reply" maxlength="280" autocomplete="off" placeholder="Responder al Revisor…" aria-label="Respuesta al Revisor"><button class="btn sm" style="background:var(--y)">Responder</button></form>` : ""}</div>`).join("")}</div></div></div>`;
}

// ---------- Render ----------
function render() {
  // con un menú desplegable abierto no se redibuja (se cerraría); el intervalo lo intenta de nuevo
  if (document.activeElement && document.activeElement.tagName === "SELECT") return;
  // mientras se escoge una foto no se redibuja: en iPad se perdería la foto elegida
  if (L.picking && Date.now() - L.picking < 120000) return;
  const a = document.activeElement, fid = a && a.id, ss = a && a.selectionStart;
  const keep = {};
  ["nick", "pw", "msg", "bc", "cfgLimit", "reply"].forEach((id) => { const el = document.getElementById(id); if (el) keep[id] = el.value; });
  const bcT = $("#bcTarget") && $("#bcTarget").value;
  const details = $("#devs") && $("#devs").open;
  const m = $("#msgs"), stick = !m || m.scrollHeight - m.scrollTop - m.clientHeight < 60, prevTop = m ? m.scrollTop : 0;

  let html;
  if (IS_ADMIN) html = L.view && L.view.kind === "admin" ? vAdmin(L.view) : vLogin();
  else html = L.view ? vDevice(L.view) : `<div class="stage"><div class="spin"></div><p class="muted">Conectando con el servidor…</p></div>`;
  // la landing muestra la autoría en grande; las demás pantallas, pequeña al pie
  const onLanding = !IS_ADMIN && L.view && !L.view.registered;
  if (!onLanding) html += credits();

  if (html !== L.lastHtml) {
    $("#app").innerHTML = html;
    L.lastHtml = html;
    Object.entries(keep).forEach(([id, val]) => { const el = document.getElementById(id); if (el && (id !== "cfgLimit" || id === fid)) el.value = val; });
    if (bcT && $("#bcTarget")) $("#bcTarget").value = bcT;
    if (details && $("#devs")) $("#devs").open = true;
    if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { if (ss != null) el.setSelectionRange(ss, ss); } catch (_) {} } }
    const m2 = $("#msgs"); if (m2) m2.scrollTop = stick ? m2.scrollHeight : prevTop;
    if (!L.firstPaint) document.querySelectorAll("#app .anim").forEach((el) => (el.style.animation = "none"));
    L.firstPaint = false;
    document.querySelectorAll("#app .msg[data-id]").forEach((el) => L.seen.add(+el.dataset.id));
  }
  const tEl = $("#toast");
  if (L.toast && Date.now() < L.toast.until) { if (tEl.dataset.t !== L.toast.text) { tEl.innerHTML = `<div class="toast" role="status">${esc(L.toast.text)}</div>`; tEl.dataset.t = L.toast.text; } }
  else if (tEl.innerHTML) { tEl.innerHTML = ""; tEl.dataset.t = ""; }
}
// refresco suave para que expiren avisos, la estela de "olvido" y el resultado del minijuego
setInterval(render, 500);
function fresh() { L.firstPaint = true; render(); }

// ---------- Acciones ----------
document.addEventListener("click", async (e) => {
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
  if (act === "revTo") { L.revTo = el.dataset.to; render(); $("#msg") && $("#msg").focus(); return; }
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
      L.answer = { at: Date.now(), picked: k, text: q.text, options: q.options };
      toast(r.correct ? (r.toPc ? `¡Correcto! +${r.bonus} caracteres para tu vecino del PC ${r.toPc}.` : `¡Correcto! +${r.bonus} caracteres para el equipo vecino.`) : `Casi. La respuesta era: ${r.correctText}`);
    }
    return;
  }
  if (act === "ready") { await emit("ready", { personId: +id }); return; }
  if (act === "start") { const r = await emit("admin:start"); if (r.ok) toast("¡Actividad iniciada! Envía el prompt a los Thinking."); return; }
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
      let q = 0.75, data = c.toDataURL("image/jpeg", q);
      while (data.length > 1400000 && q > 0.3) { q -= 0.15; data = c.toDataURL("image/jpeg", q); }
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la foto.")); };
    img.src = url;
  });
}
async function sendPhoto(file) {
  L.picking = false;
  if (!file) { render(); return; }
  L.sending = true; toast("Enviando foto…");
  try {
    const image = await shrinkPhoto(file);
    const caption = ($("#msg") && $("#msg").value.trim()) || "";
    const r = await emit("send", { text: caption, to: L.revTo, image });
    if (r.ok) { if ($("#msg")) $("#msg").value = ""; toast(`Foto enviada a ${L.revTo === "profesor" ? "el Usuario" : "Thinking"}.`); }
  } catch (err) { toast(err.message); }
  L.sending = false; render();
}
document.addEventListener("toggle", (e) => { if (e.target.id === "rules") L.rulesOpen = e.target.open; }, true);
// si se cierra el selector de fotos sin escoger, seguir dibujando
window.addEventListener("focus", () => setTimeout(() => { if (L.picking && !($("#photo") && $("#photo").files.length)) { L.picking = false; render(); } }, 800));
document.addEventListener("change", (e) => {
  if (e.target.id === "photo") { sendPhoto(e.target.files && e.target.files[0]); return; }
  const k = e.target.dataset.change;
  if (!k) return;
  const id = e.target.dataset.id;
  if (k === "role") emit("admin:assign", { deviceId: id, role: e.target.value });
  if (k === "team") emit("admin:assign", { deviceId: id, team: e.target.value === "" ? null : +e.target.value });
  if (k === "cfgLimit") emit("admin:config", { limit: +e.target.value });
  if (k === "cfgMode") emit("admin:config", { mode: e.target.value });
  if (k === "cfgRot") emit("admin:config", { rotSec: +e.target.value });
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const k = e.target.dataset.submit;
  if (k === "login") {
    const r = await emit("admin:login", { password: $("#pw").value });
    if (r.ok) { store.set("seunaia-admin", r.token); fresh(); } else { $("#pw").value = ""; }
    return;
  }
  if (k === "send") {
    const inp = $("#msg"), text = (inp.value || "").trim();
    if (!text) return;
    inp.value = "";
    const r = await emit("send", { text, to: L.view && L.view.revisor ? L.revTo : undefined });
    if (!r.ok) inp.value = text;
    $("#msg") && $("#msg").focus();
    return;
  }
  if (k === "reply") {
    const inp = $("#reply"), text = (inp.value || "").trim();
    if (!text) return;
    const r = await emit("admin:reply", { team: +e.target.dataset.t, text });
    if (r.ok) { inp.value = ""; toast("Respuesta enviada al Revisor."); }
    return;
  }
  if (k === "prompt") {
    const ta = $("#bc"), text = (ta.value || "").trim();
    if (!text) return;
    const target = $("#bcTarget").value;
    const r = await emit("admin:prompt", { text, team: target === "all" ? "all" : +target });
    if (r.ok) { ta.value = ""; toast(target === "all" ? "Prompt enviado a todos los Thinking." : `Prompt enviado al equipo ${+target + 1}.`); }
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && L.adminTeam !== null) { L.adminTeam = null; render(); } });

// mantener la pantalla del iPad encendida cuando el navegador lo permite
let wake = null;
async function keepAwake() { try { if ("wakeLock" in navigator && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => (wake = null)); } } catch (_) {} }
document.addEventListener("pointerdown", keepAwake, { once: false, passive: true });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });

render();
