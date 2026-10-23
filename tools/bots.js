// Jugadores de prueba para ensayar sin gente.
// Uso: node tools/bots.js [cantidad=7] [url=http://localhost]
// Entran repartidos entre los 3 roles, responden en su canal y marcan LISTO al rotar.
const { io } = require("socket.io-client");
const N = Number(process.argv[2]) || 7;
const URL = process.argv[3] || "http://localhost";
const ROLES = ["modelo", "arnes", "revisor"];
const LINES = {
  modelo: ["1. Corta 6 palitos de 10 cm. 2. Une 3 en triángulo.", "Pon una segunda capa encima del tablero.", "Dobla 3 tallarines en arco bajo el centro."],
  revisor: ["El lado izquierdo se dobla.", "Las uniones están firmes.", "El tablero se hunde en el centro."],
};
// qué canales escucha cada rol y a quién le contesta (el Arnés no escribe)
// el Revisor no recibe mensajes del Modelo: reporta cada cierto tiempo, como si mirara al Arnés
const LISTEN = { modelo: ["U", "R"] };
const TO = { modelo: ["arnes"], revisor: ["modelo"] };
const REPORT_MS = 15000;

for (let i = 0; i < N; i++) {
  const role = ROLES[i % ROLES.length], s = io(URL, { forceNew: true });
  let seen = new Set(), line = 0, joined = false, readySent = false, lastReport = 0;
  s.on("connect", () => s.emit("hello", { deviceId: "bot-" + i }, () => {
    if (!joined) s.emit("join", { nick: "bot" + (i + 1), role }, () => (joined = true));
  }));
  s.on("view", (v) => {
    if (v.phase === "rotate" && v.rotation && v.rotation.incoming && !v.rotation.incoming.ready && !readySent) {
      readySent = true;
      setTimeout(() => s.emit("ready", { personId: v.rotation.incoming.id }, () => {}), 1500 + Math.random() * 5000);
    }
    if (v.phase !== "rotate") readySent = false;
    if (v.phase !== "activity" || !v.msgs || v.paused) return;
    const myRole = v.you.role, listen = LISTEN[myRole] || [];
    const fresh = v.msgs.filter((m) => !seen.has(m.id));
    fresh.forEach((m) => seen.add(m.id));
    const report = myRole === "revisor" && Date.now() - lastReport > REPORT_MS;
    if (report) lastReport = Date.now();
    if (v.sendTo && v.sendTo.length && (report || fresh.some((m) => !m.mine && listen.includes(m.ch)))) {
      const arr = LINES[myRole], to = TO[myRole][line % TO[myRole].length];
      setTimeout(() => s.emit("send", { text: arr[line++ % arr.length], to }, () => {}), 2500 + Math.random() * 3500);
    }
  });
}
console.log(`${N} bots conectándose a ${URL}…`);
