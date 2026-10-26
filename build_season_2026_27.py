"""Build data/season_2026-27.json: every team's 2026-27 roster with zero-filled stats.

No 2026-27 regular-season games have been played yet (exhibitions are not counted, same as
2025-26), so every stat is 0 until real games are loaded. Rosters come from
data/dashboard_data.json (the 18 existing teams, which already carry returning/new status
and last-season role) and data/rosters_2026-27.json (teams new to the dashboard).

Run after build_lineup_data.py and build_rosters.py:  python3 build_season_2026_27.py
"""
import json
import os
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, "data", "dashboard_data.json"), encoding="utf-8"))
R = json.load(open(os.path.join(HERE, "data", "rosters_2026-27.json"), encoding="utf-8"))

# teams that are new to the dashboard (UCSD 2026-27 non-conference opponents)
NEW_TEAMS = {
    "pacific":  {"name": "Pacific",           "mascot": "Tigers"},
    "lasalle":  {"name": "La Salle",          "mascot": "Explorers"},
    "whittier": {"name": "Whittier",          "mascot": "Poets"},
    "csusm":    {"name": "Cal State San Marcos", "mascot": "Cougars"},
}
PER40_KEYS = ["fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "ast", "tov", "stl", "blk",
              "opp_fgm", "opp_fga", "opp_tpm", "opp_tpa", "opp_ftm", "opp_fta", "opp_oreb", "opp_dreb",
              "opp_ast", "opp_tov"]


def roster_for_new_team(key):
    raw = R["teams"][key]
    players = [{
        "name": p["name"], "jersey": p["jersey"], "pos": p["pos"], "height": p["height"], "cls": p["cls"],
        "hometown": p["hometown"], "from": p["from"],
        "status": "unknown",        # no 2025-26 box scores loaded for this team, so returning/new is unknown
        "match": "none", "prev": None,
    } for p in raw["players"]]
    return {"source_url": raw["source_url"], "players": players, "departed": [], "match_notes": [],
            "summary": {"roster_size": len(players), "returning": 0, "new": 0, "unknown": True,
                        "returning_min_pct": 0, "returning_pts_pct": 0, "lineup_min_by_returning": {}}}


def zero_team(key, kind, name, mascot, roster):
    return {
        "key": key, "kind": kind, "name": name, "mascot": mascot, "no_games": True,
        "kpis": {"record": "0-0", "ppg": 0, "oppg": 0},
        "team_quarters": {"season": {"label": "Season Average (all games)", "us": [0, 0, 0, 0], "opp": [0, 0, 0, 0], "games": 0}},
        "roster_players": [{
            "name": p["name"], "jersey": p["jersey"], "ppg": 0, "gp": 0, "q": [0, 0, 0, 0],
            "adv": {"cls": p["cls"], "pos": p["pos"], "bpm": 0, "adjoe": 0, "drtg": 0, "usg": 0, "ts": 0,
                    "efg": 0, "porpag": 0, "nat_ppg": 0, "nat_gp": 0},
        } for p in roster["players"]],
        "lineups": [], "lineup_total_minutes_considered": 0,
        "team_avg_per40": {k: 0 for k in PER40_KEYS},
        "data_quality": {"games_total": 0, "games_lineup_used": 0, "orientation_flipped": 0, "excluded": [],
                         "unattributed_pct": 0, "inferred_missing_subs": 0, "unresolved_sub_conflicts": 0,
                         "box_minutes_unreliable_games": [],
                         "minutes_check": {"games_checked": 0, "total_abs_diff_pct": 0, "worst": [], "worst_games": []},
                         "points_check": {"players_checked": 0, "mismatches": 0, "examples": []},
                         "gp_vs_national_mismatches": [], "ppg_vs_national": {"checked": 0, "mismatches": []}},
        "roster_2026_27": roster,
    }


teams = {}
for key, t in D["teams"].items():
    teams[key] = zero_team(key, t["kind"], t["name"], t.get("mascot", ""), t["roster_2026_27"])
for key, info in NEW_TEAMS.items():
    teams[key] = zero_team(key, "opponent", info["name"], info["mascot"], roster_for_new_team(key))

conference = [{"key": k, "name": D["teams"][k]["name"], "record": "0-0", "ppg": 0, "oppg": 0, "net": 0, "pace": 0}
              for k in D["meta"]["conference_members"]]
out = {"meta": {"season": "2026-27", "built": date.today().isoformat(), "no_games_yet": True,
                "roster_fetched": R["meta"]["fetched"], "new_teams": list(NEW_TEAMS)},
       "conference": conference, "teams": teams}
with open(os.path.join(HERE, "data", "season_2026-27.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(f"wrote data/season_2026-27.json: {len(teams)} teams "
      f"({sum(len(t['roster_players']) for t in teams.values())} players), all stats 0")
