// ─── Positions ───────────────────────────────────────────────────────────────

const POSITIONS = [
  { id: "oh",  label: "Outside Hitter"  },
  { id: "mb",  label: "Middle Blocker"  },
  { id: "opp", label: "Opposite / RS"   },
  { id: "set", label: "Setter"          },
  { id: "lib", label: "Libero / DS"     },
];

// ─── Stat axes (order matches radar chart) ────────────────────────────────────

const STATS = ["Attacking", "Serving", "Passing", "Setting", "Blocking", "Defense"];
const STAT_COLORS = ["#D85A30", "#378ADD", "#1D9E75", "#7F77DD", "#BA7517", "#0F6E56"];

// ─── Position weights ─────────────────────────────────────────────────────────
// Each array maps to [Attacking, Serving, Passing, Setting, Blocking, Defense]
// Reduces stat contribution for roles where that skill isn't primary

const POSITION_WEIGHTS = {
  oh:  [1.0, 0.8, 0.9, 0.4, 0.7, 0.9],
  mb:  [0.9, 0.7, 0.5, 0.3, 1.0, 0.7],
  opp: [1.0, 0.9, 0.7, 0.3, 0.8, 0.8],
  set: [0.5, 0.7, 0.6, 1.0, 0.5, 0.7],
  lib: [0.0, 0.8, 1.0, 0.2, 0.0, 1.0],
};

// ─── Actions ─────────────────────────────────────────────────────────────────
// stats: which stat indices this action affects
// value: raw points added per tap (positive = good, negative = error)
// positions: which positions see this button

const ACTIONS = [
  // Attacking
  { id: "kill",        label: "Kill",          category: "attacking", stats: [0],    value:  10, positions: ["oh","mb","opp","set"] },
  { id: "tip",         label: "Tip / Dump",    category: "attacking", stats: [0],    value:   7, positions: ["oh","mb","opp","set"] },
  { id: "attack_err",  label: "Attack Error",  category: "attacking", stats: [0],    value:  -4, positions: ["oh","mb","opp","set"] },
  // Serving
  { id: "ace",         label: "Ace",           category: "serving",   stats: [1],    value:  10, positions: ["oh","mb","opp","set","lib"] },
  { id: "serve_in",    label: "Serve In",      category: "serving",   stats: [1],    value:   5, positions: ["oh","mb","opp","set","lib"] },
  { id: "serve_err",   label: "Serve Error",   category: "serving",   stats: [1],    value:  -3, positions: ["oh","mb","opp","set","lib"] },
  // Passing
  { id: "perfect_pass",label: "Perfect Pass",  category: "passing",   stats: [2],    value:  10, positions: ["oh","opp","lib"] },
  { id: "pass",        label: "Pass",          category: "passing",   stats: [2],    value:   5, positions: ["oh","opp","lib"] },
  { id: "pass_err",    label: "Pass Error",    category: "passing",   stats: [2],    value:  -3, positions: ["oh","opp","lib"] },
  // Setting
  { id: "assist",      label: "Assist",        category: "setting",   stats: [3],    value:  10, positions: ["set","oh","opp"] },
  { id: "set_good",    label: "Good Set",      category: "setting",   stats: [3],    value:   5, positions: ["set"] },
  { id: "set_err",     label: "Set Error",     category: "setting",   stats: [3],    value:  -3, positions: ["set"] },
  // Blocking
  { id: "kill_block",  label: "Kill Block",    category: "blocking",  stats: [4, 5], value:  10, positions: ["oh","mb","opp","set"] },
  { id: "block_touch", label: "Block Touch",   category: "blocking",  stats: [4],    value:   5, positions: ["oh","mb","opp","set"] },
  { id: "block_err",   label: "Block Error",   category: "blocking",  stats: [4],    value:  -2, positions: ["oh","mb","opp","set"] },
  // Defense
  { id: "dig",         label: "Dig",           category: "defense",   stats: [5],    value:  10, positions: ["oh","mb","opp","set","lib"] },
  { id: "dig_err",     label: "Dig Error",     category: "defense",   stats: [5],    value:  -3, positions: ["oh","mb","opp","set","lib"] },
];

// ─── State ────────────────────────────────────────────────────────────────────

let currentPosition = "oh";
let rawScores = [0, 0, 0, 0, 0, 0];   // accumulates raw points, clamped 0–10
let actionCounts = {};
ACTIONS.forEach(a => actionCounts[a.id] = 0);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function getWeightedScores() {
  const weights = POSITION_WEIGHTS[currentPosition];
  return rawScores.map((score, i) =>
    Math.round(clamp(score * weights[i], 0, 10))
  );
}

// ─── Position tabs ────────────────────────────────────────────────────────────

