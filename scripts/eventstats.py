# ADD THIS TO TOP IMPORTS
from collections import defaultdict

# =========================
# LOAD ROSTERS
# =========================
def load_rosters(path="data/rosters.json"):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        roster_map = {}
        for team in data.get("teams", []):
            team_name = team.get("name")
            for p in team.get("players", []):
                pdga = str(p.get("pdga"))
                if pdga:
                    roster_map[pdga] = team_name
        return roster_map
    except:
        return {}

# =========================
# BUILD RECAP
# =========================
def generate_recap(
    event_cfg,
    event_name,
    rows,
    round_details,
    roster_map,
    counted_map
):
    site_id = event_cfg["id"]
    recap_path = event_cfg.get("recap_txt") or f"data/recaps/{site_id}_recap.txt"

    lines = []

    # HEADER
    lines.append(f"{event_name} — Event Recap\n")

    # SORT FINAL RESULTS
    rows_sorted = sorted(
        rows,
        key=lambda r: place_to_int(r["Place"]) or 9999
    )

    top5 = rows_sorted[:5]

    # WINNER
    winner = top5[0]
    lines.append(f"Winner")
    lines.append(f"{winner['Player']} wins at {winner['Total']}.\n")

    # =========================
    # ROUND BY ROUND
    # =========================
    for rnd, players in round_details.items():
        lines.append(f"Round {rnd}")

        players_sorted = sorted(
            players,
            key=lambda p: place_to_int(p.get("place")) or 9999
        )[:5]

        for p in players_sorted:
            name = p["name"]
            place = p["place"]
            score = p["to_par"]

            lines.append(f"- {name} ({place}) at {score}")

        lines.append("")

    # =========================
    # FINAL ROUND STORY
    # =========================
    lines.append("Final Standings")

    for p in top5:
        name = p["Player"]
        place = p["Place"]
        total = p["Total"]

        lines.append(f"{place} — {name} ({total})")

    lines.append("")

    # =========================
    # FANTASY IMPACT
    # =========================
    lines.append("Fantasy Impact")

    for p in top5:
        pdga = p["PDGA"]
        name = p["Player"]

        if pdga in roster_map:
            team = roster_map[pdga]
            counted = counted_map.get(pdga, False)

            if counted:
                lines.append(f"{name} delivered scoring points for {team}.")
            else:
                lines.append(f"{name} was rostered by {team} but did not count.")

    lines.append("")

    # =========================
    # HIGHLIGHT PLAYS
    # =========================
    lines.append("Highlight Plays")

    for p in rows:
        pdga = p["PDGA"]

        if pdga not in roster_map:
            continue

        name = p["Player"]

        if p["Aces"] > 0:
            lines.append(f"{name} hit an ace.")

        if p["Albatrosses"] > 0:
            lines.append(f"{name} recorded an albatross.")

        if p["Eagles"] > 2:
            lines.append(f"{name} had multiple eagles.")

    # =========================
    # WRITE FILE
    # =========================
    Path(recap_path).parent.mkdir(parents=True, exist_ok=True)
    Path(recap_path).write_text("\n".join(lines), encoding="utf-8")

    print(f"Saved recap: {recap_path}")


# =========================
# MODIFY process_event()
# =========================

# ADD near top of function
round_details = defaultdict(list)
roster_map = load_rosters()

# INSIDE ROUND LOOP (add this)
round_details[round_num].append({
    "name": name,
    "pdga": pdga_num,
    "place": p.get("RunningPlace"),
    "to_par": p.get("ToPar"),
})

# AFTER building out_rows
# BUILD COUNTED MAP (top 5 logic per team simplified)
counted_map = {}

# mark all as False initially
for row in out_rows:
    counted_map[row["PDGA"]] = False

# (basic version — improve later with team logic)
for row in out_rows[:5]:
    counted_map[row["PDGA"]] = True

# =========================
# CALL RECAP GENERATOR
# =========================
generate_recap(
    event_cfg,
    event_name,
    out_rows,
    round_details,
    roster_map,
    counted_map
)
