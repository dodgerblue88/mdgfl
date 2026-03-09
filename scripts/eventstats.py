import csv
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests


BASE = "https://www.pdga.com"
DEFAULT_DIVISION = "MPO"
DEFAULT_EVENTS_JSON = "data/events.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
}


def get_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split()).strip()


def fetch_event_metadata(session: requests.Session, event_id: int) -> Dict[str, Any]:
    url = f"{BASE}/apps/tournament/live-api/live_results_fetch_event?TournID={event_id}"
    r = session.get(url, timeout=30)
    r.raise_for_status()
    return r.json()


def fetch_round_scores(session: requests.Session, event_id: int, division: str, round_num: int) -> Dict[str, Any]:
    url = (
        f"{BASE}/apps/tournament/live-api/live_results_fetch_round"
        f"?TournID={event_id}&Division={division}&Round={round_num}"
    )
    r = session.get(url, timeout=30)
    r.raise_for_status()
    return r.json()


def try_fetch_round_scores(
    session: requests.Session, event_id: int, division: str, round_num: int
) -> Optional[Dict[str, Any]]:
    url = (
        f"{BASE}/apps/tournament/live-api/live_results_fetch_round"
        f"?TournID={event_id}&Division={division}&Round={round_num}"
    )
    r = session.get(url, timeout=30)

    if r.status_code == 404:
        return None

    r.raise_for_status()
    return r.json()


def extract_round_sections(payload: Any) -> List[Dict[str, Any]]:
    sections: List[Dict[str, Any]] = []

    if not isinstance(payload, dict):
        return sections

    data = payload.get("data")

    if isinstance(data, dict):
        layouts = data.get("layouts", [])
        scores = data.get("scores", [])
        if isinstance(layouts, list) and isinstance(scores, list):
            sections.append({"layouts": layouts, "scores": scores})
        return sections

    if isinstance(data, list):
        for item in data:
            if not isinstance(item, dict):
                continue
            layouts = item.get("layouts", [])
            scores = item.get("scores", [])
            if isinstance(layouts, list) and isinstance(scores, list):
                sections.append({"layouts": layouts, "scores": scores})

    return sections


def discover_played_rounds(session: requests.Session, event_id: int, division: str) -> List[int]:
    found_rounds: List[int] = []

    for round_num in range(1, 13):
        payload = try_fetch_round_scores(session, event_id, division, round_num)
        if payload is None:
            continue

        sections = extract_round_sections(payload)
        found = False

        for section in sections:
            scores = section.get("scores", [])
            for player in scores:
                if not isinstance(player, dict):
                    continue

                hs = player.get("HoleScores")
                if isinstance(hs, list) and len(hs) > 0:
                    found = True
                    break
                if isinstance(hs, str) and clean_text(hs):
                    found = True
                    break

            if found:
                break

        if found:
            found_rounds.append(round_num)

    return sorted(found_rounds)


def build_layout_par_map(layouts: List[Dict[str, Any]], hole_count: int) -> Dict[int, Optional[int]]:
    par_map: Dict[int, Optional[int]] = {}
    if not layouts:
        return par_map

    layout = layouts[0]
    if not isinstance(layout, dict):
        return par_map

    for hole_num in range(1, hole_count + 1):
        raw = layout.get(f"H{hole_num}")
        try:
            par_map[hole_num] = int(raw) if raw is not None and str(raw).strip() != "" else None
        except (TypeError, ValueError):
            par_map[hole_num] = None

    return par_map


def parse_hole_scores(raw_scores: Any) -> List[Optional[int]]:
    vals: List[Optional[int]] = []

    if isinstance(raw_scores, list):
        items = raw_scores
    elif isinstance(raw_scores, str):
        items = raw_scores.split(",")
    else:
        items = []

    for item in items:
        s = clean_text(item)
        if s == "":
            vals.append(None)
            continue
        try:
            vals.append(int(s))
        except ValueError:
            vals.append(None)

    return vals


