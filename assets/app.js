const EVENTS_URL = "data/events.json";

let currentCsvUrl = null;
let currentRows = null;

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map(h => h.trim().replace(/^"|"$/g,""));
  const data = lines.map(line => line.split(",").map(c => c.trim().replace(/^"|"$/g,"")));
  return { headers, data };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getIdx(headers, name) {
  const i = headers.indexOf(name);
  return i >= 0 ? i : null;
}

function renderTable(headers, data) {
  const thead = document.getElementById("thead");
  const tbody = document.getElementById("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  const playerIdx = getIdx(headers, "Player");

  // Identify columns we care about (if present)
  const totalIdx = getIdx(headers, "Total");
  const pointsIdx = getIdx(headers, "Total Points");
  const placeIdx = getIdx(headers, "Place");
  const avgFinishIdx = getIdx(headers, "Avg Finish");     // totals view suggested
  const eventsPlayedIdx = getIdx(headers, "Events Played"); // totals view suggested

  // Sort by Total Points desc (fallback 0)
  const sorted = [...data].sort((a,b) => (num(b[pointsIdx] ?? 0) ?? 0) - (num(a[pointsIdx] ?? 0) ?? 0));

  // Filter by search
  const filtered = sorted.filter(r => {
    const player = (playerIdx != null ? (r[playerIdx] ?? "") : "").toLowerCase();
    return !q || player.includes(q);
  });

  // Build DISPLAY columns in the exact order you asked for
  // MDGFL Ranking (derived) replaces Place
  // Finish (derived): Avg Finish if exists, else Place
  const display = [
  "MDGFL Ranking",
  "Player",
  "Total",
  "Finish",
  "Aces",
  "Albatrosses",
  "Eagles",
  "Birdies",
  "Pars",
  "Bogeys+",
  "Total Points",
  "Events Played",
  "Top 20s",
  "Top 10s",
  "Top 3s",
  "Wins",
  "Rounds"
  ];

  // Only show columns that exist in this CSV, except derived ones which always show
  const exists = new Set(headers);
  const showCols = display.filter(c => c === "MDGFL Ranking" || c === "Finish" || c === "Events Played" || exists.has(c));

  // Header row
  const trh = document.createElement("tr");
  for (const col of showCols) {
    const th = document.createElement("th");
    th.textContent = col;
    if (/Points$|Aces|Albatrosses|Eagles|Birdies|Pars|Bogeys\+|Total|Finish|Rounds|Events Played/.test(col)) {
      th.classList.add("num");
    }
    trh.appendChild(th);
  }
  thead.appendChild(trh);

  // Body rows
  filtered.forEach((r, i) => {
    const tr = document.createElement("tr");

    // derived fields
    const mdgflRank = i + 1;

    // Finish: totals uses Avg Finish if present, otherwise Place
    let finishVal = "";
    if (avgFinishIdx != null) finishVal = r[avgFinishIdx] ?? "";
    else if (placeIdx != null) finishVal = r[placeIdx] ?? "";

    // Events Played: show if present, else blank
    let eventsPlayedVal = "";
    if (eventsPlayedIdx != null) eventsPlayedVal = r[eventsPlayedIdx] ?? "";

    for (const col of showCols) {
      const td = document.createElement("td");

      let val = "";
      if (col === "MDGFL Ranking") val = String(mdgflRank);
      else if (col === "Finish") val = finishVal;
      else if (col === "Events Played") val = eventsPlayedVal;
      else {
        const idx = getIdx(headers, col);
        val = idx != null ? (r[idx] ?? "") : "";
      }

      td.textContent = val;

      if (col === "MDGFL Ranking") td.classList.add("place"); // gold styling
      if (/Points$|Aces|Albatrosses|Eagles|Birdies|Pars|Bogeys\+|Total|Finish|Rounds|Events Played/.test(col)) {
        td.classList.add("num");
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  });

  document.getElementById("footer").textContent =
    `Rows: ${filtered.length} • Sorted by Total Points • Updated: ${new Date().toLocaleString()}`;

  currentRows = { headers, data: filtered };
}

async function loadCsv(url) {
  currentCsvUrl = url;
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = `<tr><td class="muted">Loading…</td></tr>`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  const text = await res.text();

  const { headers, data } = parseCSV(text);
  renderTable(headers, data);

  document.getElementById("downloadBtn").onclick = () => {
    if (currentCsvUrl) window.location.href = currentCsvUrl;
  };
}

async function loadEvents() {
  const res = await fetch(EVENTS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`events.json fetch failed: ${res.status}`);
  const events = await res.json();

  const sel = document.getElementById("eventSelect");
  sel.innerHTML = "";
  events.forEach(e => {
    const opt = document.createElement("option");
    opt.value = e.csv;
    opt.textContent = e.name;
    sel.appendChild(opt);
  });

  sel.addEventListener("change", () => loadCsv(sel.value));
  document.getElementById("refreshBtn").addEventListener("click", () => loadCsv(sel.value));
  document.getElementById("searchInput").addEventListener("input", () => {
    // re-render from latest loaded CSV by reloading (simple + safe)
    if (currentCsvUrl) loadCsv(currentCsvUrl);
  });

  await loadCsv(sel.value);
}

loadEvents().catch(err => {
  console.error(err);
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = `<tr><td class="muted">Error: ${String(err)}</td></tr>`;
});
