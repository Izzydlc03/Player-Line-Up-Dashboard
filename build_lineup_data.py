# Rebuilds data/dashboard_data.json for all Big West teams from the raw
# season data in the Player-Overview-Dashboard repo. Clone that repo as a
# sibling directory before running (or point POD_DIR at your checkout):
#   git clone https://github.com/Izzydlc03/Player-Overview-Dashboard.git ../Player-Overview-Dashboard
#   python3 build_lineup_data.py
#
# Play-by-play/boxscore CSVs (csv1-4) are identical between main and the
# add-opponents-remove-hawaii-ucdavis branch, so lineup/quarter numbers are
# unaffected by which one you check out. That branch's data/<season>.json
# additionally carries a per-player "advanced" block (national stats: BPM,
# usage%, TS%, ORtg/DRtg, etc.) that main doesn't have yet — this script
# pulls it in when present and skips it gracefully when it's not.
import json, math, os, re, unicodedata, collections
import pandas as pd

POD_DIR = os.environ.get("POD_DIR", "../Player-Overview-Dashboard")
SEASON = os.environ.get("SEASON", "2025-26")
BASE = f"{POD_DIR}/{SEASON}"
JSON_PATH = f"{POD_DIR}/data/{SEASON}.json"

# JSON key -> exact team name string used in the play-by-play / boxscore CSVs
TEAM_NAME = {
    "ucsd": "UC San Diego",
    "ucirvine": "UC Irvine",
    "calpoly": "Cal Poly",
    "csub": "CSU Bakersfield",
    "csuf": "Cal St. Fullerton",
    "csun": "CSUN",
    "csulb": "Long Beach St.",
    "ucr": "UC Riverside",
    "ucsb": "UC Santa Barbara",
}
TEAM_KEYS = list(TEAM_NAME.keys())

# Non-conference "scouting" opponents, each with its own standalone
# csv1-4 folder under opponents/<folder>/<season>/ (added on the
# add-opponents-remove-hawaii-ucdavis branch). csv_name is the exact team
# string inside that folder's own CSVs; advanced_name is how the same team
# is spelled in opponents/overall_data/wbb_d1_processed_players.csv (the
# national stats dataset), where it differs.
OPPONENT_TEAMS = {
    "lmu":        {"folder": "LMU",           "csv_name": "LMU (CA)",       "advanced_name": "Loyola Marymount", "label": "Loyola Marymount", "mascot": "Lions"},
    "nau":        {"folder": "NAU",           "csv_name": "Northern Ariz.", "advanced_name": "Northern Arizona", "label": "Northern Arizona", "mascot": "Lumberjacks"},
    "portlandst": {"folder": "PortlandState", "csv_name": "Portland St.",   "advanced_name": "Portland St.",     "label": "Portland State",   "mascot": "Vikings"},
    "usd":        {"folder": "USD",           "csv_name": "San Diego",     "advanced_name": "San Diego",        "label": "San Diego",        "mascot": "Toreros"},
    "usf":        {"folder": "USF",           "csv_name": "San Francisco", "advanced_name": "San Francisco",    "label": "San Francisco",    "mascot": "Dons"},
    "washington": {"folder": "Washington",    "csv_name": "Washington",    "advanced_name": "Washington",       "label": "Washington",       "mascot": "Huskies"},
}
ALL_TEAM_NAME = dict(TEAM_NAME, **{k: v["csv_name"] for k, v in OPPONENT_TEAMS.items()})

idx = pd.read_csv(f"{BASE}/csv1_game_index.csv")
box = pd.read_csv(f"{BASE}/csv2_boxscore_players.csv")
pbp = pd.read_csv(f"{BASE}/csv3_playbyplay.csv")
qtr = pd.read_csv(f"{BASE}/csv4_play_analysis.csv")
with open(JSON_PATH) as f:
    season_json = json.load(f)

NATIONAL_ADV_PATH = f"{POD_DIR}/opponents/overall_data/wbb_d1_processed_players.csv"
national_adv_df = pd.read_csv(NATIONAL_ADV_PATH) if os.path.exists(NATIONAL_ADV_PATH) else None


def norm(name):
    return re.sub(r"\s+", "", str(name)).upper()


def norm_for_match(name):
    """Loose match key: strip accents/periods, collapse whitespace, lowercase."""
    name = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode("ascii")
    name = re.sub(r"\.", "", name)
    return re.sub(r"\s+", " ", name).strip().lower()


