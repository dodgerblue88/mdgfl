import csv
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from collections import defaultdict
import requests

BASE = "https://www.pdga.com"
DEFAULT_DIVISION = "MPO"
DEFAULT_EVENTS_JSON = "data/events.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
}

# =========================
# HELPERS
# =========================

def get_session():
    s = requests.Session()
    s.headers.update(HEADERS)
    return s

def clean_text(v):
    return "" if v is None else " ".join(str(v).split()).strip()

def place_to_int(p):
    s = clean_text(p)
    digits = "".join(c for c in s if c.isdigit())
    return int(digits) if digits else None

# =========================
# LOAD ROSTERS
# =========================

def load_rosters(path="data/rosters.json"):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        out = {}
        for t in data.get("teams", []):
            team_name = t.get("name")
            for p in t.get("players", []):
                pdga = str(p.get("pdga"))
                if pdga:
                    out[pdga] = team_name
        return out
    except:
        return {}

# =========================
# PDGA API
# =========================

def fetch_event_metadata(session, event_id):
    url = f"{BASE}/apps/tournament/live-api/live_results_fetch_event?TournID={event_id}"
    r = session.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

def fetch_round_scores(session, event_id, division, round_num):
    url = f"{BASE}/apps/tournament/live-api/live_results_fetch_round?TournID={event_id}&Division={division}&Round={round_num}"
    r = session.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

def try_fetch_round_scores(session, event_id, division, round_num):
    try:
        return fetch_round_scores(session, event_id, division, round_num)
    except:
        return None

def extract_sections(payload):
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]
    return []

def discover_rounds(session, event_id, division):
    rounds = []
    for r in range(1, 13):
        payload = try_fetch_round_scores(session, event_id, division, r)
        if not payload:
            continue
        sections = extract_sections(payload)
        if any(s.get("scores") for s in sections):
            rounds.append(r)
    return rounds

# =========================
# EVENTS CONFIG
# =========================

def load_events_config(path=DEFAULT_EVENTS_JSON):
    data = json.loads(Path(path).read_text())
    events = []
    for e in data:
        if not e.get("event_id"):
            continue
        e["stats_csv"] = e.get("stats_csv") or f"data/stats/{e['id']}_stats.csv"
        events.append(e)
    return events

# =========================
# RECAP GENERATOR
# =========================

def generate_recap(event_cfg, event_name, rows, round_details, roster_map):
    recap_path = f"data/recaps/{event_cfg['id']}_recap.txt"

    lines = []
    lines.append(f"{event_name} — Event Recap\n")

    rows_sorted = sorted(rows, key=lambda r: place_to_int(r["Place"]) or 999)
    top5 = rows_sorted[:5]

    # Winner
    winner = top5[0]
    lines.append("Winner")
    lines.append(f"{winner['Player']} wins at {winner['Total']}\n")

    # Round summaries
    for rnd, players in round_details.items():
        lines.append(f"Round {rnd}")
        top = sorted(players, key=lambda p: place_to_int(p["place"]) or 999)[:5]
        for p in top:
            lines.append(f"- {p['name']} ({p['place']}) at {p['to_par']}")
        lines.append("")

    # Final standings
    lines.append("Final Standings")
    for p in top5:
        lines.append(f"{p['Place']} — {p['Player']} ({p['Total']})")
    lines.append("")

    # Fantasy impact
    lines.append("Fantasy Impact")
    for p in top5:
        pdga = p["PDGA"]
        if pdga in roster_map:
            lines.append(f"{p['Player']} contributed for {roster_map[pdga]}")
    lines.append("")

    # Highlights
    lines.append("Highlight Plays")
    for p in rows:
        if p["PDGA"] not in roster_map:
            continue
        if p.get("Aces", 0) > 0:
            lines.append(f"{p['Player']} hit an ace")
        if p.get("Albatrosses", 0) > 0:
            lines.append(f"{p['Player']} had an albatross")
        if p.get("Eagles", 0) > 2:
            lines.append(f"{p['Player']} had multiple eagles")

    Path(recap_path).parent.mkdir(parents=True, exist_ok=True)
    Path(recap_path).write_text("\n".join(lines), encoding="utf-8")

    print(f"Saved recap: {recap_path}")

# =========================
# MAIN EVENT PROCESSOR
# =========================

def process_event(session, event_cfg):
    event_id = int(event_cfg["event_id"])
    division = event_cfg.get("division", DEFAULT_DIVISION)
    site_id = event_cfg["id"]

    print(f"\n=== {site_id.upper()} / {event_id} ===")

    meta = fetch_event_metadata(session, event_id)
    data = meta.get("data", {})

    event_name = clean_text(data.get("Name")) or event_cfg.get("name")

    rounds = discover_rounds(session, event_id, division)
    if not rounds:
        print("No rounds found, skipping")
        return

    final_round = max(rounds)

    agg = {}
    round_details = defaultdict(list)
    roster_map = load_rosters()

    # =========================
    # ROUND LOOP
    # =========================
    for round_num in rounds:
        payload = fetch_round_scores(session, event_id, division, round_num)
        sections = extract_sections(payload)

        for sec in sections:
            scores = sec.get("scores", [])

            for p in scores:
                name = clean_text(p.get("Name"))
                pdga = str(p.get("PDGANum"))
                key = (pdga, name)

                if key not in agg:
                    agg[key] = {
                        "Player": name,
                        "PDGA": pdga,
                        "Total": "",
                        "Place": "",
                        "Aces": 0,
                        "Albatrosses": 0,
                        "Eagles": 0,
                    }

                # ✅ THIS FIXES YOUR ERROR
                round_details[round_num].append({
                    "name": name,
                    "pdga": pdga,
                    "place": p.get("RunningPlace"),
                    "to_par": p.get("ToPar"),
                })

    # =========================
    # FINAL ROUND
    # =========================
    final_payload = fetch_round_scores(session, event_id, division, final_round)

    for sec in extract_sections(final_payload):
        for p in sec.get("scores", []):
            key = (str(p.get("PDGANum")), clean_text(p.get("Name")))
            if key not in agg:
                continue

            agg[key]["Place"] = p.get("RunningPlace")
            agg[key]["Total"] = p.get("ToPar")

    rows = list(agg.values())

    # =========================
    # WRITE CSV
    # =========================
    output = Path(event_cfg["stats_csv"])
    output.parent.mkdir(parents=True, exist_ok=True)

    with output.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(f"Saved CSV: {output}")

    # =========================
    # GENERATE RECAP
    # =========================
    generate_recap(event_cfg, event_name, rows, round_details, roster_map)

# =========================
# MAIN
# =========================

def main():
    session = get_session()
    events = load_events_config()

    for e in events:
        try:
            process_event(session, e)
        except Exception as ex:
            print(f"FAILED {e['id']}: {ex}")

if __name__ == "__main__":
    main()
