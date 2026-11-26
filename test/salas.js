// Salas simultáneas: un solo servidor con 3 salas, 3 admins y jugadores en cada una.
// Verifica que las salas no se mezclan: equipos, mensajes, cola del Usuario, rotación, archivos,
// "Nueva sesión", claves y tokens de admin, y que un teléfono juega en una sola sala.
// Uso: node test/salas.js  (o npm test)
process.env.PORT = process.env.PORT || "3997";
process.env.SEUNAIA_SIN_MDNS = "1";
process.env.SEUNAIA_READY_COOLDOWN_MS = "0";
process.env.SEUNAIA_SALAS = "3";
process.env.ADMIN_PASSWORD_3 = "tres"; // la Sala 3 tiene clave propia; la 1 y la 2 usan la general
const fs = require("fs");
const path = require("path");
const DATA = fs.mkdtempSync(path.join(require("os").tmpdir(), "seunaia-salas-"));
process.env.SEUNAIA_DATA = DATA;
process.argv.push("--nueva");
const { server } = require("../server.js");
const { io } = require("socket.io-client");
const URL = `http://localhost:${process.env.PORT}`;
const PW = process.env.ADMIN_PASSWORD || "crea2026";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, d) => new Promise((r) => s.timeout(6000).emit(ev, d || {}, (err, res) => r(err ? { error: "timeout" } : (res || {}))));
let fails = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FALLA ") + msg); if (!ok) fails++; };
const socks = [];
// engancha los eventos al crear el socket (si no, en localhost puede conectar antes de escuchar)
const mk = () => { const s = io(URL, { forceNew: true }); s.last = null; s.salas = null; s.on("view", (v) => (s.last = v)); s.on("salas", (l) => (s.salas = l)); socks.push(s); return s; };
const up = (s) => new Promise((r) => (s.connected ? r() : s.once("connect", r)));
const texts = (s) => ((s.last && s.last.msgs) || []).map((m) => m.text);
const IDS = ["1", "2", "3"];
const ROLES = ["modelo", "arnes", "revisor"];

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once("listening", r)));

  // --- S1/S2: selector de sala ---
  const x = mk(); await up(x); await wait(80);
  check(x.salas && x.salas.length === 3 && x.salas[1].name === "Sala 2", "S1: al conectar, el teléfono recibe la lista de las 3 salas");
  const h0 = await call(x, "hello", { browserId: "suelto" });
  check(h0.ok && h0.sala === null, "S2: sin ?sala (y sin jugar en ninguna) el teléfono ve el selector");
  check(/sala/i.test((await call(x, "join", { nick: "z", role: "modelo" })).error || ""), "S2: sin escoger sala no puede entrar a jugar");
  const h1 = await call(x, "hello", { browserId: "suelto", sala: "3" });
  await wait(80); // la vista llega justo después de la respuesta
  check(h1.ok && h1.sala === "3" && x.last && x.last.sala.id === "3", "S2: al escoger la Sala 3 queda atado a esa sala");
  x.close();

  // --- S3: 3 jugadores por sala; el mismo nickname puede existir en salas distintas ---
  const P = {};
  for (const sala of IDS) {
    P[sala] = [];
    let ok = true;
    for (let i = 0; i < 3; i++) {
      const s = mk(); await up(s);
      const h = await call(s, "hello", { sala, browserId: `s${sala}-${i}` });
      const j = await call(s, "join", { nick: i === 0 ? "ana" : `p${sala}${i}`, role: ROLES[i] });
      ok = ok && h.sala === sala && !!j.ok;
      P[sala].push(s);
    }
    check(ok, `S3: 3 jugadores entran a la Sala ${sala} (Modelo "ana", Arnés, Revisor)`);
  }
  check(true, 'S3: "ana" juega a la vez en las 3 salas (el nickname es único solo dentro de su sala)');

  // --- S4: un admin por sala, con su clave y su token ---
  const A = {}, tok = {};
  for (const sala of ["1", "2"]) {
    A[sala] = mk(); await up(A[sala]);
    const r = await call(A[sala], "admin:login", { sala, password: PW });
    tok[sala] = r.token;
    check(r.ok && r.sala === sala, `S4: el admin de la Sala ${sala} entra con la clave general`);
  }
  A["3"] = mk(); await up(A["3"]);
  check(!!(await call(A["3"], "admin:login", { sala: "3", password: PW })).error, "S4: la Sala 3 tiene clave propia: la general no sirve");
  check(!!(await call(A["3"], "admin:login", { sala: "3", password: "tres" })).ok, "S4: con su clave propia el admin de la Sala 3 entra");
  const intruso = mk(); await up(intruso);
  check(!!(await call(intruso, "admin:login", { sala: "1", password: "tres" })).error, "S4: la clave de la Sala 3 no abre la Sala 1");
  check(!!(await call(intruso, "admin:login", { sala: "2", token: tok["1"] })).error, "S4: el token del admin de la Sala 1 no sirve en la Sala 2");
  check(!!(await call(intruso, "admin:start")).error, "S4: un socket sin sala no puede usar comandos de admin");
  check(!!(await call(A["1"], "admin:login", { sala: "2", password: PW })).error, "S4: el admin de la Sala 1 no salta a la Sala 2 sin recargar");
  await wait(150);
  for (const sala of IDS) {
    const v = A[sala].last;
    const nicks = v.devices.map((d) => d.nick).sort().join(",");
    check(v.sala.id === sala && v.devices.length === 3 && nicks === ["ana", `p${sala}1`, `p${sala}2`].sort().join(","), `S4: el admin de la Sala ${sala} solo ve a su gente (${nicks})`);
  }

  // --- S5: un teléfono juega en UNA sala ---
  const redir = mk(); await up(redir);
  const hr = await call(redir, "hello", { sala: "2", browserId: "s1-1" });
  await wait(80);
  check(hr.sala === "1" && redir.last && redir.last.registered && redir.last.sala.id === "1", "S5: un teléfono de la Sala 1 que abre el QR de la Sala 2 vuelve a la Sala 1");
  const sinSala = mk(); await up(sinSala);
  check((await call(sinSala, "hello", { browserId: "s3-2" })).sala === "3", "S5: al abrir sin ?sala, el teléfono vuelve solo a su sala");
  const w2 = mk(); await up(w2); await call(w2, "hello", { sala: "2", browserId: "dup" }); // queda en la Sala 2 sin jugar
  const w1 = mk(); await up(w1); await call(w1, "hello", { sala: "1", browserId: "dup" });
  check(!!(await call(w1, "join", { nick: "dup", role: "revisor" })).ok, "S5: (el teléfono 'dup' entra a jugar en la Sala 1)");
  const jd = await call(w2, "join", { nick: "dup2", role: "modelo" });
  check(/Sala 1/.test(jd.error || ""), "S5: ese mismo teléfono no puede jugar también en la Sala 2");
  await wait(100);
  const dupDev = A["1"].last.devices.find((d) => d.nick === "dup");
  await call(A["1"], "admin:kick", { deviceId: dupDev.id });

  // --- S6: cada sala arranca por su cuenta ---
  for (const sala of IDS) await call(A[sala], "admin:config", { queueSec: 0, coolSec: 0 });
  check(!!(await call(A["1"], "admin:start")).ok, "S6: el admin de la Sala 1 inicia su actividad");
  await wait(120);
  check(A["2"].last.phase === "lobby" && P["2"][0].last.phase === "lobby" && A["3"].last.phase === "lobby", "S6: las Salas 2 y 3 siguen en el lobby");
  await call(A["2"], "admin:start");
  await wait(100);

  // --- S7: mensajes y prompts no cruzan de sala ---
  await call(A["1"], "admin:prompt", { text: "Construyan un puente (sala 1)", team: "all" });
  await call(A["2"], "admin:prompt", { text: "Hagan una torre (sala 2)", team: "all" });
  await call(P["1"][0], "send", { text: "orden de la sala 1", to: "arnes" });
  await wait(150);
  check(texts(P["1"][0]).includes("Construyan un puente (sala 1)") && !texts(P["1"][0]).some((t) => t.includes("sala 2")), "S7: el Modelo de la Sala 1 recibe solo el prompt de su admin");
  check(texts(P["2"][0]).includes("Hagan una torre (sala 2)") && !texts(P["2"][0]).some((t) => t.includes("sala 1")), "S7: el Modelo de la Sala 2 recibe solo el prompt de su admin");
  check(texts(P["1"][1]).includes("orden de la sala 1") && !texts(P["2"][1]).includes("orden de la sala 1"), "S7: la orden al Arnés de la Sala 1 no le llega al Arnés de la Sala 2");

  // --- S8: cada sala tiene su propio Usuario (su propia cola y conversación) ---
  await call(P["1"][0], "send", { text: "hola usuario 1", to: "usuario" });
  await call(P["2"][0], "send", { text: "hola usuario 2", to: "usuario" });
  await wait(1300); // el reloj atiende la cola cada segundo
  check(A["1"].last.live && A["1"].last.live.team === 0 && A["2"].last.live && A["2"].last.live.team === 0, "S8: las dos conversaciones con el Usuario se abren a la vez, una en cada sala");
  await call(A["1"], "admin:reply", { team: 0, text: "respuesta del admin 1" });
  await wait(120);
  check(texts(P["1"][0]).includes("respuesta del admin 1") && !texts(P["2"][0]).includes("respuesta del admin 1"), "S8: la respuesta del admin 1 solo le llega al Modelo de la Sala 1");
  check(A["2"].last.teams[0].msgs.every((m) => m.text !== "hola usuario 1"), "S8: el admin de la Sala 2 no ve lo que el Modelo de la Sala 1 le escribe al suyo");

  // --- S9: archivos del Revisor por sala ---
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const subir = (dev) => fetch(`${URL}/subir`, { method: "POST", headers: { "Content-Type": "image/jpeg", "X-Device": dev, "X-Name": "foto.jpg" }, body: jpg }).then((r) => r.json());
  const f1 = await subir("s1-2");
  check(!!f1.id && fs.existsSync(path.join(DATA, "sala-1", "archivos", f1.id)), "S9: la foto del Revisor de la Sala 1 se guarda en data/sala-1/archivos");
  check((await fetch(`${URL}/archivo/${f1.id}`)).status === 200, "S9: la foto se descarga por /archivo");
  check(!!(await call(P["2"][2], "send", { text: "robada", to: "modelo", file: f1.id })).error, "S9: el Revisor de la Sala 2 no puede mandar un archivo de la Sala 1");
  check(!!(await subir("s3-2")).error, "S9: el Revisor de una sala sin actividad no puede subir");

  // --- S10: la rotación de una sala no mueve a las otras ---
  check(!!(await call(A["1"], "admin:rotate")).ok, "S10: el admin de la Sala 1 rota");
  await wait(120);
  check(A["1"].last.phase === "rotate" && A["2"].last.phase === "activity" && P["2"][0].last.phase === "activity", "S10: solo la Sala 1 entra en rotación");
  for (const s of P["1"]) await call(s, "ready");
  await wait(150);
  check(A["1"].last.phase === "activity" && A["1"].last.round === 2 && A["2"].last.round === 1, "S10: la Sala 1 pasa a la ronda 2; la Sala 2 sigue en la 1");

  // --- S11: respaldo en disco por sala ---
  await wait(2300); // el respaldo se escribe 2 s después del último cambio
  const snap = (sala) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, "sala-" + sala, "sesion.json"), "utf8")); } catch (_) { return null; } };
  const sn = IDS.map(snap);
  check(sn.every((s, i) => s && s.sala === IDS[i] && Object.keys(s.state.persons).length === 3), "S11: cada sala guarda su propio respaldo (data/sala-N/sesion.json)");

  // --- S12: "Nueva sesión" borra solo su sala ---
  check(!!(await call(A["2"], "admin:reset")).ok, "S12: el admin de la Sala 2 hace Nueva sesión");
  await wait(150);
  check(A["2"].last.devices.length === 0 && A["2"].last.phase === "lobby", "S12: la Sala 2 queda vacía");
  check(A["1"].last.devices.length === 3 && A["1"].last.phase === "activity" && A["3"].last.devices.length === 3, "S12: las Salas 1 y 3 siguen intactas");

  // --- S13: pantalla de conexión (QR) por sala ---
  const c2 = await fetch(`${URL}/conectar?sala=2`).then((r) => r.text());
  check(c2.includes("?sala=2") && (c2.match(/<svg/g) || []).length === 1, "S13: /conectar?sala=2 muestra solo el QR de la Sala 2");
  const call3 = await fetch(`${URL}/conectar`).then((r) => r.text());
  check((call3.match(/<svg/g) || []).length === 3 && call3.includes("Sala 3"), "S13: /conectar sin sala muestra un QR por cada sala");

  socks.forEach((s) => s.close());
  server.close();
  console.log(fails ? `\n  ${fails} FALLAS` : "\n  SALAS OK");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