def player_key(player_name: str, pdga_num: Any) -> Tuple[str, str]:
    pdga = clean_text(pdga_num)
    name = clean_text(player_name)
    return (pdga if pdga else f"NAME:{name}".upper(), name)


def place_string(running_place: Any, tied: Any) -> str:
    p = clean_text(running_place)
    if not p:
        return ""

    t = clean_text(tied)
    is_tied = t in {"1", "true", "True", "YES", "Yes", "y", "Y"}

    return f"T{p}" if is_tied else p


def place_to_int(place: Any) -> Optional[int]:
    s = clean_text(place)
    if not s:
        return None
    digits = "".join(ch for ch in s if ch.isdigit())
    if not digits:
        return None
    try:
        return int(digits)
    except ValueError:
        return None


def flag_top_n(place_int: Optional[int], n: int) -> int:
    if place_int is None:
        return 0
    return 1 if place_int <= n else 0


def derive_year(data: Dict[str, Any]) -> Any:
    year = data.get("Year") or data.get("year")
    if year not in (None, ""):
        return year

    for key in ["StartDate", "start_date", "DateStart", "date_start", "EventDate", "event_date"]:
        value = clean_text(data.get(key))
        if len(value) >= 4 and value[:4].isdigit():
            return value[:4]

    return ""


