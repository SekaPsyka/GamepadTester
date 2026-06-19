import "./style.css";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { applyDeadzone, detectControllerType, getConnectedGamepads, getLabelsFor } from "./gamepad.js";
import { getTheme, setTheme } from "./storage.js";
import { THEMES, applyTheme } from "./themes.js";

const app = document.getElementById("app");

app.innerHTML = `
  <header>
    <div class="header-row">
      <div class="header-id">
        <h1>Gamepad Tester</h1>
        <div class="status-pill"><span class="dot" id="dot"></span><span id="padName">Aucune manette détectée</span></div>
      </div>
    </div>
    <div class="header-row">
      <div class="header-controls">
        <div class="status-pill" title="Mesure plafonnée par le navigateur (~60Hz sur Chrome, ~20Hz sur Firefox) — pas la fréquence USB réelle de la manette.">Polling: <span class="value mono" id="pollRate">0</span> Hz</div>
        <label class="field">Thème<select id="themeSelect"></select></label>
        <label class="field">Manette<select id="padSelect"><option value="">—</option></select></label>
      </div>
      <div class="header-actions">
        <button id="exportReportBtn" title="Exporte un rapport de diagnostic en PDF avec l'état actuel de la manette">Exporter rapport (PDF)</button>
        <button id="resetDataBtn" class="danger" title="Réinitialise la latence, le chatter, les calibrations, le drift, l'historique et les captures filaire/sans-fil">Réinitialiser les données</button>
      </div>
    </div>
  </header>

  <div class="empty-state" id="emptyState">
    <div class="empty-state-pulse"></div>
    <h2>En attente d'une manette</h2>
    <p>Branche une manette filaire ou appaire-la en Bluetooth, puis appuie sur un bouton pour la réveiller.</p>
  </div>

  <div class="grid" id="grid">
    <section class="panel">
      <h2>Joystick gauche</h2>
      <div class="stick-row">
        <canvas class="stick" id="leftCanvas" width="180" height="180"></canvas>
        <div class="sliders" style="flex:1">
          <label>Dead zone intérieure: <span class="mono" id="leftInnerVal"></span></label>
          <input type="range" id="leftInner" min="0" max="0.9" step="0.01" value="0.1" />
          <label>Dead zone extérieure: <span class="mono" id="leftOuterVal"></span></label>
          <input type="range" id="leftOuter" min="0.1" max="1" step="0.01" value="0.95" />
          <div class="coord">
            Brut: <b class="mono" id="leftRaw">0.00, 0.00</b><br/>
            Ajusté: <b class="mono" id="leftAdj">0.00, 0.00</b>
          </div>
          <div style="display:flex; gap:8px; margin-top:10px">
            <button id="leftCalibBtn">Démarrer calibration de range</button>
            <button id="leftCalibReset" class="danger">Réinitialiser</button>
          </div>
          <p class="note" id="leftCalibResult"></p>
        </div>
      </div>
    </section>

    <section class="panel">
      <h2>Joystick droit</h2>
      <div class="stick-row">
        <canvas class="stick" id="rightCanvas" width="180" height="180"></canvas>
        <div class="sliders" style="flex:1">
          <label>Dead zone intérieure: <span class="mono" id="rightInnerVal"></span></label>
          <input type="range" id="rightInner" min="0" max="0.9" step="0.01" value="0.1" />
          <label>Dead zone extérieure: <span class="mono" id="rightOuterVal"></span></label>
          <input type="range" id="rightOuter" min="0.1" max="1" step="0.01" value="0.95" />
          <div class="coord">
            Brut: <b class="mono" id="rightRaw">0.00, 0.00</b><br/>
            Ajusté: <b class="mono" id="rightAdj">0.00, 0.00</b>
          </div>
          <div style="display:flex; gap:8px; margin-top:10px">
            <button id="rightCalibBtn">Démarrer calibration de range</button>
            <button id="rightCalibReset" class="danger">Réinitialiser</button>
          </div>
          <p class="note" id="rightCalibResult"></p>
        </div>
      </div>
    </section>

    <section class="panel">
      <h2>Gâchettes &amp; vibration</h2>
      <div class="trigger-row">
        <div class="trigger-label"><span>LT</span><span class="mono" id="ltVal">0%</span></div>
        <div class="trigger-bar-bg"><div class="trigger-bar-fill" id="ltBar"></div></div>
      </div>
      <div class="trigger-row">
        <div class="trigger-label"><span>RT</span><span class="mono" id="rtVal">0%</span></div>
        <div class="trigger-bar-bg"><div class="trigger-bar-fill" id="rtBar"></div></div>
      </div>
      <div class="vibration-controls">
        <button id="vibWeak">Test rumble faible</button>
        <button id="vibStrong">Test rumble fort</button>
        <button id="vibStop" class="danger">Stop</button>
      </div>
      <p class="note" id="vibNote"></p>
    </section>

    <section class="panel">
      <h2>Boutons <span class="note" style="display:inline">— latence moyenne: <span id="avgLatency" class="value mono" style="color:var(--accent)">n/a</span> — chatter détecté: <span id="chatterCount" class="value mono" style="color:var(--accent-alt)">0</span></span></h2>
      <div class="buttons-grid" id="buttonsGrid"></div>
      <p class="note" title="Chatter: un bouton se déclenche plusieurs fois pour une seule pression physique, souvent dû à l'usure d'un switch/contact.">Le chatter est détecté quand un bouton se relâche puis se ré-enfonce en moins de 60 ms — trop rapide pour une vraie double-pression humaine.</p>
    </section>

    <section class="panel span-2">
      <h2>Stabilité des sticks (axe X, détection de drift)</h2>
      <p class="note" style="margin:0 0 6px">Gauche</p>
      <canvas class="graph" id="driftGraphLeft" width="1200" height="70"></canvas>
      <p class="note" style="margin:14px 0 6px">Droit</p>
      <canvas class="graph" id="driftGraphRight" width="1200" height="70"></canvas>
      <p class="note">Au repos, ces lignes doivent rester plates au centre. Des oscillations indiquent du stick drift.</p>
    </section>

    <section class="panel span-2">
      <h2>Historique des appuis</h2>
      <div id="pressLog" class="press-log"></div>
      <p class="note">Dernières 20 entrées, avec latence détectée (delta entre le timestamp matériel de la manette et la réception navigateur, si supporté).</p>
    </section>

    <section class="panel span-2">
      <h2>Comparaison filaire / sans-fil</h2>
      <p class="note" style="margin:0 0 10px">Branche la manette dans un mode, laisse-la inactive quelques secondes puis appuie sur quelques boutons pour accumuler des échantillons, puis capture. Change de mode (câble/Bluetooth) et capture à nouveau pour comparer.</p>
      <div class="compare-row">
        <div class="compare-col">
          <h3>Filaire</h3>
          <button id="captureWired">Capturer la session actuelle</button>
          <p class="note" id="wiredSnapshot">Aucune capture.</p>
        </div>
        <div class="compare-col">
          <h3>Sans-fil</h3>
          <button id="captureWireless">Capturer la session actuelle</button>
          <p class="note" id="wirelessSnapshot">Aucune capture.</p>
        </div>
      </div>
      <p class="note" id="compareDelta"></p>
    </section>
  </div>
`;

