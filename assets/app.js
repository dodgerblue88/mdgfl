// assets/app.js (drop-in replacement)
// Auto-totals by PDGA, sums Total and Rounds, renders using requested columns order.

const EVENTS_URL = "data/events.json";

// Optional PDGA->canonical name overrides
const NAME_BY_PDGA = {
  // "12345": "Paul McBeth",
  // "xxxxx": "Eagle McMahon",
  // "yyyyy": "Bo McLaughlin",
};

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
  const data = lines.map(line => {
    // naive split - assumes no embedded commas in fields
    return line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
  });
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
  const cleaned = s.replace(/^T/i, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function rowToObj(headers, row) {
  const get = (c) => {
    const i = idx(headers, c);
    return i >= 0 ? row[i] : "";
  };

  const pdga = String(get("PDGA") ?? "").trim();
  const rawPlayer = get("Player") ?? "";
  const player = (pdga && NAME_BY_PDGA[pdga]) ? NAME_BY_PDGA[pdga] : normalizeNameFallback(rawPlayer);

  return {
    PDGA: pdga,
    Player: player,
    Place: get("Place"),
    Total: get("Total"),
    Aces: toNum(get("Aces")) ?? 0,
    Albatrosses: toNum(get("Albatrosses")) ?? 0,
    Eagles: toNum(get("Eagles")) ?? 0,
    Birdies: toNum(get("Birdies")) ?? 0,
    Pars: toNum(get("Pars")) ?? 0,
    "Bogeys+": toNum(get("Bogeys+")) ?? 0,
    Rounds: toNum(get("Rounds")) ?? null,
    "Total Points": toNum(get("Total Points")) ?? 0,
    _placeNum: parsePlace(get("Place")),
  };
}

function computeEventDerived(o) {
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

function buildTotals(allEvents) {
  const map = new Map(); // PDGA -> accumulator

  for (const ev of allEvents) {
    for (const p of ev.players) {
      // require PDGA for stable merging:
      if (!p.PDGA) continue;

      const acc = map.get(p.PDGA) ?? {
        PDGA: p.PDGA,
        Player: p.Player,

        // Summed season fields
        Total: 0,
        Rounds: 0,
        _hasTotal: false,
        _hasRounds: false,

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

        _finishSum: 0,
        _finishCount: 0,
      };

      // Keep canonical name if provided
      acc.Player = NAME_BY_PDGA[p.PDGA] ?? p.Player ?? acc.Player;

      // Sum points and simple stats
      acc["Total Points"] += p["Total Points"] ?? 0;
      acc.Aces += p.Aces ?? 0;
      acc.Albatrosses += p.Albatrosses ?? 0;
      acc.Eagles += p.Eagles ?? 0;
      acc.Birdies += p.Birdies ?? 0;
      acc.Pars += p.Pars ?? 0;
      acc["Bogeys+"] += p["Bogeys+"] ?? 0;

      // Sum "Total" strokes if numeric
      const t = toNum(p.Total);
      if (t != null) {
        acc.Total += t;
        acc._hasTotal = true;
      }
      // Sum rounds if numeric
      const rd = toNum(p.Rounds);
      if (rd != null) {
        acc.Rounds += rd;
        acc._hasRounds = true;
      }

      // Derived counts
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

  // Finalize totals rows
  const totals = [];
  for (const acc of map.values()) {
    const avg = acc._finishCount > 0 ? (acc._finishSum / acc._finishCount) : null;
    totals.push({
      PDGA: acc.PDGA,
      Player: acc.Player,
      Total: acc._hasTotal ? acc.Total : "",
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
      Rounds: acc._hasRounds ? acc.Rounds : "",
    });
  }

  return totals;
}

function formatFinish(val) {
  if (val == null || val === "") return "";
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  return String(Math.round(n));
}

// Your requested columns order
const COLUMNS = [
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
  "Wins",
  "Top 3s",
  "Top 10s",
  "Top 20s",
  "Total Points",
];

function render(viewName, rows, isTotalsView) {
  // sort by Total Points desc
  rows.sort((a, b) => (b["Total Points"] ?? 0) - (a["Total Points"] ?? 0));

  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  const filtered = rows.filter(r => !q || String(r.Player ?? "").toLowerCase().includes(q));

  const thead = document.getElementById("thead");
  const tbody = document.getElementById("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  // header
  const trh = document.createElement("tr");
  for (const c of COLUMNS) {
    const th = document.createElement("th");
    th.textContent = c;
    if (/Total Points|Aces|Albatrosses|Eagles|Birdies|Pars|Bogeys\+|Finish|Top|Wins|Total|Rounds/.test(c)) {
      th.classList.add("num");
    }
    trh.appendChild(th);
  }
  thead.appendChild(trh);

  // body
  filtered.forEach((r, i) => {
    const tr = document.createElement("tr");
    const finish = isTotalsView ? formatFinish(r["Avg Finish"]) : (r.Place ?? "");

    const rowOut = {
      "MDGFL Ranking": i + 1,
      "Player": r.Player ?? "",
      "Total": isTotalsView ? (r.Total ?? "") : (r.Total ?? ""),
      "Finish": finish,
      "Aces": r.Aces ?? 0,
      "Albatrosses": r.Albatrosses ?? 0,
      "Eagles": r.Eagles ?? 0,
      "Birdies": r.Birdies ?? 0,
      "Pars": r.Pars ?? 0,
      "Bogeys+": r["Bogeys+"] ?? 0,
      "Wins": r["Wins"] ?? 0,
      "Top 3s": r["Top 3s"] ?? 0,
      "Top 10s": r["Top 10s"] ?? 0,
      "Top 20s": r["Top 20s"] ?? 0,
      "Total Points": r["Total Points"] ?? 0,
    };

    for (const c of COLUMNS) {
      const td = document.createElement("td");
      td.textContent = rowOut[c] ?? "";
      if (c === "MDGFL Ranking") td.classList.add("place");
      if (/Total Points|Aces|Albatrosses|Eagles|Birdies|Pars|Bogeys\+|Finish|Top|Wins|Total/.test(c)) {
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

    const players = data.map(r => rowToObj(headers, r)).map(o => computeEventDerived(o));
    loadedEvents.push({ ...ev, players });
  }

  // build totals from all loaded events
  const totalsRows = buildTotals(loadedEvents);

  // populate dropdown: totals first, then events in order
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
      downloadBtn.onclick = null;
      downloadBtn.title = "Totals computed on the fly";
      return;
    }

    const ev = loadedEvents.find(e => e.id === val);
    render(ev.name, ev.players, false);
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