def load_events_config(events_json_path: str = DEFAULT_EVENTS_JSON) -> List[Dict[str, Any]]:
    path = Path(events_json_path)
    if not path.exists():
        raise FileNotFoundError(f"events.json not found: {path}")

    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise RuntimeError("events.json must be a JSON array")

    events: List[Dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue

        site_event_id = clean_text(item.get("id")).lower()
        pdga_event_id = item.get("event_id")
        division = clean_text(item.get("division")) or DEFAULT_DIVISION
        stats_csv = clean_text(item.get("stats_csv"))

        if not site_event_id:
            continue
        if pdga_event_id in (None, ""):
            continue

        try:
            pdga_event_id = int(pdga_event_id)
        except (TypeError, ValueError):
            raise RuntimeError(f"Invalid event_id for site event '{site_event_id}': {pdga_event_id}")

        if not stats_csv:
            stats_csv = f"data/stats/{site_event_id}_stats.csv"

        event_cfg = dict(item)
        event_cfg["id"] = site_event_id
        event_cfg["event_id"] = pdga_event_id
        event_cfg["division"] = division
        event_cfg["stats_csv"] = stats_csv
        events.append(event_cfg)

    if not events:
        raise RuntimeError("No valid events found in events.json")

    return events


def init_player_row(
    pdga_event_id: int,
    site_event_id: str,
    year: Any,
    event_name: str,
    division: str,
    tier: str,
    player_name: str,
    pdga_num: Any,
    rating: Any,
) -> Dict[str, Any]:
    return {
        "site_event_id": site_event_id,
        "event_id": pdga_event_id,
        "Year": year,
        "event_name": event_name,
        "division": division,
        "Tier": tier,
        "Player": player_name,
        "PDGA": clean_text(pdga_num),
        "player_rating": rating,
        "tournament_total_strokes": "",
        "Total": "",
        "Place": "",
        "Wins": 0,
        "Top 3s": 0,
        "Top 10s": 0,
        "Top 20s": 0,
        "Aces": 0,
        "Albatrosses": 0,
        "Eagles": 0,
        "Birdies": 0,
        "Pars": 0,
        "Bogeys+": 0,
        "Rounds": 0,
        "HolesCounted": 0,
        "rounds_set": set(),
    }


def process_event(session: requests.Session, event_cfg: Dict[str, Any]) -> Dict[str, Any]:
    site_event_id = clean_text(event_cfg["id"]).lower()
    event_id = int(event_cfg["event_id"])
    division = clean_text(event_cfg.get("division")) or DEFAULT_DIVISION
    output_csv = clean_text(event_cfg.get("stats_csv")) or f"data/stats/{site_event_id}_stats.csv"

    print(f"\n=== {site_event_id.upper()} / PDGA {event_id} / {division} ===")
    print(f"Fetching event metadata for {event_id}...")

    meta = fetch_event_metadata(session, event_id)
    data = meta.get("data", {}) if isinstance(meta, dict) else {}

    event_name = clean_text(data.get("Name")) or clean_text(event_cfg.get("name")) or f"Event {event_id}"
    year = derive_year(data)
    tier = (
        clean_text(data.get("FormattedTier"))
        or clean_text(data.get("Tier"))
        or clean_text(data.get("RawTier"))
        or clean_text(data.get("FormattedLongTier"))
    )

    divisions = data.get("Divisions", []) if isinstance(data, dict) else []
    if not isinstance(divisions, list):
        divisions = []

    div_info = None
    for d in divisions:
        if isinstance(d, dict) and clean_text(d.get("Division")) == division:
            div_info = d
            break

    if not div_info:
        raise RuntimeError(f"No {division} division found for event {event_id}.")

    reported_latest_round = div_info.get("LatestRound") or data.get("HighestCompletedRound") or 0
    try:
        reported_latest_round = int(reported_latest_round)
    except (TypeError, ValueError):
        reported_latest_round = 0

    played_rounds = discover_played_rounds(session, event_id, division)
    if not played_rounds:
        raise RuntimeError(f"No playable round data found for {division} in event {event_id}.")

    final_results_round = max(played_rounds)

    print(f"Event: {event_name}")
    print(f"Year: {year}")
    print(f"Division: {division}")
    print(f"Tier: {tier}")
    print(f"Reported LatestRound: {reported_latest_round}")
    print(f"Actual played rounds found: {played_rounds}")
    print(f"Final results round used for Place/Totals: {final_results_round}")

    agg: Dict[Tuple[str, str], Dict[str, Any]] = {}

    for round_num in played_rounds:
        print(f"Fetching played round {round_num}...")
        round_payload = fetch_round_scores(session, event_id, division, round_num)
        sections = extract_round_sections(round_payload)
        total_players_this_round = 0

        for section in sections:
            layouts = section.get("layouts", [])
            scores = section.get("scores", [])
            total_players_this_round += len(scores)

            for p in scores:
                if not isinstance(p, dict):
                    continue

                name = clean_text(p.get("Name"))
                pdga_num = p.get("PDGANum")
                key = player_key(name, pdga_num)

                hole_scores = parse_hole_scores(p.get("HoleScores"))
                hole_count = len(hole_scores)
                if hole_count == 0:
                    continue

                par_map = build_layout_par_map(layouts, hole_count)

                if key not in agg:
                    agg[key] = init_player_row(
                        pdga_event_id=event_id,
                        site_event_id=site_event_id,
                        year=year,
                        event_name=event_name,
                        division=division,
                        tier=tier,
                        player_name=name,
                        pdga_num=pdga_num,
                        rating=p.get("Rating"),
                    )

                agg[key]["rounds_set"].add(round_num)

                if agg[key].get("player_rating") in (None, "", 0) and p.get("Rating") not in (None, "", 0):
                    agg[key]["player_rating"] = p.get("Rating")

                for hole_idx, score in enumerate(hole_scores, start=1):
                    if score is None:
                        continue

                    par = par_map.get(hole_idx)
                    agg[key]["HolesCounted"] += 1

                    if score == 1:
                        agg[key]["Aces"] += 1

                    if par is None:
                        continue

                    diff = score - par
                    if diff == -3:
                        agg[key]["Albatrosses"] += 1
                    elif diff == -2:
                        agg[key]["Eagles"] += 1
                    elif diff == -1:
                        agg[key]["Birdies"] += 1
                    elif diff == 0:
                        agg[key]["Pars"] += 1
                    elif diff > 0:
                        agg[key]["Bogeys+"] += 1

        print(f"Played round {round_num}: processed {total_players_this_round} player rows")

    print(f"Fetching final standings round {final_results_round}...")
    final_payload = fetch_round_scores(session, event_id, division, final_results_round)
    final_sections = extract_round_sections(final_payload)

    total_final_players = 0

    for section in final_sections:
        final_scores = section.get("scores", [])
        total_final_players += len(final_scores)

        for p in final_scores:
            if not isinstance(p, dict):
                continue

            name = clean_text(p.get("Name"))
            pdga_num = p.get("PDGANum")
            key = player_key(name, pdga_num)

            if key not in agg:
                agg[key] = init_player_row(
                    pdga_event_id=event_id,
                    site_event_id=site_event_id,
                    year=year,
                    event_name=event_name,
                    division=division,
                    tier=tier,
                    player_name=name,
                    pdga_num=pdga_num,
                    rating=p.get("Rating"),
                )

            agg[key]["Place"] = place_string(p.get("RunningPlace"), p.get("Tied"))
            agg[key]["tournament_total_strokes"] = p.get("GrandTotal")
            agg[key]["Total"] = p.get("ToPar")

            if agg[key].get("player_rating") in (None, "", 0) and p.get("Rating") not in (None, "", 0):
                agg[key]["player_rating"] = p.get("Rating")

    print(f"Final standings round {final_results_round}: processed {total_final_players} player rows")

    out_rows: List[Dict[str, Any]] = []
    for (_id_key, _name), v in agg.items():
        rounds_set = v.get("rounds_set", set())
        v["Rounds"] = len(rounds_set) if isinstance(rounds_set, set) else ""
        v.pop("rounds_set", None)

        p_int = place_to_int(v.get("Place"))
        v["Wins"] = 1 if p_int == 1 else 0
        v["Top 3s"] = flag_top_n(p_int, 3)
        v["Top 10s"] = flag_top_n(p_int, 10)
        v["Top 20s"] = flag_top_n(p_int, 20)
        out_rows.append(v)

    def place_sort_val(place: str) -> int:
        p = place_to_int(place)
        return p if p is not None else 10**9

    out_rows.sort(key=lambda r: (place_sort_val(clean_text(r.get("Place"))), clean_text(r.get("Player")).lower()))

    fieldnames = [
        "site_event_id",
        "event_id",
        "Year",
        "event_name",
        "division",
        "Tier",
        "Player",
        "PDGA",
        "player_rating",
        "tournament_total_strokes",
        "Total",
        "Place",
        "Wins",
        "Top 3s",
        "Top 10s",
        "Top 20s",
        "Aces",
        "Albatrosses",
        "Eagles",
        "Birdies",
        "Pars",
        "Bogeys+",
        "Rounds",
        "HolesCounted",
    ]

    output_path = Path(output_csv)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(out_rows)

    print(f"Saved CSV: {output_path}")
    print(f"Total players: {len(out_rows)}")

    return {
        "site_event_id": site_event_id,
        "event_id": event_id,
        "division": division,
        "event_name": event_name,
        "output_csv": str(output_path),
        "players": len(out_rows),
        "played_rounds": played_rounds,
    }


def main() -> None:
    events = load_events_config(DEFAULT_EVENTS_JSON)
    session = get_session()

    results: List[Dict[str, Any]] = []
    failures: List[Tuple[str, str]] = []

    for event_cfg in events:
        site_event_id = clean_text(event_cfg.get("id")).lower() or "unknown"
        try:
            result = process_event(session, event_cfg)
            results.append(result)
        except Exception as exc:
            failures.append((site_event_id, str(exc)))
            print(f"FAILED {site_event_id.upper()}: {exc}")

    print("\n=== Summary ===")
    for result in results:
        print(
            f"{result['site_event_id'].upper()}: "
            f"{result['players']} players -> {result['output_csv']}"
        )

    if failures:
        print("\n=== Failures ===")
        for site_event_id, message in failures:
            print(f"{site_event_id.upper()}: {message}")

        raise SystemExit(1)


if __name__ == "__main__":
    main()