const dot = document.getElementById("dot");
const padName = document.getElementById("padName");
const pollRateEl = document.getElementById("pollRate");
const emptyState = document.getElementById("emptyState");
const grid = document.getElementById("grid");

function setConnectedUI(connected) {
  dot.classList.toggle("connected", connected);
  emptyState.classList.toggle("visible", !connected);
  grid.classList.toggle("disconnected", !connected);
  if (!connected) padName.textContent = "Aucune manette détectée";
}
setConnectedUI(false);

const themeSelect = document.getElementById("themeSelect");
for (const [id, theme] of Object.entries(THEMES)) {
  const opt = document.createElement("option");
  opt.value = id;
  opt.textContent = theme.label;
  themeSelect.appendChild(opt);
}
const savedTheme = getTheme();
themeSelect.value = savedTheme;
applyTheme(savedTheme);
themeSelect.addEventListener("change", () => {
  applyTheme(themeSelect.value);
  setTheme(themeSelect.value);
});

const leftCanvas = document.getElementById("leftCanvas");
const rightCanvas = document.getElementById("rightCanvas");
const leftCtx = leftCanvas.getContext("2d");
const rightCtx = rightCanvas.getContext("2d");

const sliders = {
  left: {
    inner: document.getElementById("leftInner"),
    outer: document.getElementById("leftOuter"),
    innerVal: document.getElementById("leftInnerVal"),
    outerVal: document.getElementById("leftOuterVal"),
  },
  right: {
    inner: document.getElementById("rightInner"),
    outer: document.getElementById("rightOuter"),
    innerVal: document.getElementById("rightInnerVal"),
    outerVal: document.getElementById("rightOuterVal"),
  },
};

function syncSliderLabels() {
  for (const side of ["left", "right"]) {
    sliders[side].innerVal.textContent = Number(sliders[side].inner.value).toFixed(2);
    sliders[side].outerVal.textContent = Number(sliders[side].outer.value).toFixed(2);
  }
}
for (const side of ["left", "right"]) {
  sliders[side].inner.addEventListener("input", syncSliderLabels);
  sliders[side].outer.addEventListener("input", syncSliderLabels);
}
syncSliderLabels();

const buttonsGrid = document.getElementById("buttonsGrid");
let buttonCells = [];
let currentLabels = [];

function rebuildButtonGrid(labels) {
  currentLabels = labels;
  buttonsGrid.innerHTML = "";
  buttonCells = labels.map((label, i) => {
    const cell = document.createElement("div");
    cell.className = "btn-cell";
    cell.textContent = label;
    cell.dataset.index = i;
    buttonsGrid.appendChild(cell);
    return cell;
  });
}

const padSelect = document.getElementById("padSelect");
let selectedPadIndex = null;