ADV_FIELDS = ["bpm", "adjoe", "drtg", "usg", "ts", "efg", "porpag", "cls", "pos"]


def extract_advanced(adv):
    if adv is None:
        return None
    def get(f):
        v = adv.get(f) if hasattr(adv, "get") else adv[f]
        return None if (isinstance(v, float) and math.isnan(v)) else v
    out = {}
    for f in ("cls", "pos"):
        v = get(f)
        out[f] = "" if v is None else str(v)
    for f in ("bpm", "adjoe", "drtg", "usg", "ts", "efg", "porpag"):
        v = get(f)
        try:
            out[f] = round(float(v), 3) if v is not None else None
        except (TypeError, ValueError):
            out[f] = None
    return out


def display_name(last_first):
    if "," in last_first:
        last, first = [p.strip() for p in last_first.split(",", 1)]
        return f"{first.title()} {last.title()}"
    return str(last_first).title()


def made(s):
    if pd.isna(s):
        return 0
    return int(str(s).split("-")[0])


def quarter_pts(row, q):
    fgm, tpm, ftm = made(row.get(f"q{q}_fg", "0-0")), made(row.get(f"q{q}_3p", "0-0")), made(row.get(f"q{q}_ft", "0-0"))
    return 2 * (fgm - tpm) + 3 * tpm + ftm


def shot_value(play):
    if "3PTR" in play:
        return 3
    if "FT" in play:
        return 1
    return 2


def period_index(p):
    p = str(p)
    return int(p) - 1 if p in ("1", "2", "3", "4") else None


PERIOD_LEN = {"1": 600, "2": 600, "3": 600, "4": 600}
DEFAULT_LEN = 300


def parse_clock(t):
    if t == "--" or pd.isna(t):
        return None
    try:
        m, s = t.split(":")
        return int(m) * 60 + int(s)
    except Exception:
        return None


