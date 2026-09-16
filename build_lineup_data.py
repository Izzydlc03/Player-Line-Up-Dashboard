# Rebuilds data/dashboard_data.json from the raw season data in the
# Player-Overview-Dashboard repo. Clone that repo as a sibling directory
# before running (or point POD_DIR at wherever you checked it out):
#   git clone https://github.com/Izzydlc03/Player-Overview-Dashboard.git ../Player-Overview-Dashboard
#   python3 build_lineup_data.py
import json, os, re, collections
import pandas as pd

POD_DIR = os.environ.get("POD_DIR", "../Player-Overview-Dashboard")
SEASON = os.environ.get("SEASON", "2025-26")
BASE = f"{POD_DIR}/{SEASON}"
JSON_PATH = f"{POD_DIR}/data/{SEASON}.json"
UCSD = "UC San Diego"

idx = pd.read_csv(f"{BASE}/csv1_game_index.csv")
box = pd.read_csv(f"{BASE}/csv2_boxscore_players.csv")
pbp = pd.read_csv(f"{BASE}/csv3_playbyplay.csv")
qtr = pd.read_csv(f"{BASE}/csv4_play_analysis.csv")

ucsd_games = idx[(idx.home_team == UCSD) | (idx.away_team == UCSD)].copy()
ucsd_game_ids = set(ucsd_games.game_id)

def norm(name):
    return re.sub(r"\s+", "", str(name)).upper()

def display_name(last_first):
    if "," in last_first:
        last, first = [p.strip() for p in last_first.split(",", 1)]
        return f"{first.title()} {last.title()}"
    return last_first.title()

# ---------- roster: jersey + position lookup from box scores ----------
ucsd_box = box[box.team == UCSD]
roster_info = {}
for _, r in ucsd_box.iterrows():
    key = norm(r.player)
    if key not in roster_info:
        roster_info[key] = {"name": display_name(r.player), "jersey": str(r.jersey).lstrip("0") or "0"}

# ---------- season PPG per player ----------
player_totals = collections.defaultdict(lambda: {"pts": 0, "gp": 0})
for _, r in ucsd_box.iterrows():
    key = norm(r.player)
    player_totals[key]["pts"] += r.pts if pd.notna(r.pts) else 0
    player_totals[key]["gp"] += 1

# ---------- 1) team points per quarter (season avg) + per-game samples ----------
def quarter_pts(row, q):
    fg = row.get(f"q{q}_fg", "0-0")
    tp = row.get(f"q{q}_3p", "0-0")
    ft = row.get(f"q{q}_ft", "0-0")
    def made(s):
        if pd.isna(s):
            return 0
        return int(str(s).split("-")[0])
    fgm, tpm, ftm = made(fg), made(tp), made(ft)
    return 2 * (fgm - tpm) + 3 * tpm + ftm

team_q_totals = [0, 0, 0, 0]
opp_q_totals = [0, 0, 0, 0]
n_games = 0
game_samples = {}

for _, g in ucsd_games.iterrows():
    gid = g.game_id
    opp_name = g.away_team if g.home_team == UCSD else g.home_team
    rows = qtr[qtr.game_id == gid]
    us_row = rows[rows.team == UCSD]
    opp_row = rows[rows.team != UCSD]
    if us_row.empty or opp_row.empty:
        continue
    us_row = us_row.iloc[0]
    opp_row = opp_row.iloc[0]
    us_q = [quarter_pts(us_row, i) for i in range(1, 5)]
    opp_q = [quarter_pts(opp_row, i) for i in range(1, 5)]
    for i in range(4):
        team_q_totals[i] += us_q[i]
        opp_q_totals[i] += opp_q[i]
    n_games += 1
    game_samples[gid] = {
        "label": f"vs {opp_name} — {g.date}",
        "us": us_q,
        "opp": opp_q,
        "conference": bool(g.is_conference_game),
    }

team_quarters_season = {
    "label": "Season Average (all games)",
    "us": [round(v / n_games, 1) for v in team_q_totals],
    "opp": [round(v / n_games, 1) for v in opp_q_totals],
}

# pick a handful of real conference-game samples for the selector
conf_samples = {gid: v for gid, v in game_samples.items() if v["conference"]}
sample_keys = list(conf_samples.keys())[:4]

# ---------- 2) player points per quarter (season totals, from play-by-play) ----------
ucsd_pbp = pbp[(pbp.game_id.isin(ucsd_game_ids)) & (pbp.team == UCSD)].copy()
made_shots = ucsd_pbp[ucsd_pbp.play.fillna("").str.startswith("GOOD")].copy()

def shot_value(play):
    if "3PTR" in play:
        return 3
    if "FT" in play:
        return 1
    return 2

made_shots["value"] = made_shots.play.apply(shot_value)

def period_index(p):
    p = str(p)
    if p in ("1", "2", "3", "4"):
        return int(p) - 1
    return None  # OT / other -> excluded from quarter chart

made_shots["qidx"] = made_shots.period.apply(period_index)
player_quarters = collections.defaultdict(lambda: [0, 0, 0, 0])
for _, r in made_shots.dropna(subset=["qidx"]).iterrows():
    key = norm(r.player)
    player_quarters[key][int(r.qidx)] += r.value

players_out = []
for key, totals in player_quarters.items():
    info = roster_info.get(key, {"name": display_name(key), "jersey": "-"})
    gp = player_totals[key]["gp"] or 1
    ppg = round(player_totals[key]["pts"] / gp, 1)
    q_per_game = [round(v / gp, 2) for v in totals]
    players_out.append({
        "name": info["name"], "jersey": info["jersey"], "ppg": ppg,
        "q": q_per_game, "season_q_total": totals, "gp": gp
    })