function refreshPadList() {
  const pads = getConnectedGamepads();
  const previousValue = padSelect.value;
  padSelect.innerHTML = "";
  if (pads.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "—";
    padSelect.appendChild(opt);
    selectedPadIndex = null;
    return;
  }
  for (const pad of pads) {
    const opt = document.createElement("option");
    opt.value = pad.index;
    opt.textContent = `#${pad.index} — ${pad.id}`;
    padSelect.appendChild(opt);
  }
  const stillConnected = pads.some((p) => String(p.index) === previousValue);
  padSelect.value = stillConnected ? previousValue : String(pads[0].index);
  selectedPadIndex = Number(padSelect.value);
}

function getSelectedGamepad() {
  const pads = getConnectedGamepads();
  return pads.find((p) => p.index === selectedPadIndex) || pads[0] || null;
}

padSelect.addEventListener("change", () => {
  selectedPadIndex = padSelect.value === "" ? null : Number(padSelect.value);
});

refreshPadList();

const ltBar = document.getElementById("ltBar");
const rtBar = document.getElementById("rtBar");
const ltVal = document.getElementById("ltVal");
const rtVal = document.getElementById("rtVal");

const vibNote = document.getElementById("vibNote");
document.getElementById("vibWeak").addEventListener("click", () => playRumble(0.3, 0.0));
document.getElementById("vibStrong").addEventListener("click", () => playRumble(0.0, 1.0));
document.getElementById("vibStop").addEventListener("click", () => playRumble(0, 0, 1));

function playRumble(weak, strong, duration = 600) {
  const pad = getSelectedGamepad();
  const actuator = pad?.vibrationActuator;
  if (!actuator) {
    vibNote.textContent = "Vibration non supportée par cette manette/navigateur.";
    return;
  }
  actuator
    .playEffect("dual-rumble", {
      startDelay: 0,
      duration,
      weakMagnitude: weak,
      strongMagnitude: strong,
    })
    .then(() => (vibNote.textContent = ""))
    .catch(() => (vibNote.textContent = "Effet de vibration refusé."));
}

function themeColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function drawStick(ctx, canvas, rawX, rawY, adjX, adjY, inner, outer, trail) {
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 10;
  const accent = themeColor("--accent-alt");
  const primary = themeColor("--accent");
  ctx.clearRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#1f2333";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(center, center, radius * outer, 0, Math.PI * 2);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(center, center, radius * inner, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.08;
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.moveTo(center - radius, center);
  ctx.lineTo(center + radius, center);
  ctx.moveTo(center, center - radius);
  ctx.lineTo(center, center + radius);
  ctx.strokeStyle = "#1f2333";
  ctx.stroke();

  if (trail && trail.length) {
    ctx.fillStyle = primary;
    ctx.globalAlpha = 0.35;
    for (const p of trail) {
      ctx.beginPath();
      ctx.arc(center + p.x * radius, center + p.y * radius, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // raw position (dim)
  ctx.beginPath();
  ctx.arc(center + rawX * radius, center + rawY * radius, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#3a3f55";
  ctx.fill();

  // adjusted position (neon)
  ctx.beginPath();
  ctx.arc(center + adjX * radius, center + adjY * radius, 6, 0, Math.PI * 2);
  ctx.fillStyle = primary;
  ctx.shadowColor = primary;
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.shadowBlur = 0;
}

const driftCanvasLeft = document.getElementById("driftGraphLeft");
const driftCanvasRight = document.getElementById("driftGraphRight");
const driftCtxLeft = driftCanvasLeft.getContext("2d");
const driftCtxRight = driftCanvasRight.getContext("2d");
const driftHistoryLeft = new Array(driftCanvasLeft.width).fill(0);
const driftHistoryRight = new Array(driftCanvasRight.width).fill(0);

function drawDrift(ctx, canvas, history) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#1f2333";
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = "#39ff8c";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < history.length; i++) {
    const y = h / 2 - history[i] * (h / 2 - 4);
    if (i === 0) ctx.moveTo(i, y);
    else ctx.lineTo(i, y);
  }
  ctx.stroke();
}

const calibration = {
  left: { active: false, points: [] },
  right: { active: false, points: [] },
};

// Analyse le tracé d'un stick par secteurs angulaires plutôt que par une simple rondeur globale.
// De nombreux sticks (notamment Xbox) ont un guide mécanique carré/octogonal: le rayon
// varie naturellement selon la direction (souvent plus grand en diagonale qu'à l'horizontale/verticale),
// mais ce profil reste symétrique. Une vraie anomalie (usure, drift localisé) se traduit par une
// asymétrie entre deux directions opposées, pas par un simple écart à un cercle parfait.
const SECTOR_COUNT = 16;

function analyzeRange(points) {
  if (points.length < 5) return "Pas assez de données, réessaie.";

  // On prend le rayon MAX atteint par secteur angulaire: les points de repos (proches du
  // centre) ne peuvent jamais devenir ce maximum, donc pas besoin de les filtrer en amont —
  // et surtout, ça évite d'effacer par erreur une vraie zone de rayon réduit (usure/drift).
  const sectorMax = new Array(SECTOR_COUNT).fill(0);
  for (const p of points) {
    const angle = Math.atan2(p.y, p.x);
    const normalized = ((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
    const sector = Math.min(SECTOR_COUNT - 1, Math.floor(normalized * SECTOR_COUNT));
    const r = Math.hypot(p.x, p.y);
    if (r > sectorMax[sector]) sectorMax[sector] = r;
  }

  const filledSectors = sectorMax.filter((r) => r > 0).length;
  if (filledSectors < SECTOR_COUNT * 0.75) {
    return "Tracé incomplet — fais un tour à 360° plus régulier pour une analyse fiable.";
  }

  let maxAsymmetry = 0;
  let worstPair = null;
  for (let i = 0; i < SECTOR_COUNT / 2; i++) {
    const opposite = i + SECTOR_COUNT / 2;
    const a = sectorMax[i];
    const b = sectorMax[opposite];
    if (a === 0 || b === 0) continue;
    const asymmetry = Math.abs(a - b) / Math.max(a, b);
    if (asymmetry > maxAsymmetry) {
      maxAsymmetry = asymmetry;
      worstPair = [i, opposite];
    }
  }

  const globalMin = Math.min(...sectorMax.filter((r) => r > 0));
  const globalMax = Math.max(...sectorMax);
  const roundness = (globalMin / globalMax) * 100;

  if (maxAsymmetry < 0.18) {
    return `Forme symétrique (rondeur globale: ${roundness.toFixed(0)}%) — une forme carrée/octogonale est normale sur de nombreux sticks (guide mécanique), aucune anomalie détectée ✓`;
  }

  const angleDeg = Math.round((worstPair[0] / SECTOR_COUNT) * 360);
  return `Asymétrie détectée (${(maxAsymmetry * 100).toFixed(0)}%) autour de ${angleDeg}° — une direction atteint un rayon nettement plus court que son opposée, ce qui peut indiquer une usure ou un stick drift localisé plutôt qu'un simple guide carré.`;
}

function setupCalibration(side, buttonId, resultId, resetId) {
  const btn = document.getElementById(buttonId);
  const resultEl = document.getElementById(resultId);
  const resetBtn = document.getElementById(resetId);
  const state = calibration[side];

  btn.addEventListener("click", () => {
    if (!state.active) {
      state.active = true;
      state.points = [];
      btn.textContent = "Arrêter & afficher le résultat";
      resultEl.textContent = "Calibration en cours — fais le tour complet du stick...";
    } else {
      state.active = false;
      btn.textContent = "Démarrer calibration de range";
      if (state.points.length < 5) {
        resultEl.textContent = "Pas assez de données, réessaie.";
        return;
      }
      const verdict = analyzeRange(state.points);
      resultEl.textContent = verdict;
    }
  });

  resetBtn.addEventListener("click", () => {
    state.active = false;
    state.points = [];
    btn.textContent = "Démarrer calibration de range";
    resultEl.textContent = "";
  });
}
setupCalibration("left", "leftCalibBtn", "leftCalibResult", "leftCalibReset");
setupCalibration("right", "rightCalibBtn", "rightCalibResult", "rightCalibReset");

const pressLog = document.getElementById("pressLog");
const avgLatencyEl = document.getElementById("avgLatency");
const latencySamples = [];
let currentAvgLatencyMs = null;

function logPress(label, latencyMs) {
  const entry = document.createElement("div");
  const time = new Date().toLocaleTimeString();
  entry.className = "press-log-entry";
  entry.textContent = latencyMs != null ? `[${time}] ${label} — latence ~${latencyMs.toFixed(1)} ms` : `[${time}] ${label}`;
  pressLog.prepend(entry);
  while (pressLog.children.length > 20) pressLog.removeChild(pressLog.lastChild);

  if (latencyMs != null && latencyMs >= 0 && latencyMs < 500) {
    latencySamples.push(latencyMs);
    if (latencySamples.length > 30) latencySamples.shift();
    currentAvgLatencyMs = latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length;
    avgLatencyEl.textContent = `${currentAvgLatencyMs.toFixed(1)} ms`;
  }
}

const compareSnapshots = { wired: null, wireless: null };
const compareElByMode = {
  wired: document.getElementById("wiredSnapshot"),
  wireless: document.getElementById("wirelessSnapshot"),
};
const compareDeltaEl = document.getElementById("compareDelta");

function renderCompareSnapshot(mode) {
  const snap = compareSnapshots[mode];
  const el = compareElByMode[mode];
  if (!snap) {
    el.textContent = "Aucune capture.";
    return;
  }
  el.textContent = `${snap.padId} — latence moy.: ${snap.avgLatencyMs.toFixed(1)} ms (${snap.sampleCount} échantillons) — Hz: ${snap.pollRateHz} — capturé à ${snap.capturedAt}`;
}

function renderCompareDelta() {
  const { wired, wireless } = compareSnapshots;
  if (!wired || !wireless) {
    compareDeltaEl.textContent = "";
    return;
  }
  const delta = wireless.avgLatencyMs - wired.avgLatencyMs;
  const sign = delta >= 0 ? "+" : "";
  compareDeltaEl.textContent = `Écart sans-fil vs filaire: ${sign}${delta.toFixed(1)} ms${delta > 0 ? " (sans-fil plus lent)" : delta < 0 ? " (sans-fil plus rapide, vérifie tes captures)" : " (aucune différence)"}`;
}

function captureCompareSnapshot(mode) {
  const pad = getSelectedGamepad();
  if (!pad) {
    compareElByMode[mode].textContent = "Aucune manette connectée.";
    return;
  }
  if (currentAvgLatencyMs == null || latencySamples.length < 5) {
    compareElByMode[mode].textContent = "Pas assez d'échantillons — appuie sur quelques boutons avant de capturer.";
    return;
  }
  compareSnapshots[mode] = {
    padId: pad.id,
    avgLatencyMs: currentAvgLatencyMs,
    sampleCount: latencySamples.length,
    pollRateHz,
    capturedAt: new Date().toLocaleTimeString(),
  };
  renderCompareSnapshot(mode);
  renderCompareDelta();
}

document.getElementById("captureWired").addEventListener("click", () => captureCompareSnapshot("wired"));
document.getElementById("captureWireless").addEventListener("click", () => captureCompareSnapshot("wireless"));

let prevButtonStates = [];
let lastReleaseTimes = [];
let lastPadCount = 0;
let lastPadId = null;

const CHATTER_THRESHOLD_MS = 60;
let chatterTotal = 0;
const chatterByButton = new Map();
const chatterCountEl = document.getElementById("chatterCount");

function buildDiagnosticReport() {
  const pad = getSelectedGamepad();
  return {
    generatedAt: new Date().toISOString(),
    gamepad: pad
      ? { id: pad.id, index: pad.index, mappingType: detectControllerType(pad.id), buttonCount: pad.buttons.length, axisCount: pad.axes.length }
      : null,
    pollRateHz,
    deadzones: {
      left: { inner: Number(sliders.left.inner.value), outer: Number(sliders.left.outer.value) },
      right: { inner: Number(sliders.right.inner.value), outer: Number(sliders.right.outer.value) },
    },
    calibration: {
      left: document.getElementById("leftCalibResult").textContent || null,
      right: document.getElementById("rightCalibResult").textContent || null,
    },
    latency: {
      averageMs: currentAvgLatencyMs != null ? Number(currentAvgLatencyMs.toFixed(1)) : null,
      sampleCount: latencySamples.length,
    },
    chatterEventsTotal: chatterTotal,
    chatterByButton: [...chatterByButton.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    wiredVsWirelessComparison: compareSnapshots,
  };
}

function isAsymmetryWarning(calibrationText) {
  return typeof calibrationText === "string" && calibrationText.startsWith("Asymétrie détectée");
}

function computeDiagnosticVerdict(report) {
  const items = [];

  if (!report.gamepad) {
    items.push({ status: "bad", title: "Manette", text: "Aucune manette connectée au moment de l'export." });
  } else {
    items.push({ status: "ok", title: "Manette", text: `${report.gamepad.id} détectée, ${report.gamepad.buttonCount} boutons, ${report.gamepad.axisCount} axes.` });
  }

  const leftWarn = isAsymmetryWarning(report.calibration.left);
  const rightWarn = isAsymmetryWarning(report.calibration.right);
  if (!report.calibration.left && !report.calibration.right) {
    items.push({ status: "neutral", title: "Sticks", text: "Aucune calibration de range effectuée — usure/drift localisé non vérifié." });
  } else if (leftWarn || rightWarn) {
    const sides = [leftWarn ? "gauche" : null, rightWarn ? "droit" : null].filter(Boolean).join(" et ");
    items.push({ status: "warn", title: "Sticks", text: `Asymétrie détectée sur le stick ${sides} — possible usure ou drift localisé, voir détail ci-dessous.` });
  } else {
    items.push({ status: "ok", title: "Sticks", text: "Aucune asymétrie détectée sur les sticks calibrés." });
  }

  if (report.latency.sampleCount < 5) {
    items.push({ status: "neutral", title: "Latence", text: "Pas assez d'échantillons — appuie sur quelques boutons pour mesurer." });
  } else if (report.latency.averageMs <= 20) {
    items.push({ status: "ok", title: "Latence", text: `${report.latency.averageMs} ms en moyenne — excellente réactivité.` });
  } else if (report.latency.averageMs <= 40) {
    items.push({ status: "warn", title: "Latence", text: `${report.latency.averageMs} ms en moyenne — correcte, peut indiquer du Bluetooth ou un polling réduit.` });
  } else {
    items.push({ status: "bad", title: "Latence", text: `${report.latency.averageMs} ms en moyenne — élevée, vérifie la connexion (sans-fil, dongle, câble).` });
  }

  if (report.chatterEventsTotal === 0) {
    items.push({ status: "ok", title: "Chatter", text: "Aucun événement de chatter détecté." });
  } else {
    const worst = report.chatterByButton[0];
    const detail = worst ? ` Bouton le plus touché: ${worst.label} (${worst.count} fois).` : "";
    items.push({
      status: report.chatterEventsTotal >= 5 ? "bad" : "warn",
      title: "Chatter",
      text: `${report.chatterEventsTotal} événement(s) détecté(s) sur ${report.chatterByButton.length} bouton(s).${detail}`,
    });
  }

  return items;
}

const PDF_MARGIN = 15;
const PDF_PAGE_WIDTH = 210;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
const PDF_CYAN = [0, 130, 150];
const PDF_MAGENTA = [180, 0, 150];
const PDF_DARK = [30, 32, 40];
const PDF_MUTED = [110, 110, 110];
const PDF_STATUS_COLORS = {
  ok: [30, 150, 90],
  warn: [200, 140, 0],
  bad: [200, 50, 50],
  neutral: [140, 140, 140],
};
const PDF_STATUS_LABELS = { ok: "OK", warn: "ATTENTION", bad: "PROBLÈME", neutral: "N/A" };

function pdfEnsureSpace(doc, y, needed) {
  if (y + needed > 280) {
    doc.addPage();
    return 18;
  }
  return y;
}

function pdfSectionHeader(doc, title, y, color) {
  y = pdfEnsureSpace(doc, y, 16);
  doc.setFillColor(...color);
  doc.rect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  doc.text(title, PDF_MARGIN + 3, y + 5.5);
  doc.setFont(undefined, "normal");
  return y + 8 + 5;
}

function pdfVerdictRow(doc, item, y) {
  const color = PDF_STATUS_COLORS[item.status];
  const lines = doc.splitTextToSize(item.text, PDF_CONTENT_WIDTH - 28);
  y = pdfEnsureSpace(doc, y, lines.length * 4.5 + 6);

  doc.setFillColor(...color);
  doc.circle(PDF_MARGIN + 2, y + 1, 1.3, "F");

  doc.setFontSize(9.5);
  doc.setFont(undefined, "bold");
  doc.setTextColor(...color);
  doc.text(`${item.title} — ${PDF_STATUS_LABELS[item.status]}`, PDF_MARGIN + 6, y + 2);
  y += 5;

  doc.setFont(undefined, "normal");
  doc.setTextColor(...PDF_DARK);
  doc.text(lines, PDF_MARGIN + 6, y);
  y += lines.length * 4.5 + 3;
  return y;
}

function buildDiagnosticPdf(report) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 18;

  doc.setFontSize(18);
  doc.setFont(undefined, "bold");
  doc.setTextColor(...PDF_DARK);
  doc.text("Gamepad Diagnostic Report", PDF_MARGIN, y);
  doc.setFont(undefined, "normal");
  doc.setFontSize(10);
  doc.setTextColor(...PDF_MUTED);
  y += 6;
  doc.text(`Généré le ${new Date(report.generatedAt).toLocaleString()}`, PDF_MARGIN, y);
  y += 10;

  y = pdfSectionHeader(doc, "Résumé du diagnostic", y, PDF_MAGENTA);
  for (const item of computeDiagnosticVerdict(report)) {
    y = pdfVerdictRow(doc, item, y);
  }
  y += 5;

  y = pdfSectionHeader(doc, "Manette", y, PDF_CYAN);
  doc.setFontSize(10);
  doc.setTextColor(...PDF_DARK);
  if (report.gamepad) {
    doc.text(`Nom: ${report.gamepad.id}`, PDF_MARGIN + 2, y);
    y += 5;
    doc.text(
      `Mapping détecté: ${report.gamepad.mappingType} — ${report.gamepad.buttonCount} boutons, ${report.gamepad.axisCount} axes`,
      PDF_MARGIN + 2,
      y
    );
    y += 5;
    doc.text(`Fréquence de polling mesurée: ${report.pollRateHz} Hz`, PDF_MARGIN + 2, y);
    y += 10;
  } else {
    doc.text("Aucune manette connectée au moment de l'export.", PDF_MARGIN + 2, y);
    y += 10;
  }

  y = pdfSectionHeader(doc, "Dead Zones", y, PDF_CYAN);
  autoTable(doc, {
    startY: y,
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    head: [["Stick", "Inner", "Outer"]],
    body: [
      ["Gauche", report.deadzones.left.inner.toFixed(2), report.deadzones.left.outer.toFixed(2)],
      ["Droit", report.deadzones.right.inner.toFixed(2), report.deadzones.right.outer.toFixed(2)],
    ],
    theme: "grid",
    headStyles: { fillColor: PDF_CYAN, textColor: 255 },
    styles: { fontSize: 10, textColor: PDF_DARK },
  });
  y = doc.lastAutoTable.finalY + 10;

  y = pdfSectionHeader(doc, "Calibration de range", y, PDF_MAGENTA);
  doc.setFontSize(10);
  doc.setTextColor(...PDF_DARK);
  for (const [label, text] of [
    ["Gauche", report.calibration.left || "Aucune calibration effectuée."],
    ["Droit", report.calibration.right || "Aucune calibration effectuée."],
  ]) {
    doc.setFont(undefined, "bold");
    doc.text(`${label}:`, PDF_MARGIN + 2, y);
    doc.setFont(undefined, "normal");
    const lines = doc.splitTextToSize(text, PDF_CONTENT_WIDTH - 4);
    y = pdfEnsureSpace(doc, y, lines.length * 5 + 8);
    doc.text(lines, PDF_MARGIN + 2, y + 5);
    y += lines.length * 5 + 8;
  }

  y = pdfSectionHeader(doc, "Latence & Chatter", y, PDF_MAGENTA);
  doc.setFontSize(10);
  doc.setTextColor(...PDF_DARK);
  const avgText =
    report.latency.averageMs != null ? `${report.latency.averageMs} ms (${report.latency.sampleCount} échantillons)` : "n/a";
  doc.text(`Latence moyenne: ${avgText}`, PDF_MARGIN + 2, y);
  y += 5;
  doc.text(`Événements de chatter détectés: ${report.chatterEventsTotal}`, PDF_MARGIN + 2, y);
  y += 8;

  if (report.chatterByButton.length > 0) {
    y = pdfEnsureSpace(doc, y, 16);
    autoTable(doc, {
      startY: y,
      margin: { left: PDF_MARGIN, right: PDF_MARGIN },
      head: [["Bouton", "Événements de chatter"]],
      body: report.chatterByButton.map((b) => [b.label, String(b.count)]),
      theme: "grid",
      headStyles: { fillColor: PDF_MAGENTA, textColor: 255 },
      styles: { fontSize: 9, textColor: PDF_DARK },
    });
    y = doc.lastAutoTable.finalY + 10;
  } else {
    y += 2;
  }

  y = pdfSectionHeader(doc, "Comparaison filaire / sans-fil", y, PDF_CYAN);
  const { wired, wireless } = report.wiredVsWirelessComparison;
  if (wired || wireless) {
    autoTable(doc, {
      startY: y,
      margin: { left: PDF_MARGIN, right: PDF_MARGIN },
      head: [["Mode", "Manette", "Latence moy.", "Échantillons", "Hz", "Capturé à"]],
      body: [
        wired
          ? ["Filaire", wired.padId, `${wired.avgLatencyMs.toFixed(1)} ms`, String(wired.sampleCount), String(wired.pollRateHz), wired.capturedAt]
          : ["Filaire", "—", "—", "—", "—", "—"],
        wireless
          ? [
              "Sans-fil",
              wireless.padId,
              `${wireless.avgLatencyMs.toFixed(1)} ms`,
              String(wireless.sampleCount),
              String(wireless.pollRateHz),
              wireless.capturedAt,
            ]
          : ["Sans-fil", "—", "—", "—", "—", "—"],
      ],
      theme: "grid",
      headStyles: { fillColor: PDF_CYAN, textColor: 255 },
      styles: { fontSize: 9, textColor: PDF_DARK },
    });
    y = doc.lastAutoTable.finalY + 6;
    if (wired && wireless) {
      const delta = wireless.avgLatencyMs - wired.avgLatencyMs;
      const sign = delta >= 0 ? "+" : "";
      doc.setFontSize(10);
      doc.setTextColor(...PDF_DARK);
      doc.text(`Écart sans-fil vs filaire: ${sign}${delta.toFixed(1)} ms`, PDF_MARGIN + 2, y);
    }
  } else {
    doc.setFontSize(10);
    doc.setTextColor(...PDF_DARK);
    doc.text("Aucune capture effectuée.", PDF_MARGIN + 2, y);
  }

  return doc;
}

document.getElementById("exportReportBtn").addEventListener("click", () => {
  const report = buildDiagnosticReport();
  const doc = buildDiagnosticPdf(report);
  doc.save(`gamepad-report-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`);
});

document.getElementById("resetDataBtn").addEventListener("click", () => {
  if (!window.confirm("Réinitialiser toutes les données collectées (latence, chatter, calibration, drift, comparaison) ? Cette action est irréversible.")) {
    return;
  }

  latencySamples.length = 0;
  currentAvgLatencyMs = null;
  avgLatencyEl.textContent = "n/a";

  chatterTotal = 0;
  chatterByButton.clear();
  chatterCountEl.textContent = "0";
  prevButtonStates = [];
  lastReleaseTimes = [];

  driftHistoryLeft.fill(0);
  driftHistoryRight.fill(0);

  pressLog.innerHTML = "";

  compareSnapshots.wired = null;
  compareSnapshots.wireless = null;
  renderCompareSnapshot("wired");
  renderCompareSnapshot("wireless");
  renderCompareDelta();

  document.getElementById("leftCalibReset").click();
  document.getElementById("rightCalibReset").click();
});

// Mesurée via une boucle séparée du rAF (voir startPollRateMeter), pour ne pas
// plafonner la lecture au taux de rafraîchissement de l'écran en plus du plafond
// déjà imposé par le navigateur (~60Hz Chrome, ~20Hz Firefox).
let pollRateHz = 0;

function startPollRateMeter() {
  let lastTimestamp = -1;
  let pollCount = 0;
  let lastPollSecond = performance.now();
  const recentRates = [];

  setInterval(() => {
    const pad = getSelectedGamepad();
    if (pad && pad.timestamp !== lastTimestamp) {
      lastTimestamp = pad.timestamp;
      pollCount++;
    }
    const now = performance.now();
    if (now - lastPollSecond >= 1000) {
      recentRates.push(pollCount);
      if (recentRates.length > 3) recentRates.shift();
      pollRateHz = Math.round(recentRates.reduce((a, b) => a + b, 0) / recentRates.length);
      pollCount = 0;
      lastPollSecond = now;
    }
  }, 2);
}
startPollRateMeter();

function loop() {
  const connectedCount = getConnectedGamepads().length;
  if (connectedCount !== lastPadCount) {
    lastPadCount = connectedCount;
    refreshPadList();
  }

  const pad = getSelectedGamepad();

  if (pad) {
    setConnectedUI(true);
    padName.textContent = pad.id;

    if (pad.id !== lastPadId) {
      lastPadId = pad.id;
      rebuildButtonGrid(getLabelsFor(pad.id));
      prevButtonStates = [];
      lastReleaseTimes = [];
    }

    pollRateEl.textContent = pollRateHz;
    const now = performance.now();

    const leftInner = Number(sliders.left.inner.value);
    const leftOuter = Number(sliders.left.outer.value);
    const rightInner = Number(sliders.right.inner.value);
    const rightOuter = Number(sliders.right.outer.value);

    const lx = pad.axes[0] ?? 0;
    const ly = pad.axes[1] ?? 0;
    const rx = pad.axes[2] ?? 0;
    const ry = pad.axes[3] ?? 0;

    const leftAdj = applyDeadzone(lx, ly, leftInner, leftOuter);
    const rightAdj = applyDeadzone(rx, ry, rightInner, rightOuter);

    if (calibration.left.active) calibration.left.points.push({ x: lx, y: ly });
    if (calibration.right.active) calibration.right.points.push({ x: rx, y: ry });

    drawStick(leftCtx, leftCanvas, lx, ly, leftAdj.x, leftAdj.y, leftInner, leftOuter, calibration.left.points);
    drawStick(rightCtx, rightCanvas, rx, ry, rightAdj.x, rightAdj.y, rightInner, rightOuter, calibration.right.points);

    document.getElementById("leftRaw").textContent = `${lx.toFixed(2)}, ${ly.toFixed(2)}`;
    document.getElementById("leftAdj").textContent = `${leftAdj.x.toFixed(2)}, ${leftAdj.y.toFixed(2)}`;
    document.getElementById("rightRaw").textContent = `${rx.toFixed(2)}, ${ry.toFixed(2)}`;
    document.getElementById("rightAdj").textContent = `${rightAdj.x.toFixed(2)}, ${rightAdj.y.toFixed(2)}`;

    driftHistoryLeft.push(lx);
    driftHistoryLeft.shift();
    driftHistoryRight.push(rx);
    driftHistoryRight.shift();
    drawDrift(driftCtxLeft, driftCanvasLeft, driftHistoryLeft);
    drawDrift(driftCtxRight, driftCanvasRight, driftHistoryRight);

    const lt = pad.buttons[6]?.value ?? 0;
    const rt = pad.buttons[7]?.value ?? 0;
    ltBar.style.width = `${lt * 100}%`;
    rtBar.style.width = `${rt * 100}%`;
    ltVal.textContent = `${Math.round(lt * 100)}%`;
    rtVal.textContent = `${Math.round(rt * 100)}%`;

    pad.buttons.forEach((btn, i) => {
      const cell = buttonCells[i];
      const pressed = btn.pressed || btn.value > 0.08;
      if (cell) {
        if (pressed) cell.classList.add("active");
        else cell.classList.remove("active");
      }
      const wasPressed = prevButtonStates[i] || false;
      if (pressed && !wasPressed) {
        const latency = Number.isFinite(pad.timestamp) && pad.timestamp > 0 ? now - pad.timestamp : null;
        const label = currentLabels[i] || `Bouton ${i}`;
        const sinceRelease = lastReleaseTimes[i];
        if (sinceRelease != null && now - sinceRelease < CHATTER_THRESHOLD_MS) {
          chatterTotal++;
          chatterByButton.set(label, (chatterByButton.get(label) || 0) + 1);
          chatterCountEl.textContent = chatterTotal;
          logPress(`⚠ Chatter — ${label} re-déclenché ${(now - sinceRelease).toFixed(1)} ms après relâche`, null);
          if (cell) {
            cell.classList.add("chatter");
            setTimeout(() => cell.classList.remove("chatter"), 400);
          }
        } else {
          logPress(label, latency);
        }
      }
      if (!pressed && wasPressed) {
        lastReleaseTimes[i] = now;
      }
      prevButtonStates[i] = pressed;
    });
  } else {
    setConnectedUI(false);
  }

  requestAnimationFrame(loop);
}

window.addEventListener("gamepadconnected", () => {
  refreshPadList();
});
window.addEventListener("gamepaddisconnected", () => {
  refreshPadList();
  if (getConnectedGamepads().length === 0) {
    setConnectedUI(false);
  }
});

requestAnimationFrame(loop);
