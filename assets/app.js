const EVENTS_URL = "data/events.json";

let currentCsvUrl = null;
let rows = [];

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map(h => h.trim().replace(/^"|"$/g,""));
  const data = lines.map(line => line.split(",").map(c => c.trim().replace(/^"|"$/g,"")));
  return { headers, data };
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function renderTable(headers, data) {
  const thead = document.getElementById("thead");
  const tbody = document.getElementById("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  // choose columns to display in a consistent order if present
  const preferred = [
    "Place","Player","Total",
    "Aces","Albatrosses","Eagles","Birdies","Pars","Bogeys+",
    "Ace Points","Albatross Points","Eagle Points","Birdie Points","Bogey+ Points","Place Points","Total Points"
  ];

  const headerIndex = new Map(headers.map((h,i)=>[h,i]));
  const displayCols = preferred.filter(h => headerIndex.has(h));
  // if file has other columns, append them
  headers.forEach(h => { if (!displayCols.includes(h)) displayCols.push(h); });

  // header
  const trh = document.createElement("tr");
  displayCols.forEach(h=>{
    const th = document.createElement("th");
    th.textContent = h;
    if (/(Points|Aces|Albatrosses|Eagles|Birdies|Pars|Bogeys\+|Total)$/i.test(h)) th.classList.add("num");
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  // body
  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  const filtered = data.filter(r => {
    const player = (r[headerIndex.get("Player")] ?? "").toLowerCase();
    return !q || player.includes(q);
  });

  for (const r of filtered) {
    const tr = document.createElement("tr");
    displayCols.forEach(h=>{
      const td = document.createElement("td");
      const v = r[headerIndex.get(h)] ?? "";
      td.textContent = v;
      if (h === "Place") td.classList.add("place");
      if (/(Points|Aces|Albatrosses|Eagles|Birdies|Pars|Bogeys\+|Total)$/i.test(h)) td.classList.add("num");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }

  document.getElementById("footer").textContent =
    `Rows: ${filtered.length} • Updated: ${new Date().toLocaleString()}`;
}

async function loadCsv(url) {
  currentCsvUrl = url;
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = `<tr><td class="muted">Loading…</td></tr>`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  const text = await res.text();

  const { headers, data } = parseCSV(text);
  rows = { headers, data };
  renderTable(headers, data);
}

async function loadEvents() {
  const res = await fetch(EVENTS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`events.json fetch failed: ${res.status}`);
  const events = await res.json();

  const sel = document.getElementById("eventSelect");
  sel.innerHTML = "";
  events.forEach((e, idx)=>{
    const opt = document.createElement("option");
    opt.value = e.csv;
    opt.textContent = e.name;
    sel.appendChild(opt);
  });

  sel.addEventListener("change", ()=> loadCsv(sel.value));
  document.getElementById("refreshBtn").addEventListener("click", ()=> loadCsv(sel.value));
  document.getElementById("searchInput").addEventListener("input", ()=>{
    if (rows.headers) renderTable(rows.headers, rows.data);
  });
  document.getElementById("downloadBtn").addEventListener("click", ()=>{
    if (currentCsvUrl) window.location.href = currentCsvUrl;
  });

  // load first option (Totals by default if you put it first in events.json)
  await loadCsv(sel.value);
}

loadEvents().catch(err=>{
  console.error(err);
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = `<tr><td class="muted">Error: ${String(err)}</td></tr>`;
});