players_out.sort(key=lambda p: -p["ppg"])
players_out = [p for p in players_out if p["ppg"] >= 1.5][:10]

# ---------- 3) lineup reconstruction via SUB IN / SUB OUT ----------
PERIOD_LEN = {"1": 600, "2": 600, "3": 600, "4": 600}
DEFAULT_LEN = 300  # OT / anything else

def parse_clock(t):
    if t == "--" or pd.isna(t):
        return None
    try:
        m, s = t.split(":")
        return int(m) * 60 + int(s)
    except Exception:
        return None

lineup_stats = collections.defaultdict(lambda: {"seconds": 0.0, "for_pts": 0, "against_pts": 0})

for gid in ucsd_game_ids:
    grows = pbp[pbp.game_id == gid]
    if grows.empty:
        continue
    ginfo = idx[idx.game_id == gid].iloc[0]
    ucsd_home = ginfo.home_team == UCSD

    starters_rows = box[(box.game_id == gid) & (box.team == UCSD) & (box.started == True)]
    on_court = set(norm(n) for n in starters_rows.player.tolist())
    if len(on_court) != 5:
        fallback = box[(box.game_id == gid) & (box.team == UCSD)].sort_values("min", ascending=False)
        on_court = set(norm(n) for n in fallback.player.head(5).tolist())
    if len(on_court) != 5:
        continue

    last_period = None
    last_time_mark = PERIOD_LEN.get("1", DEFAULT_LEN)
    last_us_score = 0
    last_opp_score = 0

    for _, row in grows.iterrows():
        period = str(row.period)
        if period != last_period:
            last_period = period
            last_time_mark = PERIOD_LEN.get(period, DEFAULT_LEN)

        t = parse_clock(row.time_remaining)
        if t is not None:
            elapsed = max(0, last_time_mark - t)
            if elapsed:
                lineup_stats[frozenset(on_court)]["seconds"] += elapsed
            last_time_mark = t

        away_s, home_s = row.away_score, row.home_score
        if pd.notna(away_s) and pd.notna(home_s):
            us_score = home_s if ucsd_home else away_s
            opp_score = away_s if ucsd_home else home_s
            d_us = us_score - last_us_score
            d_opp = opp_score - last_opp_score
            if d_us:
                lineup_stats[frozenset(on_court)]["for_pts"] += d_us
            if d_opp:
                lineup_stats[frozenset(on_court)]["against_pts"] += d_opp
            last_us_score, last_opp_score = us_score, opp_score

        if row.team == UCSD and isinstance(row.play, str):
            if row.play.startswith("SUB OUT by"):
                who = norm(row.player)
                on_court.discard(who)
            elif row.play.startswith("SUB IN by"):
                who = norm(row.player)
                on_court.add(who)

lineups_out = []
for key, stats in lineup_stats.items():
    minutes = stats["seconds"] / 60
    if minutes < 8:
        continue
    names = sorted(roster_info.get(p, {"name": display_name(p)})["name"] for p in key)
    net40 = ((stats["for_pts"] - stats["against_pts"]) / minutes * 40) if minutes else 0
    lineups_out.append({
        "players": names,
        "min": round(minutes, 1),
        "for_pts": int(stats["for_pts"]),
        "against_pts": int(stats["against_pts"]),
        "net": int(stats["for_pts"] - stats["against_pts"]),
        "net_per40": round(net40, 1),
    })
lineups_out.sort(key=lambda l: -l["min"])
total_min = sum(l["min"] for l in lineups_out) or 1

# ---------- 4) conference comparison from data/2025-26.json ----------
with open(JSON_PATH) as f:
    season_json = json.load(f)

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
    pace = poss / team_gp if team_gp else 0
    conf_out.append({
        "key": key,
        "name": team.get("name", key),
        "mascot": team.get("mascot", ""),
        "ppg": round(ppg, 1),
        "oppg": round(oppg, 1),
        "net": round(ppg - oppg, 1),
        "pace": round(pace, 1),
        "gp": gp,
        "self": key == "ucsd",
    })
conf_out.sort(key=lambda t: -t["net"])

out = {
    "meta": {"season": "2025-26", "source": "Player-Overview-Dashboard raw data (csv1-4 + data/2025-26.json)"},
    "kpis_source_note": "record/kpis derived below",
    "team_quarters": {"season": team_quarters_season},
    "roster_players": players_out,
    "lineups": lineups_out,
    "lineup_total_minutes_considered": round(total_min, 1),
    "conference": conf_out,
}

for k in sample_keys:
    out["team_quarters"][k] = game_samples[k]

# record / season kpis for UCSD
ucsd_team_games = season_json["ucsd"]["games"]
wins = sum(1 for g in ucsd_team_games if g["win"])
losses = len(ucsd_team_games) - wins
conf_games = [g for g in ucsd_team_games if False]  # not marked in this json; leave overall record only
out["kpis"] = {
    "record": f"{wins}-{losses}",
    "ppg": round(sum(g["pf"] for g in ucsd_team_games) / len(ucsd_team_games), 1),
    "oppg": round(sum(g["pa"] for g in ucsd_team_games) / len(ucsd_team_games), 1),
}

with open("data/dashboard_data.json", "w") as f:
    json.dump(out, f, indent=2)

print("players:", len(players_out))
print("lineups:", len(lineups_out))
print("conference teams:", len(conf_out))
print("sample games:", list(out["team_quarters"].keys()))
print("kpis:", out["kpis"])
print("top lineups:")
for l in lineups_out[:8]:
    print(" ", l)