function buildPositionTabs() {
  const container = document.getElementById("position-tabs");
  container.innerHTML = "";
  POSITIONS.forEach(pos => {
    const btn = document.createElement("button");
    btn.textContent = pos.label;
    btn.className = "pos-tab" + (pos.id === currentPosition ? " active" : "");
    btn.addEventListener("click", () => {
      currentPosition = pos.id;
      buildPositionTabs();
      buildActionGrid();
      updateChart();
    });
    container.appendChild(btn);
  });
}

// ─── Action grid ─────────────────────────────────────────────────────────────

function buildActionGrid() {
  const grid = document.getElementById("action-grid");
  grid.innerHTML = "";

  const visible = ACTIONS.filter(a => a.positions.includes(currentPosition));
  visible.forEach(action => {
    const btn = document.createElement("button");
    btn.className = `action-btn cat-${action.category}`;
    btn.innerHTML = `
      <span class="action-label">${action.label}</span>
      <span class="action-pts">${action.value > 0 ? "+" + action.value : action.value} pts</span>
      <span class="action-count" id="cnt-${action.id}">×0</span>
    `;
    btn.addEventListener("click", () => logAction(action));
    grid.appendChild(btn);
  });
}

// ─── Log an action ────────────────────────────────────────────────────────────

function logAction(action) {
  actionCounts[action.id]++;

  // Update raw scores: each tap nudges the stat
  action.stats.forEach(statIdx => {
    const delta = action.value > 0 ? action.value * 0.12 : action.value * 0.08;
    rawScores[statIdx] = clamp(rawScores[statIdx] + delta, 0, 10);
  });

  // Update the count badge on the button
  const countEl = document.getElementById(`cnt-${action.id}`);
  if (countEl) countEl.textContent = `×${actionCounts[action.id]}`;

  addLogEntry(action);
  updateChart();
}

// ─── Action log list ─────────────────────────────────────────────────────────

function addLogEntry(action) {
  const list = document.getElementById("action-log");
  const empty = list.querySelector(".empty");
  if (empty) empty.remove();

  const li = document.createElement("li");
  const sign = action.value > 0 ? "+" : "";
  li.innerHTML = `
    <span class="log-dot" style="background: ${STAT_COLORS[action.stats[0]]}"></span>
    <span class="log-action">${action.label}</span>
    <span class="log-pts">${sign}${action.value} pts</span>
  `;
  list.insertBefore(li, list.firstChild);
}

// ─── Chart ────────────────────────────────────────────────────────────────────

let chart;

function initChart() {
  const ctx = document.getElementById("radarChart");
  chart = new Chart(ctx, {
    type: "radar",
    data: {
      labels: STATS,
      datasets: [{
        label: "Player Stats",
        data: [0, 0, 0, 0, 0, 0],
        backgroundColor: "rgba(55, 138, 221, 0.15)",
        borderColor: "#378ADD",
        borderWidth: 2,
        pointBackgroundColor: STAT_COLORS,
        pointBorderColor: "#fff",
        pointRadius: 5,
        pointHoverRadius: 7,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: 0,
          max: 10,
          ticks: {
            stepSize: 2,
            font: { size: 11 },
            backdropColor: "transparent",
          },
          grid: { color: "rgba(0,0,0,0.08)" },
          angleLines: { color: "rgba(0,0,0,0.08)" },
          pointLabels: { font: { size: 12 } },
        }
      }
    }
  });
}

function updateChart() {
  const scores = getWeightedScores();
  chart.data.datasets[0].data = scores;
  chart.update("active");
  renderStatBars(scores);
}

// ─── Stat bars ────────────────────────────────────────────────────────────────

function renderStatBars(scores) {
  const container = document.getElementById("stat-bars");
  container.innerHTML = "";
  scores.forEach((val, i) => {
    const row = document.createElement("div");
    row.className = "stat-row";
    row.innerHTML = `
      <span class="stat-name">${STATS[i]}</span>
      <div class="stat-bar-bg">
        <div class="stat-bar-fill" style="width: ${val * 10}%; background: ${STAT_COLORS[i]};"></div>
      </div>
      <span class="stat-val">${val}</span>
    `;
    container.appendChild(row);
  });
}

// ─── Reset ────────────────────────────────────────────────────────────────────

function resetStats() {
  rawScores = [0, 0, 0, 0, 0, 0];
  ACTIONS.forEach(a => actionCounts[a.id] = 0);
  document.getElementById("action-log").innerHTML = '<li class="empty">No actions logged yet.</li>';
  buildActionGrid();
  updateChart();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

buildPositionTabs();
buildActionGrid();
initChart();
renderStatBars([0, 0, 0, 0, 0, 0]);