const EVENTS_URL = "data/events.json";

// === Name normalization (PDGA is the key) ===
// Add to this over time as needed. These override whatever the CSV says.
const NAME_BY_PDGA = {
  // "12345": "Correct Name"
};

// Fallback cleanup if PDGA missing or unknown (kept mild on purpose)
function normalizeNameFallback(name) {
  return String(name ?? "")
    .trim()
    .replace(/\bMc\s*Beth\b/i, "McBeth")
    .replace(/\bMc\s*Mahon\b/i, "McMahon")
    .replace(/\bMc\s*Laughlin\b/i, "McLaughlin");
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const data = lines.map(line => line.split(",").map(c => c.trim().replace(/^"|"$/g, "")));
  return { headers, data };
}

function idx(headers, col) {
  const i = headers.indexOf(col);
  return i >= 0 ? i : -1;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parsePlace(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.toUpperCase() === "DNF") return null;
  // Accept "T3" -> 3
  const cleaned = s.replace(/^T/i, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Build a normalized row object from a CSV row
function rowToObj(headers, row) {
  const get = (c) => {
    const i = idx(headers, c);
    return i >= 0 ? row[i] : "";
  };

  const pdga = String(get("PDGA")).trim();
  const rawPlayer = get("Player");
  const player = pdga && NAME_BY_PDGA[pdga]
    ? NAME_BY_PDGA[pdga]
    : normalizeNameFallback(rawPlayer);

  return {
    PDGA: pdga,
    Player: player,
    Place: get("Place"),
    Total: get("Total"),
    // stats (default 0 if missing)
    Aces: toNum(get("Aces")) ?? 0,
    Albatrosses: toNum(get("Albatrosses")) ?? 0,
    Eagles: toNum(get("Eagles")) ?? 0,
    Birdies: toNum(get("Birdies")) ?? 0,
    Pars: toNum(get("Pars")) ?? 0,
    "Bogeys+": toNum(get("Bogeys+")) ?? 0,
    Rounds: toNum(get("Rounds")) ?? null,

    "Total Points": toNum(get("Total Points")) ?? 0,

    // Derived for an event:
    _placeNum: parsePlace(get("Place")),
  };
}

function computeEventDerived(o) {
  // For an event CSV, Events Played is always 1 for non-DNF; 0 for DNF
  const played = o._placeNum != null ? 1 : 0;

  return {
    ...o,
    "Events Played": played,
    "Top 20s": o._placeNum != null && o._placeNum <= 20 ? 1 : 0,
    "Top 10s": o._placeNum != null && o._placeNum <= 10 ? 1 : 0,
    "Top 3s":  o._placeNum != null && o._placeNum <= 3  ? 1 : 0,
    "Wins":    o._placeNum != null && o._placeNum === 1 ? 1 : 0,
  };
}

// Merge all events into totals by PDGA
function buildTotals(allEvents) {
  // allEvents: [{ eventId, eventName, players: [eventRowObj...] }]
  const map = new Map(); // PDGA -> accumulator

  for (const ev of allEvents) {
    for (const p of ev.players) {
      if (!p.PDGA) continue; // hard requirement for stability

      const acc = map.get(p.PDGA) ?? {
        PDGA: p.PDGA,
        Player: p.Player,

        Total: 0,
        Rounds: 0,
        _hasTotal: false,
        _hasRounds: false,

        // totals
        "Total Points": 0,
        Aces: 0,
        Albatrosses: 0,
        Eagles: 0,
        Birdies: 0,
        Pars: 0,
        "Bogeys+": 0,

        "Events Played": 0,
        "Top 20s": 0,
        "Top 10s": 0,
        "Top 3s": 0,
        "Wins": 0,

        // finish aggregation
        _finishSum: 0,
        _finishCount: 0,
      };

      // Keep most current normalized name (PDGA wins over string)
      acc.Player = (NAME_BY_PDGA[p.PDGA] ?? p.Player) || acc.Player;

      acc["Total Points"] += p["Total Points"] ?? 0;
      acc.Aces += p.Aces ?? 0;
      acc.Albatrosses += p.Albatrosses ?? 0;
      acc.Eagles += p.Eagles ?? 0;
      acc.Birdies += p.Birdies ?? 0;
      acc.Pars += p.Pars ?? 0;
      acc["Bogeys+"] += p["Bogeys+"] ?? 0;

      // derived from event result
      const played = p["Events Played"] ?? 0;
      acc["Events Played"] += played;
      acc["Top 20s"] += p["Top 20s"] ?? 0;
      acc["Top 10s"] += p["Top 10s"] ?? 0;
      acc["Top 3s"]  += p["Top 3s"] ?? 0;
      acc["Wins"]    += p["Wins"] ?? 0;

      if (p._placeNum != null) {
        acc._finishSum += p._placeNum;
        acc._finishCount += 1;
      }

      map.set(p.PDGA, acc);
    }
  }

  // Finalize Avg Finish (no decimals on display; keep numeric internally)
  const totals = [];
  for (const acc of map.values()) {
    const avg = acc._finishCount > 0 ? (acc._finishSum / acc._finishCount) : null;
    totals.push({
      PDGA: acc.PDGA,
      Player: acc.Player,
      Total: "", // optional; you can compute total strokes later if you want
      "Avg Finish": avg,
      Aces: acc.Aces,
      Albatrosses: acc.Albatrosses,
      Eagles: acc.Eagles,
      Birdies: acc.Birdies,
      Pars: acc.Pars,
      "Bogeys+": acc["Bogeys+"],
      "Total Points": acc["Total Points"],
      "Events Played": acc["Events Played"],
      "Top 20s": acc["Top 20s"],
      "Top 10s": acc["Top 10s"],
      "Top 3s": acc["Top 3s"],
      "Wins": acc["Wins"],
    });
  }

  return totals;
}

function formatFinish(val) {
  if (val == null || val === "") return "";
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  // remove decimals (show integer)
  return String(Math.round(n));
}

function render(viewName, rows, isTotalsView) {
  // Sort by Total Points desc; MDGFL Ranking is derived per selected view
  rows.sort((a, b) => (b["Total Points"] ?? 0) - (a["Total Points"] ?? 0));

  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  const filtered = rows.filter(r => !q || String(r.Player ?? "").toLowerCase().includes(q));

  const columns = [
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

  const thead = document.getElementById("thead");
  const tbody = document.getElementById("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  // Header
  const trh = document.createElement("tr");
  for (const c of columns) {
    const th = document.createElement("th");
    th.textContent = c;
    if (/Total Points|Aces|Albatrosses|Eagles|Birdies|Pars|Bogeys\+|Finish|Events Played|Top|Wins|Rounds/.test(c)) {
      th.classList.add("num");
    }
    trh.appendChild(th);
  }
  thead.appendChild(trh);

  // Body
  filtered.forEach((r, i) => {
    const tr = document.createElement("tr");
    const finish = isTotalsView ? formatFinish(r["Avg Finish"]) : (r.Place ?? "");

    const rowOut = {
      "MDGFL Ranking": i + 1,
      "Player": r.Player ?? "",
      "Total": r.Total ?? "",
      "Finish": finish,
      "Aces": r.Aces ?? 0,
      "Albatrosses": r.Albatrosses ?? 0,
      "Eagles": r.Eagles ?? 0,
      "Birdies": r.Birdies ?? 0,
      "Pars": r.Pars ?? 0,
      "Bogeys+": r["Bogeys+"] ?? 0,
      "Total Points": r["Total Points"] ?? 0,
      "Events Played": r["Events Played"] ?? 0,
      "Top 20s": r["Top 20s"] ?? 0,
      "Top 10s": r["Top 10s"] ?? 0,
      "Top 3s": r["Top 3s"] ?? 0,
      "Wins": r["Wins"] ?? 0,
      "Rounds": r.Rounds ?? "",
    };

    for (const c of columns) {
      const td = document.createElement("td");
      td.textContent = rowOut[c] ?? "";
      if (c === "MDGFL Ranking") td.classList.add("place");
      if (/Total Points|Aces|Albatrosses|Eagles|Birdies|Pars|Bogeys\+|Finish|Events Played|Top|Wins|Rounds/.test(c)) {
        td.classList.add("num");
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  document.getElementById("footer").textContent =
    `${viewName} • Rows: ${filtered.length} • Sorted by Total Points • Updated: ${new Date().toLocaleString()}`;
}

async function loadAll() {
  const sel = document.getElementById("eventSelect");
  const refreshBtn = document.getElementById("refreshBtn");
  const downloadBtn = document.getElementById("downloadBtn");

  const res = await fetch(EVENTS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`events.json fetch failed: ${res.status}`);
  const events = await res.json();

  // Load every event CSV up front (season totals depend on all of them)
  const loadedEvents = [];

  for (const ev of events) {
    const csvRes = await fetch(ev.csv, { cache: "no-store" });
    if (!csvRes.ok) throw new Error(`CSV fetch failed (${ev.csv}): ${csvRes.status}`);
    const text = await csvRes.text();
    const { headers, data } = parseCSV(text);

    const pdgaIndex = idx(headers, "PDGA");
    if (pdgaIndex < 0) {
      throw new Error(`Missing required column "PDGA" in ${ev.csv}`);
    }

    const players = data
      .map(r => rowToObj(headers, r))
      .map(o => computeEventDerived(o));

    loadedEvents.push({ ...ev, players });
  }

  // Build totals view
  const totalsRows = buildTotals(loadedEvents);

  // Populate dropdown: Totals first, then events
  sel.innerHTML = "";
  const optTotals = document.createElement("option");
  optTotals.value = "__TOTALS__";
  optTotals.textContent = "Total Stats (Auto)";
  sel.appendChild(optTotals);

  for (const ev of loadedEvents) {
    const opt = document.createElement("option");
    opt.value = ev.id;
    opt.textContent = ev.name;
    sel.appendChild(opt);
  }

  function renderSelected() {
    const val = sel.value;
    if (val === "__TOTALS__") {
      render("Total Stats (Auto)", totalsRows, true);
      downloadBtn.onclick = null; // no single CSV to download
      downloadBtn.title = "Totals are computed on the fly";
      return;
    }

    const ev = loadedEvents.find(e => e.id === val);
    render(ev.name, ev.players, false);

    // Download current event CSV
    downloadBtn.onclick = () => window.location.href = ev.csv;
    downloadBtn.title = "Download this event CSV";
  }

  sel.addEventListener("change", renderSelected);
  refreshBtn.addEventListener("click", () => location.reload());
  document.getElementById("searchInput").addEventListener("input", renderSelected);

  renderSelected();
}

loadAll().catch(err => {
  console.error(err);
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = `<tr><td class="muted">Error: ${String(err)}</td></tr>`;
});