BOX_KEYS = (
    ["fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "ast", "tov", "stl", "blk"]
    + ["opp_" + k for k in ["fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "ast", "tov"]]
)
EMPTY_BOX = lambda: {k: 0 for k in BOX_KEYS}  # noqa: E731


def apply_event(target_box, team_col, play, prefix=""):
    """Increment target_box in place for one play event."""
    if not isinstance(play, str):
        return
    good = play.startswith("GOOD")
    miss = play.startswith("MISS")
    if good or miss:
        is3 = "3PTR" in play
        isft = "FT" in play
        if isft:
            target_box[prefix + "fta"] += 1
            if good:
                target_box[prefix + "ftm"] += 1
        else:
            target_box[prefix + "fga"] += 1
            if is3:
                target_box[prefix + "tpa"] += 1
            if good:
                target_box[prefix + "fgm"] += 1
                if is3:
                    target_box[prefix + "tpm"] += 1
    elif play.startswith("REBOUND OFF"):
        target_box[prefix + "oreb"] += 1
    elif play.startswith("REBOUND DEF"):
        target_box[prefix + "dreb"] += 1
    elif play.startswith("ASSIST"):
        target_box[prefix + "ast"] += 1
    elif play.startswith("TURNOVER"):
        target_box[prefix + "tov"] += 1
    elif play.startswith("STEAL") and prefix == "":
        target_box["stl"] += 1
    elif play.startswith("BLOCK") and prefix == "":
        target_box["blk"] += 1


def add_resolved_team(pbp_df, box_df):
    """Some scraped datasets (notably the standalone opponent-folder files)
    have csv3's `team` column swapped relative to the (correct) boxscore
    roster for a game. Resolve each named play's team from the boxscore
    instead, via an `rteam` column, so both conference and opponent data
    are safe to use the same way regardless of that bug."""
    player_game_team = {}
    for r in box_df.itertuples():
        if r.player != "TEAM":
            player_game_team[(r.game_id, norm(r.player))] = r.team

    def resolve(row):
        if isinstance(row.player, str) and row.player != "TEAM":
            t = player_game_team.get((row.game_id, norm(row.player)))
            if t:
                return t
        return row.team

    pbp_df = pbp_df.copy()
    pbp_df["rteam"] = pbp_df.apply(resolve, axis=1)
    return pbp_df


def process_team(team_key, team_name, idx_l, box_l, pbp_l, qtr_l, kind, label, mascot, advanced_lookup):
    games = idx_l[(idx_l.home_team == team_name) | (idx_l.away_team == team_name)].copy()
    game_ids = set(games.game_id)
    team_box = box_l[box_l.team == team_name]

    roster_info = {}
    for _, r in team_box.iterrows():
        k = norm(r.player)
        if k not in roster_info:
            roster_info[k] = {"name": display_name(r.player), "jersey": str(r.jersey).lstrip("0") or "0"}

    player_totals = collections.defaultdict(lambda: {"pts": 0, "gp": 0})
    for _, r in team_box.iterrows():
        k = norm(r.player)
        player_totals[k]["pts"] += r.pts if pd.notna(r.pts) else 0
        player_totals[k]["gp"] += 1

    # --- team points per quarter (season avg + per-game samples) ---
    team_q_totals, opp_q_totals, n_games = [0, 0, 0, 0], [0, 0, 0, 0], 0
    game_samples = {}
    for _, g in games.iterrows():
        gid = g.game_id
        opp_name = g.away_team if g.home_team == team_name else g.home_team
        rows = qtr_l[qtr_l.game_id == gid]
        us_row, opp_row = rows[rows.team == team_name], rows[rows.team != team_name]
        if us_row.empty or opp_row.empty:
            continue
        us_row, opp_row = us_row.iloc[0], opp_row.iloc[0]
        us_q = [quarter_pts(us_row, i) for i in range(1, 5)]
        opp_q = [quarter_pts(opp_row, i) for i in range(1, 5)]
        for i in range(4):
            team_q_totals[i] += us_q[i]
            opp_q_totals[i] += opp_q[i]
        n_games += 1
        game_samples[gid] = {
            "label": f"vs {opp_name} — {g.date}", "us": us_q, "opp": opp_q,
            "conference": bool(g.is_conference_game), "opp_key": next((k for k, v in ALL_TEAM_NAME.items() if v == opp_name), None),
        }
    n_games = n_games or 1
    team_quarters = {"season": {
        "label": "Season Average (all games)",
        "us": [round(v / n_games, 1) for v in team_q_totals],
        "opp": [round(v / n_games, 1) for v in opp_q_totals],
    }}
    conf_samples = [k for k, v in game_samples.items() if v["conference"]]
    for gid in conf_samples[:6]:
        team_quarters[gid] = game_samples[gid]

    # --- player points per quarter ---
    team_pbp = pbp_l[(pbp_l.game_id.isin(game_ids)) & (pbp_l.rteam == team_name)].copy()
    made_shots = team_pbp[team_pbp.play.fillna("").str.startswith("GOOD")].copy()
    made_shots["value"] = made_shots.play.apply(shot_value)
    made_shots["qidx"] = made_shots.period.apply(period_index)
    player_quarters = collections.defaultdict(lambda: [0, 0, 0, 0])
    for _, r in made_shots.dropna(subset=["qidx"]).iterrows():
        player_quarters[norm(r.player)][int(r.qidx)] += r.value

    players_out = []
    for k, totals in player_quarters.items():
        info = roster_info.get(k, {"name": display_name(k), "jersey": "-"})
        gp = player_totals[k]["gp"] or 1
        adv = extract_advanced(advanced_lookup.get(norm_for_match(info["name"])))
        entry = {
            "name": info["name"], "jersey": info["jersey"],
            "ppg": round(player_totals[k]["pts"] / gp, 1),
            "q": [round(v / gp, 2) for v in totals],
        }
        if adv:
            entry["adv"] = adv
        players_out.append(entry)
    players_out.sort(key=lambda p: -p["ppg"])
    players_out = [p for p in players_out if p["ppg"] >= 1.5][:10]

    # --- lineup reconstruction (own on-court 5, extended box, vs-opponent split) ---
    lineup_stats = collections.defaultdict(lambda: {"seconds": 0.0, "for_pts": 0, "against_pts": 0, "box": EMPTY_BOX()})
    lineup_vs_opp = collections.defaultdict(lambda: {"seconds": 0.0, "for_pts": 0, "against_pts": 0})

    for gid in game_ids:
        grows = pbp_l[pbp_l.game_id == gid]
        if grows.empty:
            continue
        ginfo = idx_l[idx_l.game_id == gid].iloc[0]
        is_home = ginfo.home_team == team_name
        opp_name = ginfo.away_team if is_home else ginfo.home_team

        starters_rows = box_l[(box_l.game_id == gid) & (box_l.team == team_name) & (box_l.started == True)]  # noqa: E712
        on_court = set(norm(n) for n in starters_rows.player.tolist())
        if len(on_court) != 5:
            fallback = box_l[(box_l.game_id == gid) & (box_l.team == team_name)].sort_values("min", ascending=False)
            on_court = set(norm(n) for n in fallback.player.head(5).tolist())
        if len(on_court) != 5:
            continue

        last_period, last_time_mark = None, PERIOD_LEN.get("1", DEFAULT_LEN)
        last_us_score = last_opp_score = 0

        for _, row in grows.iterrows():
            period = str(row.period)
            if period != last_period:
                last_period = period
                last_time_mark = PERIOD_LEN.get(period, DEFAULT_LEN)

            t = parse_clock(row.time_remaining)
            if t is not None:
                elapsed = max(0, last_time_mark - t)
                if elapsed:
                    key = frozenset(on_court)
                    lineup_stats[key]["seconds"] += elapsed
                    lineup_vs_opp[(key, opp_name)]["seconds"] += elapsed
                last_time_mark = t

            key = frozenset(on_court)
            if row.rteam == team_name:
                apply_event(lineup_stats[key]["box"], row.rteam, row.play)
            elif row.rteam == opp_name:
                apply_event(lineup_stats[key]["box"], row.rteam, row.play, prefix="opp_")

            away_s, home_s = row.away_score, row.home_score
            if pd.notna(away_s) and pd.notna(home_s):
                us_score = home_s if is_home else away_s
                opp_score = away_s if is_home else home_s
                d_us, d_opp = us_score - last_us_score, opp_score - last_opp_score
                if d_us:
                    lineup_stats[key]["for_pts"] += d_us
                    lineup_vs_opp[(key, opp_name)]["for_pts"] += d_us
                if d_opp:
                    lineup_stats[key]["against_pts"] += d_opp
                    lineup_vs_opp[(key, opp_name)]["against_pts"] += d_opp
                last_us_score, last_opp_score = us_score, opp_score

            if row.rteam == team_name and isinstance(row.play, str):
                if row.play.startswith("SUB OUT by"):
                    on_court.discard(norm(row.player))
                elif row.play.startswith("SUB IN by"):
                    on_court.add(norm(row.player))

    # team-average per-40 rates (for strength/weakness comparison)
    team_totals = EMPTY_BOX()
    total_minutes = 0.0
    for s in lineup_stats.values():
        total_minutes += s["seconds"] / 60
        for k in team_totals:
            team_totals[k] += s["box"][k]
    total_minutes = total_minutes or 1
    team_avg_per40 = {k: round(v / total_minutes * 40, 2) for k, v in team_totals.items()}

    lineups_out = []
    lid = 0
    for key, stats in lineup_stats.items():
        minutes = stats["seconds"] / 60
        if minutes < 6:
            continue
        lid += 1
        names = sorted(roster_info.get(p, {"name": display_name(p)})["name"] for p in key)
        b = stats["box"]
        per40 = {k: round(v / minutes * 40, 2) if minutes else 0 for k, v in b.items()}
        vs_opp = []
        for (k2, opp_name), vstats in lineup_vs_opp.items():
            if k2 != key:
                continue
            vmin = vstats["seconds"] / 60
            if vmin < 3:
                continue
            opp_key = next((ok for ok, ov in ALL_TEAM_NAME.items() if ov == opp_name), None)
            vs_opp.append({
                "opponent": opp_name, "opp_key": opp_key, "min": round(vmin, 1),
                "net": int(vstats["for_pts"] - vstats["against_pts"]),
                "net_per40": round((vstats["for_pts"] - vstats["against_pts"]) / vmin * 40, 1) if vmin else 0,
            })
        vs_opp.sort(key=lambda v: -v["net_per40"])
        lineups_out.append({
            "id": f"{team_key}-L{lid}",
            "players": names,
            "min": round(minutes, 1),
            "for_pts": int(stats["for_pts"]),
            "against_pts": int(stats["against_pts"]),
            "net": int(stats["for_pts"] - stats["against_pts"]),
            "net_per40": round((stats["for_pts"] - stats["against_pts"]) / minutes * 40, 1) if minutes else 0,
            "per40": per40,
            "vs_opponents": vs_opp,
        })
    lineups_out.sort(key=lambda l: -l["min"])

    if kind == "conference":
        own_games = season_json[team_key]["games"]
        wins = sum(1 for g in own_games if g["win"])
        kpis = {
            "record": f"{wins}-{len(own_games) - wins}",
            "ppg": round(sum(g["pf"] for g in own_games) / len(own_games), 1),
            "oppg": round(sum(g["pa"] for g in own_games) / len(own_games), 1),
        }
    else:
        wins = losses = pf_total = pa_total = 0
        for _, g in games.iterrows():
            is_home = g.home_team == team_name
            pf, pa = (g.home_score, g.away_score) if is_home else (g.away_score, g.home_score)
            pf_total += pf
            pa_total += pa
            if g.winner == team_name:
                wins += 1
            else:
                losses += 1
        gp = max(wins + losses, 1)
        kpis = {"record": f"{wins}-{losses}", "ppg": round(pf_total / gp, 1), "oppg": round(pa_total / gp, 1)}

    return {
        "key": team_key,
        "kind": kind,
        "name": label,
        "mascot": mascot,
        "kpis": kpis,
        "team_quarters": team_quarters,
        "roster_players": players_out,
        "lineups": lineups_out,
        "lineup_total_minutes_considered": round(total_minutes, 1),
        "team_avg_per40": team_avg_per40,
    }


def national_adv_lookup(advanced_name):
    if national_adv_df is None:
        return {}
    rows = national_adv_df[national_adv_df.team == advanced_name]
    return {norm_for_match(r["name"]): r.to_dict() for _, r in rows.iterrows()}


pbp = add_resolved_team(pbp, box)

teams_out = {}
for tk in TEAM_KEYS:
    print("processing", tk, "(conference) ...")
    adv_lookup = {
        norm_for_match(p["name"]): p.get("advanced")
        for p in season_json.get(tk, {}).get("players", [])
    }
    teams_out[tk] = process_team(
        tk, TEAM_NAME[tk], idx, box, pbp, qtr, "conference",
        season_json[tk].get("name", tk), season_json[tk].get("mascot", ""), adv_lookup,
    )

for tk, cfg in OPPONENT_TEAMS.items():
    print("processing", tk, "(opponent) ...")
    opp_base = f"{POD_DIR}/opponents/{cfg['folder']}/{SEASON}"
    opp_idx = pd.read_csv(f"{opp_base}/csv1_game_index.csv")
    opp_box = pd.read_csv(f"{opp_base}/csv2_boxscore_players.csv")
    opp_pbp = pd.read_csv(f"{opp_base}/csv3_playbyplay.csv")
    opp_qtr = pd.read_csv(f"{opp_base}/csv4_play_analysis.csv")
    opp_pbp = add_resolved_team(opp_pbp, opp_box)
    adv_lookup = national_adv_lookup(cfg["advanced_name"])
    teams_out[tk] = process_team(
        tk, cfg["csv_name"], opp_idx, opp_box, opp_pbp, opp_qtr, "opponent",
        cfg["label"], cfg["mascot"], adv_lookup,
    )

# --- conference-wide summary (used by the Conference tab) ---
conf_out = []
for key, team in season_json.items():
    games = team.get("games", [])
    if not games:
        continue
    gp = len(games)
    ppg = sum(g["pf"] for g in games) / gp
    oppg = sum(g["pa"] for g in games) / gp
    players = team.get("players", [])
    poss = sum((p.get("fga", 0) - p.get("oreb", 0) + p.get("to", 0) + 0.44 * p.get("fta", 0)) for p in players)
    team_gp = max((p.get("gp", 0) for p in players), default=gp) or gp
    conf_out.append({
        "key": key, "name": team.get("name", key), "mascot": team.get("mascot", ""),
        "ppg": round(ppg, 1), "oppg": round(oppg, 1), "net": round(ppg - oppg, 1),
        "pace": round(poss / team_gp, 1) if team_gp else 0, "gp": gp,
    })
conf_out.sort(key=lambda t: -t["net"])

out = {
    "meta": {
        "season": SEASON,
        "source": "Player-Overview-Dashboard raw data (csv1-4 play-by-play/boxscore + data/<season>.json)",
        "default_team": "ucsd",
    },
    "teams": teams_out,
    "conference": conf_out,
}

with open("data/dashboard_data.json", "w") as f:
    json.dump(out, f, indent=2)

print("done. teams:", list(teams_out.keys()))
for tk, t in teams_out.items():
    print(f"  {tk}: {len(t['lineups'])} lineups, {len(t['roster_players'])} players, kpis={t['kpis']}")
