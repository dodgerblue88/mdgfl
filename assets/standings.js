/* assets/standings.js */

const ROSTERS_KEY = "mdgfl_rosters_v1";
const EVENTS_JSON_PATH = "events.json";

// If your event objects use different fields, update here:
function eventLabel(e) {
  return e.name || e.id || "Event";
}
function eventCsvPath(e) {
  return e.csv; // e.g. "data/usdgc.csv"
}

// --- small helpers ---
function $(id) { return document.getElementById(id); }

function setActiveNav() {
  const links = document.querySelectorAll(".nav-link");
  links.forEach(link => {
    if (link.getAttribute("href") === location.pathname.split("/").pop()) {
      link.classList.add("active");
    }
  });
}

function parseCSV(text) {
  // Minimal CSV parser (handles quoted commas)
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!inQuotes && (c === "\n" || c === "\r")) {
      if (c === "\r" && next === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const header = rows.shift() || [];
  const idx = {};
  header.forEach((h, i) => idx[h.trim()] = i);

  return { header, idx, rows };
}

function num(x) {
  const n = Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

// --- data loading ---
async function loadEvents() {
  const res = await fetch(EVENTS_JSON_PATH, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${EVENTS_JSON_PATH}`);
  return await res.json();
}

function loadRosters() {
  const raw = localStorage.getItem(ROSTERS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function loadEventPointsIndex(csvPath) {
  const res = await fetch(csvPath, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load CSV: ${csvPath}`);
  const text = await res.text();

  const { idx, rows } = parseCSV(text);

  // Accept a couple possible column spellings
  const pdgaCol =
    idx["PDGA"] ?? idx["PDGA #"] ?? idx["PDGANumber"] ?? idx["PDGA Number"];
  const nameCol =
    idx["Player"] ?? idx["Name"] ?? idx["Player Name"] ?? idx["PLAYER"];
  const pointsCol =
    idx["Total Points"] ?? idx["TOTAL POINTS"] ?? idx["Points"] ?? idx["TOTAL"];

  const byPdga = new Map();
  const byName = new Map();

  for (const r of rows) {
    const pdga = pdgaCol != null ? String(r[pdgaCol] ?? "").trim() : "";
    const name = nameCol != null ? String(r[nameCol] ?? "").trim() : "";
    const pts = pointsCol != null ? num(r[pointsCol]) : 0;

    if (pdga) byPdga.set(pdga, pts);
    if (name) byName.set(name.toLowerCase(), pts);
  }

  return { byPdga, byName };
}

// --- standings computation ---
function getPlayerEventPoints(player, eventIndex) {
  // prefer PDGA match
  const pdga = String(player.PDGA ?? "").trim();
  if (pdga && eventIndex.byPdga.has(pdga)) return eventIndex.byPdga.get(pdga);

  // fallback to name match
  const name = String(player.name ?? "").trim().toLowerCase();
  if (name && eventIndex.byName.has(name)) return eventIndex.byName.get(name);

  return 0;
}

async function buildStandingsModel() {
  const rosters = loadRosters();
  if (!rosters || !Array.isArray(rosters.teams) || rosters.teams.length === 0) {
    return { error: "No rosters found. Go to Rosters and create/save teams first." };
  }

  const events = await loadEvents(); // ORDER matters (your requirement)
  const eventIndices = [];
  for (const ev of events) {
    eventIndices.push(await loadEventPointsIndex(eventCsvPath(ev)));
  }

  // compute
  const teams = rosters.teams.map(team => {
    const players = (team.players || []).map(p => ({
      name: p.name,
      PDGA: p.PDGA,
      eventPoints: [],   // per event
      total: 0
    }));

    // per event
    const teamEventTotals = events.map((ev, ei) => {
      let sum = 0;
      for (const pl of players) {
        const pts = getPlayerEventPoints(pl, eventIndices[ei]);
        pl.eventPoints[ei] = pts;
        pl.total += pts;
        sum += pts;
      }
      return sum;
    });

    // sort players by total desc (your requirement)
    players.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    const grandTotal = teamEventTotals.reduce((a, b) => a + b, 0);

    return {
      name: team.name || "Unnamed Team",
      players,
      teamEventTotals,
      grandTotal
    };
  });

  // sort teams by grand total desc (your requirement)
  teams.sort((a, b) => b.grandTotal - a.grandTotal || a.name.localeCompare(b.name));

  return { events, teams };
}

// --- rendering ---
function renderTable(model) {
  const thead = $("thead");
  const tbody = $("tbody");

  if (model.error) {
    thead.innerHTML = "";
    tbody.innerHTML = `
      <tr>
        <td class="muted">${model.error} <a href="rosters.html">Go to Rosters →</a></td>
      </tr>`;
    return;
  }

  const { events, teams } = model;

  // Header
  const cols = [
    "Team / Player",
    ...events.map(e => eventLabel(e)),
    "Total"
  ];

  thead.innerHTML = `
    <tr>
      ${cols.map(c => `<th>${c}</th>`).join("")}
    </tr>
  `;

  // Body: team row then player rows
  const rows = [];
  teams.forEach((t, rankIdx) => {
    // Team row
    rows.push(`
      <tr class="team-row">
        <td><strong>${rankIdx + 1}. ${t.name}</strong></td>
        ${t.teamEventTotals.map(v => `<td><strong>${v}</strong></td>`).join("")}
        <td><strong>${t.grandTotal}</strong></td>
      </tr>
    `);

    // Player rows
    t.players.forEach(p => {
      rows.push(`
        <tr class="player-row">
          <td class="muted">↳ ${p.name} <span class="muted">(${p.PDGA || "—"})</span></td>
          ${events.map((_, ei) => `<td>${p.eventPoints[ei] ?? 0}</td>`).join("")}
          <td>${p.total}</td>
        </tr>
      `);
    });
  });

  tbody.innerHTML = rows.join("");
}

function applySearchFilter(query) {
  query = (query || "").trim().toLowerCase();
  const tbody = $("tbody");
  if (!tbody) return;

  const trs = Array.from(tbody.querySelectorAll("tr"));
  if (!query) {
    trs.forEach(tr => tr.style.display = "");
    return;
  }

  // Show a team row if team name matches OR any of its players match.
  let currentTeamRow = null;
  let currentTeamMatch = false;
  let currentPlayerMatch = false;

  trs.forEach(tr => {
    const text = tr.textContent.toLowerCase();

    if (tr.classList.contains("team-row")) {
      // finalize previous team group visibility
      if (currentTeamRow) {
        currentTeamRow.style.display = (currentTeamMatch || currentPlayerMatch) ? "" : "none";
      }
      currentTeamRow = tr;
      currentTeamMatch = text.includes(query);
      currentPlayerMatch = false;
      tr.style.display = ""; // temporarily; finalize later
    } else {
      const match = text.includes(query);
      if (match) currentPlayerMatch = true;
      tr.style.display = match ? "" : "none";
    }
  });

  // finalize last team
  if (currentTeamRow) {
    currentTeamRow.style.display = (currentTeamMatch || currentPlayerMatch) ? "" : "none";
  }
}

async function refresh() {
  $("tbody").innerHTML = `<tr><td class="muted">Loading…</td></tr>`;
  try {
    const model = await buildStandingsModel();
    renderTable(model);

    const now = new Date();
    $("footer").textContent = `Last updated ${now.toLocaleString()}`;
    applySearchFilter($("teamSearch").value);
  } catch (err) {
    $("thead").innerHTML = "";
    $("tbody").innerHTML = `<tr><td class="muted">${err.message}</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setActiveNav();

  $("refreshBtn").addEventListener("click", refresh);
  $("teamSearch").addEventListener("input", (e) => applySearchFilter(e.target.value));

  refresh();
});
