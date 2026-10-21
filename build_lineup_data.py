"""Build data/dashboard_data.json: per-team scoring, player and 5-man lineup
data for the 2025-26 season (12 Big West 2026-27 members + 6 D1 non-conference
opponents), reconstructed from play-by-play and box scores.

Inputs (CSV sets with csv1_game_index / csv2_boxscore_players /
csv3_playbyplay / csv4_play_analysis):
  <POD_DIR>/2025-26                         9 Big West teams (shared file)
  newmembers/2025-26                        Cal Baptist, Utah Valley, Sacramento St.
  <POD_DIR>/opponents/<X>/2025-26           one folder per non-conference opponent
  <POD_DIR>/opponents/overall_data/wbb_d1_processed_players.csv   national player stats
  data/rosters_2026-27.json                 optional (build_rosters.py)

    git clone https://github.com/Izzydlc03/Player-Overview-Dashboard.git ../Player-Overview-Dashboard
    python3 build_lineup_data.py

Accuracy safeguards (all reported under each team's "data_quality"):
  * play-by-play names are matched to box score players with name_match.py
    (unique matches only); games with an unmatched name are excluded from lineups
  * the play-by-play score orientation is checked against the csv1 final score
    and corrected per game when flipped; games that match neither are excluded
  * lineup stats only accumulate while exactly 5 players are on the floor
  * derived player minutes are compared with box score minutes, derived points
    with box score points, and PPG with the national dataset
"""
import collections
import json
import math
import os
import re
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import name_match as nm

POD_DIR = os.environ.get("POD_DIR", "../Player-Overview-Dashboard")
SEASON = os.environ.get("SEASON", "2025-26")
HERE = os.path.dirname(os.path.abspath(__file__))

POD_SHARED = f"{POD_DIR}/{SEASON}"
NEW_SHARED = os.path.join(HERE, "newmembers", SEASON)
NATIONAL_PATH = f"{POD_DIR}/opponents/overall_data/wbb_d1_processed_players.csv"
ROSTER_PATH = os.path.join(HERE, "data", "rosters_2026-27.json")
OUT_PATH = os.path.join(HERE, "data", "dashboard_data.json")

# key -> config. csv_name = team string inside the CSVs; national = team string
# in the national player-stats file. src = dataset the team is built from.
TEAMS = {
    "ucsd":       dict(kind="conference", csv_name="UC San Diego",       national="UC San Diego",       label="UC San Diego",       mascot="Tritons",     src="pod"),
    "calbaptist": dict(kind="conference", csv_name="California Baptist", national="Cal Baptist",        label="Cal Baptist",        mascot="Lancers",     src="new"),
    "csulb":      dict(kind="conference", csv_name="Long Beach St.",     national="Long Beach St.",     label="Long Beach State",   mascot="The Beach",   src="pod"),
    "csun":       dict(kind="conference", csv_name="CSUN",               national="Cal St. Northridge", label="Cal State Northridge", mascot="Matadors", src="pod"),
    "ucirvine":   dict(kind="conference", csv_name="UC Irvine",          national="UC Irvine",          label="UC Irvine",          mascot="Anteaters",   src="pod"),
    "utahvalley": dict(kind="conference", csv_name="Utah Valley",        national="Utah Valley",        label="Utah Valley",        mascot="Wolverines",  src="new"),
    "ucr":        dict(kind="conference", csv_name="UC Riverside",       national="UC Riverside",       label="UC Riverside",       mascot="Highlanders", src="pod"),
    "ucsb":       dict(kind="conference", csv_name="UC Santa Barbara",   national="UC Santa Barbara",   label="UC Santa Barbara",   mascot="Gauchos",     src="pod"),
    "calpoly":    dict(kind="conference", csv_name="Cal Poly",           national="Cal Poly",           label="Cal Poly",           mascot="Mustangs",    src="pod"),
    "sacstate":   dict(kind="conference", csv_name="Sacramento St.",     national="Sacramento St.",     label="Sacramento State",   mascot="Hornets",     src="new"),
    "csuf":       dict(kind="conference", csv_name="Cal St. Fullerton",  national="Cal St. Fullerton",  label="Cal State Fullerton", mascot="Titans",     src="pod"),
    "csub":       dict(kind="conference", csv_name="CSU Bakersfield",    national="Cal St. Bakersfield", label="Cal State Bakersfield", mascot="Roadrunners", src="pod"),
    "lmu":        dict(kind="opponent", csv_name="LMU (CA)",       national="Loyola Marymount", label="Loyola Marymount", mascot="Lions",       src="LMU"),
    "nau":        dict(kind="opponent", csv_name="Northern Ariz.", national="Northern Arizona", label="Northern Arizona", mascot="Lumberjacks", src="NAU"),
    "portlandst": dict(kind="opponent", csv_name="Portland St.",   national="Portland St.",     label="Portland State",   mascot="Vikings",     src="PortlandState"),
    "usd":        dict(kind="opponent", csv_name="San Diego",      national="San Diego",        label="San Diego",        mascot="Toreros",     src="USD"),
    "usf":        dict(kind="opponent", csv_name="San Francisco",  national="San Francisco",    label="San Francisco",    mascot="Dons",        src="USF"),
    "washington": dict(kind="opponent", csv_name="Washington",     national="Washington",       label="Washington",       mascot="Huskies",     src="Washington"),
}
NAME_TO_KEY = {c["csv_name"]: k for k, c in TEAMS.items()}

PERIOD_LEN = {"1": 600, "2": 600, "3": 600, "4": 600}
OT_LEN = 300  # periods labelled OT1 / 5thHalf / ... are 5-minute overtimes

BOX_KEYS = (
    ["fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "ast", "tov", "stl", "blk"]
    + ["opp_" + k for k in ["fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "ast", "tov"]]
)


def empty_box():
    return {k: 0 for k in BOX_KEYS}


def first_int(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    try:
        return int(float(str(v).split()[0]))
    except ValueError:
        return None


def parse_clock(t):
    if not isinstance(t, str) or t == "--":
        return None
    try:
        m, s = t.split(":")
        return int(m) * 60 + int(s)
    except ValueError:
        return None


def made(s):
    return 0 if pd.isna(s) else int(str(s).split("-")[0])


def attempted(s):
    return 0 if pd.isna(s) else int(str(s).split("-")[1])


def apply_event(box, play, prefix=""):
    if not isinstance(play, str):
        return
    good, miss = play.startswith("GOOD"), play.startswith("MISS")
    if good or miss:
        is3, isft = "3PTR" in play, "FT" in play
        if isft:
            box[prefix + "fta"] += 1
            box[prefix + "ftm"] += good
        else:
            box[prefix + "fga"] += 1
            box[prefix + "tpa"] += is3
            box[prefix + "fgm"] += good
            box[prefix + "tpm"] += good and is3
    elif play.startswith("REBOUND OFF"):
        box[prefix + "oreb"] += 1
    elif play.startswith("REBOUND DEF"):
        box[prefix + "dreb"] += 1
    elif play.startswith("ASSIST"):
        box[prefix + "ast"] += 1
    elif play.startswith("TURNOVER"):
        box[prefix + "tov"] += 1
    elif play.startswith("STEAL") and prefix == "":
        box["stl"] += 1
    elif play.startswith("BLOCK") and prefix == "":
        box["blk"] += 1


def shot_points(play):
    if not isinstance(play, str) or not play.startswith("GOOD"):
        return 0
    if "3PTR" in play:
        return 3
    return 1 if "FT" in play else 2


def display_name(raw):
    if "," in raw:
        last, first = [p.strip() for p in raw.split(",", 1)]
        return f"{first} {last}".strip()
    return raw.strip()


# --------------------------------------------------------------------------
# Datasets and per-game preparation
# --------------------------------------------------------------------------
class Dataset:
    def __init__(self, folder):
        self.folder = folder
        self.idx = pd.read_csv(f"{folder}/csv1_game_index.csv")
        self.box = pd.read_csv(f"{folder}/csv2_boxscore_players.csv")
        self.pbp = pd.read_csv(f"{folder}/csv3_playbyplay.csv")
        self.qtr = pd.read_csv(f"{folder}/csv4_play_analysis.csv")
        self.games = {r.game_id: r for r in self.idx.itertuples()}
        self.box_by_game = {g: d for g, d in self.box.groupby("game_id")}
        self.pbp_by_game = {g: d for g, d in self.pbp.groupby("game_id", sort=False)}
        # one canonical spelling per player per team across the whole season
        self.canon = {}
        for team, tb in self.box[self.box.player != "TEAM"].groupby("team"):
            together = set()
            for _, g in tb.groupby("game_id"):
                names = list(g.player.unique())
                together.update(frozenset((a, b)) for i, a in enumerate(names) for b in names[i + 1:])
            for raw, c in nm.cluster(tb.player.unique(), together).items():
                self.canon[(team, raw)] = c
        self._prepared = {}

    def prepare(self, gid):
        if gid not in self._prepared:
            self._prepared[gid] = self._prepare(gid)
        return self._prepared[gid]

    def _prepare(self, gid):
        g = self.games[gid]
        info = {"gid": gid, "status": "ok", "reason": "", "orientation": "ok", "rows": [], "starters": {}}
        bx = self.box_by_game.get(gid)
        pb = self.pbp_by_game.get(gid)
        if bx is None or pb is None or pb.empty:
            return dict(info, status="excluded", reason="no play-by-play")
        players = bx[bx.player != "TEAM"]
        cands = [(r.player, nm.parse(r.player)) for r in players.itertuples()]
        raw_team = {r.player: r.team for r in players.itertuples()}

        # resolve every named play-by-play player to a box score player
        resolved, unresolved = {}, []
        for name in {p for p in pb.player.dropna() if p != "TEAM"}:
            got = nm.resolve(name, cands)
            if got is None:
                unresolved.append(name)
            else:
                resolved[name] = got
        if unresolved:
            return dict(info, status="excluded", reason=f"unmatched names: {sorted(unresolved)[:3]}")

        # map each csv3 team label to the true team (labels are swapped in some files)
        votes = collections.defaultdict(collections.Counter)
        for r in pb.itertuples():
            if r.player in resolved:
                votes[r.team][raw_team[resolved[r.player]]] += 1
        label_map = {}
        for lab, c in votes.items():
            best, n = c.most_common(1)[0]
            label_map[lab] = best if n / sum(c.values()) >= 0.9 else None

        # score orientation relative to csv1
        scored = pb.dropna(subset=["away_score", "home_score"])
        flip = False
        if scored.empty:
            return dict(info, status="excluded", reason="no scores in play-by-play")
        last = scored.iloc[-1]
        fa, fh = first_int(last.away_score), first_int(last.home_score)
        if (fa, fh) == (g.away_score, g.home_score):
            pass
        elif (fh, fa) == (g.away_score, g.home_score):
            flip = True
            info["orientation"] = "flipped"
        else:
            return dict(info, status="excluded", reason="final score does not match csv1")

        out_of_order = 0
        last_p, last_t = None, None
        rows = []
        for r in pb.itertuples():
            period = str(r.period)
            secs = parse_clock(r.time_remaining)
            if secs is not None:
                if period == last_p and last_t is not None and secs > last_t + 2:
                    out_of_order += 1
                last_p, last_t = period, secs
            a, h = first_int(r.away_score), first_int(r.home_score)
            if flip:
                a, h = h, a
            if r.player in resolved:
                raw = resolved[r.player]
                team, pid = raw_team[raw], self.canon[(raw_team[raw], raw)]
            else:
                team, pid = label_map.get(r.team), None
            rows.append((period, secs, team, pid, r.play, a, h))
        info["rows"] = rows
        info["out_of_order"] = out_of_order

        # starters: box flag when it names exactly 5, else inferred from the play-by-play
        for t in {g.home_team, g.away_team}:
            flagged = {self.canon[(t, p.player)] for p in players[(players.team == t) & (players.started == True)].itertuples()}  # noqa: E712
            seen, inferred = set(), set()
            for period, secs, team, pid, play, a, h in rows:
                if team != t or pid is None or pid in seen:
                    continue
                seen.add(pid)
                if not (isinstance(play, str) and play.startswith("SUB IN")):
                    inferred.add(pid)
            if len(flagged) == 5:
                info["starters"][t] = flagged
                if len(inferred) == 5 and inferred != flagged:
                    info["starter_mismatch"] = info.get("starter_mismatch", 0) + 1
            elif len(inferred) == 5:
                info["starters"][t] = inferred
        return info


# --------------------------------------------------------------------------
# Per-team processing
# --------------------------------------------------------------------------
def team_games(ds, team_name):
    return [r for r in ds.idx.itertuples() if team_name in (r.home_team, r.away_team)]


def process_team(key, cfg, ds, national_rows, only_games=None, debug=None):
    T = cfg["csv_name"]
    games = team_games(ds, T)
    if only_games:
        games = [g for g in games if g.game_id in only_games]
    quality = {"games_total": len(games), "games_lineup_used": 0, "orientation_flipped": 0, "excluded": []}

    # roster identity (canonical spelling per player)
    box_t = ds.box[(ds.box.team == T) & (ds.box.player != "TEAM")].copy()
    box_t["pid"] = [ds.canon[(T, p)] for p in box_t.player]
    jersey = {pid: g.jersey.mode().iloc[0] for pid, g in box_t.groupby("pid")}
    activity = ["fg_a", "ft_a", "reb", "ast", "stl", "blk", "to", "pf", "pts"]
    played_mask = (box_t["min"].fillna(0) > 0) | (box_t[activity].fillna(0) > 0).any(axis=1)
    gp = box_t[played_mask].groupby("pid").game_id.nunique().to_dict()
    pts = box_t.groupby("pid").pts.sum().to_dict()
    box_min = box_t.groupby(["game_id", "pid"])["min"].sum().to_dict()

    # ---- season KPIs from csv1 --------------------------------------
    wins = pf = pa = 0
    for g in games:
        home = g.home_team == T
        pf += g.home_score if home else g.away_score
        pa += g.away_score if home else g.home_score
        wins += g.winner == T
    n = max(len(games), 1)
    kpis = {"record": f"{wins}-{len(games) - wins}", "ppg": round(pf / n, 1), "oppg": round(pa / n, 1)}

    # ---- points per quarter (csv4) ----------------------------------
    def qpts(row, q):
        fgm, tpm, ftm = made(row[f"q{q}_fg"]), made(row[f"q{q}_3p"]), made(row[f"q{q}_ft"])
        return 2 * (fgm - tpm) + 3 * tpm + ftm

    us_tot, opp_tot, nq = [0] * 4, [0] * 4, 0
    samples = []
    for g in games:
        rows = ds.qtr[ds.qtr.game_id == g.game_id]
        mine, theirs = rows[rows.team == T], rows[rows.team != T]
        if mine.empty or theirs.empty:
            continue
        us_q = [qpts(mine.iloc[0], i) for i in range(1, 5)]
        opp_q = [qpts(theirs.iloc[0], i) for i in range(1, 5)]
        for i in range(4):
            us_tot[i] += us_q[i]
            opp_tot[i] += opp_q[i]
        nq += 1
        opp = g.away_team if g.home_team == T else g.home_team
        samples.append((g.date, g.game_id, opp, us_q, opp_q))
    nq = max(nq, 1)
    team_quarters = {"season": {
        "label": "Season Average (all games)",
        "us": [round(v / nq, 1) for v in us_tot],
        "opp": [round(v / nq, 1) for v in opp_tot],
        "games": nq,
    }}
    for date, gid, opp, us_q, opp_q in sorted(samples):
        if opp in NAME_TO_KEY and len(team_quarters) < 9:
            team_quarters[gid] = {"label": f"vs {opp} — {date}", "us": us_q, "opp": opp_q, "opp_key": NAME_TO_KEY[opp]}

    # ---- lineups + player quarters ----------------------------------
    # Lineup stats for a game are staged and only committed when the game's
    # tracking agrees with the box score (derived player minutes within
    # MAX_BOX_DIFF of box minutes); player scoring is counted for every game.
    MAX_BOX_DIFF = 10.0
    stats = collections.defaultdict(lambda: {"sec": 0.0, "for": 0, "against": 0, "box": empty_box()})
    vs_opp = collections.defaultdict(lambda: {"sec": 0.0, "for": 0, "against": 0})
    player_q = collections.defaultdict(lambda: [0, 0, 0, 0])
    pbp_points = collections.Counter()
    derived_sec = collections.Counter()
    used_games = []
    scored_games = []
    game_diffs = []
    game_sec = {}
    unreliable_box = []
    inferred_subs = conflicts = 0
    total_sec = unattributed_sec = 0.0

    for g in games:
        info = ds.prepare(g.game_id)
        if info["status"] != "ok" or T not in info["starters"]:
            reason = info["reason"] or "could not identify 5 starters"
            quality["excluded"].append({"game_id": g.game_id, "reason": reason})
            continue
        if info["orientation"] == "flipped":
            quality["orientation_flipped"] += 1
        scored_games.append(g.game_id)
        home = g.home_team == T
        opp_name = g.away_team if home else g.home_team
        on = set(info["starters"][T])
        last_p, mark = None, 600
        last_us = last_opp = 0
        cur_sec = collections.Counter()
        gstats = collections.defaultdict(lambda: {"sec": 0.0, "for": 0, "against": 0, "box": empty_box()})
        gvs = collections.defaultdict(lambda: {"sec": 0.0, "for": 0, "against": 0})
        g_total = g_unattr = 0.0
        g_inferred = g_conflicts = 0

        def add(seconds):
            nonlocal g_total, g_unattr
            if seconds <= 0:
                return
            g_total += seconds
            for pid in on:
                cur_sec[pid] += seconds
            if len(on) == 5:
                k = frozenset(on)
                gstats[k]["sec"] += seconds
                gvs[(k, opp_name)]["sec"] += seconds
            else:
                g_unattr += seconds

        for period, secs, team, pid, play, a, h in info["rows"]:
            if period != last_p:
                if last_p is not None:
                    add(mark)  # run the rest of the previous period's clock
                last_p, mark = period, PERIOD_LEN.get(period, OT_LEN)
            if secs is not None:
                add(max(0, mark - secs))
                mark = min(mark, secs)
            if (team == T and pid is not None and pid not in on and isinstance(play, str)
                    and not play.startswith(("SUB", "TIMEOUT", "FOUL TECH"))):
                if len(on) < 5:
                    on.add(pid)  # fewer than 5 tracked, so this player must be on the court
                    g_inferred += 1
                else:
                    g_conflicts += 1  # a SUB OUT was missed; cannot tell who left
            five = len(on) == 5
            k = frozenset(on)
            if five:
                if team == T:
                    apply_event(gstats[k]["box"], play)
                elif team == opp_name:
                    apply_event(gstats[k]["box"], play, "opp_")
            if team == T and pid is not None:
                pts_made = shot_points(play)
                pbp_points[pid] += pts_made
                qi = int(period) - 1 if period in ("1", "2", "3", "4") else None
                if pts_made and qi is not None:
                    player_q[pid][qi] += pts_made
            if a is not None and h is not None:
                us, opp_s = (h, a) if home else (a, h)
                d_us, d_opp = us - last_us, opp_s - last_opp
                if five:
                    if d_us > 0:
                        gstats[k]["for"] += d_us
                        gvs[(k, opp_name)]["for"] += d_us
                    if d_opp > 0:
                        gstats[k]["against"] += d_opp
                        gvs[(k, opp_name)]["against"] += d_opp
                last_us, last_opp = us, opp_s
            if team == T and pid is not None and isinstance(play, str):
                if play.startswith("SUB OUT"):
                    on.discard(pid)
                elif play.startswith("SUB IN"):
                    on.add(pid)
        add(mark)  # clock left in the final period

        # ---- decide whether this game's lineup tracking can be trusted ----
        n_ot = len({r[0] for r in info["rows"]} - {"1", "2", "3", "4"})
        expected_box = 5 * (40 + 5 * n_ot)
        team_box_min = sum(v for (gid2, _), v in box_min.items() if gid2 == g.game_id)
        box_ok = abs(team_box_min - expected_box) <= 5
        game_diff = None
        if box_ok:
            game_pids = set(cur_sec) | {pid for (gid2, pid) in box_min if gid2 == g.game_id}
            game_diff = sum(abs(cur_sec[pid] / 60 - box_min.get((g.game_id, pid), 0)) for pid in game_pids)
            commit = game_diff <= MAX_BOX_DIFF
            reason = f"derived player minutes differ from box score by {game_diff:.1f} min"
        else:
            unreliable_box.append({"game_id": g.game_id, "box_minutes_total": float(team_box_min), "expected": expected_box})
            commit = g_conflicts == 0 and (g_unattr / g_total if g_total else 1) < 0.02
            reason = "box score minutes unusable and substitution tracking lost sync"
        if not commit:
            quality["excluded"].append({"game_id": g.game_id, "reason": reason, "scope": "lineups only"})
            continue
        for k, v in gstats.items():
            stats[k]["sec"] += v["sec"]
            stats[k]["for"] += v["for"]
            stats[k]["against"] += v["against"]
            for kk in BOX_KEYS:
                stats[k]["box"][kk] += v["box"][kk]
        for k, v in gvs.items():
            for f in ("sec", "for", "against"):
                vs_opp[k][f] += v[f]
        for pid, sec in cur_sec.items():
            derived_sec[pid] += sec
        if box_ok:
            game_sec[g.game_id] = cur_sec
            game_diffs.append((round(game_diff, 1), g.game_id))
        used_games.append(g.game_id)
        total_sec += g_total
        unattributed_sec += g_unattr
        inferred_subs += g_inferred
        conflicts += g_conflicts
        quality["games_lineup_used"] += 1

    quality["unattributed_pct"] = round(100 * unattributed_sec / total_sec, 2) if total_sec else None
    if debug is not None:
        debug["derived_min"] = {pid: round(v / 60, 1) for pid, v in derived_sec.items()}
        debug["box_min"] = {pid: v for (gid2, pid), v in box_min.items() if gid2 in set(used_games)}

    # ---- accuracy checks --------------------------------------------
    used = set(used_games)
    checked = set(game_sec)
    derived_chk = collections.Counter()
    for gid2, cs in game_sec.items():
        for pid, sec in cs.items():
            derived_chk[pid] += sec
    box_minutes = collections.Counter()
    box_points = collections.Counter()
    for (gid, pid), m in box_min.items():
        if gid in checked:
            box_minutes[pid] += m
    for r in box_t[box_t.game_id.isin(set(scored_games))].itertuples():
        box_points[r.pid] += r.pts
    diffs = []
    for pid, m in box_minutes.items():
        if m >= 40:
            diffs.append((abs(derived_chk[pid] / 60 - m), pid, derived_chk[pid] / 60, m))
    tot_box_min = sum(box_minutes.values()) or 1
    quality["inferred_missing_subs"] = inferred_subs
    quality["unresolved_sub_conflicts"] = conflicts
    quality["box_minutes_unreliable_games"] = unreliable_box
    quality["minutes_check"] = {
        "games_checked": len(checked),
        "total_abs_diff_pct": round(100 * sum(abs(derived_chk[p] / 60 - m) for p, m in box_minutes.items()) / tot_box_min, 2),
        "worst": [{"player": display_name(p), "derived": round(d, 1), "box": m} for _, p, d, m in sorted(diffs, reverse=True)[:3]],
        "worst_games": [{"game_id": gid, "sum_abs_player_min_diff": d} for d, gid in sorted(game_diffs, reverse=True)[:3]],
    }
    pts_bad = [(display_name(p), pbp_points[p], v) for p, v in box_points.items() if pbp_points[p] != v]
    quality["points_check"] = {"players_checked": len(box_points), "mismatches": len(pts_bad),
                               "examples": [{"player": a, "pbp": b, "box": c} for a, b, c in pts_bad[:3]]}

    # ---- players ----------------------------------------------------
    adv_by_pid = match_national(box_t, national_rows, quality)
    players = []
    for pid in set(box_t.pid):
        if gp.get(pid, 0) == 0:
            continue
        g_played = gp[pid]
        entry = {"name": display_name(pid), "jersey": str(jersey.get(pid, "-")).lstrip("0") or "0",
                 "ppg": round(pts.get(pid, 0) / g_played, 1), "gp": g_played,
                 "q": [round(v / g_played, 2) for v in player_q[pid]]}
        if pid in adv_by_pid:
            entry["adv"] = adv_by_pid[pid]
        players.append(entry)
    players.sort(key=lambda p: -p["ppg"])
    players = [p for p in players if p["ppg"] >= 1.5][:10]
    ppg_bad = [(p["name"], p["ppg"], p.get("adv", {}).get("nat_ppg")) for p in players
               if p.get("adv", {}).get("nat_ppg") is not None and abs(p["ppg"] - p["adv"]["nat_ppg"]) > 0.15]
    gp_bad = [(p["name"], p["gp"], p["adv"]["nat_gp"]) for p in players
              if p.get("adv", {}).get("nat_gp") is not None and abs(p["gp"] - p["adv"]["nat_gp"]) > 1]
    quality["gp_vs_national_mismatches"] = [{"player": a, "ours": b, "national": c} for a, b, c in gp_bad]
    quality["ppg_vs_national"] = {"checked": sum(1 for p in players if p.get("adv", {}).get("nat_ppg") is not None),
                                  "mismatches": [{"player": a, "ours": b, "national": c} for a, b, c in ppg_bad]}

    # ---- lineup output ----------------------------------------------
    total_min = sum(s["sec"] for s in stats.values()) / 60 or 1
    team_totals = empty_box()
    for s in stats.values():
        for kk in BOX_KEYS:
            team_totals[kk] += s["box"][kk]
    team_avg = {kk: round(v / total_min * 40, 2) for kk, v in team_totals.items()}

    lineups = []
    for lid, (k, s) in enumerate(sorted(stats.items(), key=lambda kv: -kv[1]["sec"]), 1):
        minutes = s["sec"] / 60
        if minutes < 6:
            continue
        opp_rows = []
        for (k2, opp), v in vs_opp.items():
            if k2 != k or v["sec"] / 60 < 3:
                continue
            vm = v["sec"] / 60
            opp_rows.append({"opponent": opp, "opp_key": NAME_TO_KEY.get(opp), "min": round(vm, 1),
                             "net": v["for"] - v["against"], "net_per40": round((v["for"] - v["against"]) / vm * 40, 1)})
        opp_rows.sort(key=lambda o: -o["net_per40"])
        lineups.append({
            "id": f"{key}-L{lid}",
            "players": sorted(display_name(p) for p in k),
            "player_ids": sorted(k),
            "min": round(minutes, 1), "for_pts": s["for"], "against_pts": s["against"],
            "net": s["for"] - s["against"], "net_per40": round((s["for"] - s["against"]) / minutes * 40, 1),
            "per40": {kk: round(v / minutes * 40, 2) for kk, v in s["box"].items()},
            "vs_opponents": opp_rows,
        })
    lineups.sort(key=lambda l: -l["min"])
    for i, l in enumerate(lineups, 1):
        l["id"] = f"{key}-L{i}"

    return {
        "key": key, "kind": cfg["kind"], "name": cfg["label"], "mascot": cfg["mascot"],
        "kpis": kpis, "team_quarters": team_quarters, "roster_players": players,
        "lineups": lineups, "lineup_total_minutes_considered": round(total_min, 1),
        "team_avg_per40": team_avg, "data_quality": quality,
        "_pace": pace_estimate(ds, T, games),
        "_season_minutes": {pid: {"min": float(box_t[box_t.pid == pid]["min"].sum()), "pts": float(pts.get(pid, 0)),
                                  "gp": gp.get(pid, 0), "jersey": str(jersey.get(pid, "")),
                                  "cls": adv_by_pid.get(pid, {}).get("cls", "")} for pid in set(box_t.pid)},
    }


def pace_estimate(ds, T, games):
    ids = [g.game_id for g in games]
    b = ds.box[(ds.box.team == T) & (ds.box.game_id.isin(ids))]
    poss = (b.fg_a - b.oreb + b.to + 0.44 * b.ft_a).sum()
    return round(float(poss) / max(len(ids), 1), 1)


def match_national(box_t, national_rows, quality):
    """pid -> advanced stats, only when the player maps to exactly one national row."""
    out = {}
    if national_rows is None or national_rows.empty:
        return out
    nat = []
    for r in national_rows.itertuples():
        toks = str(r.name).split()
        splits = [(nm.letters(" ".join(toks[k:])), nm.letters(" ".join(toks[:k]))) for k in range(1, len(toks))]
        nat.append((r, splits))
    claimed = collections.defaultdict(list)
    for pid in set(box_t.pid):
        parts = nm.parse(pid)
        hits = [r for r, splits in nat if any(nm.same_person(parts, s) for s in splits)]
        for r in hits:
            claimed[r.id].append(pid)
        if len(hits) == 1:
            out[pid] = hits[0]
        elif len(hits) > 1:
            quality.setdefault("advanced_ambiguous", []).append(display_name(pid))
    result = {}
    for pid, r in out.items():
        if len(claimed[r.id]) != 1:
            quality.setdefault("advanced_ambiguous", []).append(display_name(pid))
            continue

        def f(v):
            return None if v is None or (isinstance(v, float) and math.isnan(v)) else round(float(v), 3)
        result[pid] = {"cls": "" if pd.isna(r.cls) else str(r.cls), "pos": "" if pd.isna(r.pos) else str(r.pos),
                       "bpm": f(r.bpm), "adjoe": f(r.adjoe), "drtg": f(r.drtg), "usg": f(r.usg), "ts": f(r.ts),
                       "efg": f(r.efg), "porpag": f(r.porpag), "nat_ppg": f(r.ppg), "nat_gp": f(r.gp)}
    return result


# --------------------------------------------------------------------------
def main():
    national = pd.read_csv(NATIONAL_PATH) if os.path.exists(NATIONAL_PATH) else None
    datasets = {}

    def ds_for(src):
        if src not in datasets:
            folder = {"pod": POD_SHARED, "new": NEW_SHARED}.get(src, f"{POD_DIR}/opponents/{src}/{SEASON}")
            datasets[src] = Dataset(folder)
        return datasets[src]

    teams_out = {}
    for key, cfg in TEAMS.items():
        print(f"processing {key} ({cfg['kind']}) ...", flush=True)
        rows = national[national.team == cfg["national"]] if national is not None else None
        teams_out[key] = process_team(key, cfg, ds_for(cfg["src"]), rows)

    # ---- conference table (12 Big West 2026-27 members) -------------
    conf = []
    for key, t in teams_out.items():
        if t["kind"] != "conference":
            continue
        k = t["kpis"]
        w, l = (int(x) for x in k["record"].split("-"))
        conf.append({"key": key, "name": t["name"], "mascot": t["mascot"], "record": k["record"], "gp": w + l,
                     "ppg": k["ppg"], "oppg": k["oppg"], "net": round(k["ppg"] - k["oppg"], 1), "pace": t["_pace"]})
    conf.sort(key=lambda c: -c["net"])

    rosters = json.load(open(ROSTER_PATH)) if os.path.exists(ROSTER_PATH) else None
    for key, t in teams_out.items():
        if rosters and key in rosters.get("teams", {}):
            t["roster_2026_27"] = build_roster_view(t, rosters["teams"][key])
        t.pop("_pace", None)
        t.pop("_season_minutes", None)

    out = {
        "meta": {"season": SEASON, "default_team": "ucsd",
                 "conference_members": [k for k, c in TEAMS.items() if c["kind"] == "conference"],
                 "roster_season": rosters["meta"]["season"] if rosters else None,
                 "roster_fetched": rosters["meta"].get("fetched") if rosters else None},
        "teams": teams_out, "conference": conf,
    }
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, indent=1)
    print_summary(teams_out)
    if rosters:
        print("\n2026-27 roster matching:")
        for key, t in teams_out.items():
            r = t.get("roster_2026_27")
            if not r:
                continue
            sm = r["summary"]
            print(f"  {key:11s} roster={sm['roster_size']:>2} returning={sm['returning']:>2} new={sm['new']:>2} "
                  f"returning minutes={sm['returning_min_pct']:>5}% points={sm['returning_pts_pct']:>5}%")
            for n in r["match_notes"]:
                print("      NOTE:", n)


CLASS_NEXT = {"FR": "SO", "SO": "JR", "JR": "SR", "SR": "GR"}


def norm_class(c):
    c = re.sub(r"[^A-Za-z0-9]", "", str(c or "")).upper()
    c = c.replace("RFR", "FR").replace("RSO", "SO").replace("RJR", "JR").replace("RSR", "SR")
    return {"FRESHMAN": "FR", "SOPHOMORE": "SO", "JUNIOR": "JR", "SENIOR": "SR", "GRADUATE": "GR", "5TH": "GR", "6TH": "GR"}.get(c, c)


def name_splits(full):
    toks = str(full).replace(",", " ").split()
    return [(nm.letters(" ".join(toks[k:])), nm.letters(" ".join(toks[:k]))) for k in range(1, len(toks))]


def build_roster_view(team, roster_team):
    """Match 2026-27 roster players to 2025-26 players and summarise what returns."""
    prev = team["_season_minutes"]
    prev_parts = {pid: nm.parse(pid) for pid in prev}
    players26 = roster_team["players"]
    total_min = sum(v["min"] for v in prev.values()) or 1
    total_pts = sum(v["pts"] for v in prev.values()) or 1

    strict = {}
    for i, p in enumerate(players26):
        hits = {pid for pid, pp in prev_parts.items() if any(nm.same_person(sp, pp) for sp in name_splits(p["name"]))}
        if len(hits) == 1:
            strict[i] = next(iter(hits))
    # a 2025-26 player may only be claimed by one roster entry
    claims = collections.Counter(strict.values())
    matches = {i: pid for i, pid in strict.items() if claims[pid] == 1}
    notes = [f"ambiguous strict match: {players26[i]['name']}" for i, pid in strict.items() if claims[pid] > 1]
    kind = {i: "name" for i in matches}

    # looser (nickname / compound-name) matches: only when class year advanced by one
    used = set(matches.values())
    for i, p in enumerate(players26):
        if i in matches:
            continue
        hits = {pid for pid, pp in prev_parts.items() if pid not in used
                and any(nm.relaxed_same_person(sp, pp) for sp in name_splits(p["name"]))}
        if len(hits) == 1:
            pid = next(iter(hits))
            c25, c26 = norm_class(prev[pid].get("cls")), norm_class(p["cls"])
            if c25 and CLASS_NEXT.get(c25) == c26:
                matches[i], kind[i] = pid, "name variant (class year confirms)"
                used.add(pid)
            else:
                notes.append(f"possible match NOT used (class year does not confirm): {p['name']} ~ {pid}")

    out_players = []
    returning_pids = set()
    for i, p in enumerate(players26):
        entry = dict(p)
        if i in matches:
            pid = matches[i]
            v = prev[pid]
            returning_pids.add(pid)
            entry["status"] = "returning"
            entry["match"] = kind[i]
            entry["prev"] = {"gp": v["gp"], "mpg": round(v["min"] / v["gp"], 1) if v["gp"] else 0.0,
                             "ppg": round(v["pts"] / v["gp"], 1) if v["gp"] else 0.0,
                             "min_share_pct": round(100 * v["min"] / total_min, 1),
                             "pts_share_pct": round(100 * v["pts"] / total_pts, 1)}
        else:
            entry["status"] = "new"
        out_players.append(entry)

    departed = [{"name": display_name(pid), "gp": v["gp"], "mpg": round(v["min"] / v["gp"], 1) if v["gp"] else 0.0,
                 "ppg": round(v["pts"] / v["gp"], 1) if v["gp"] else 0.0,
                 "min_share_pct": round(100 * v["min"] / total_min, 1), "pts_share_pct": round(100 * v["pts"] / total_pts, 1)}
                for pid, v in sorted(prev.items(), key=lambda kv: -kv[1]["min"]) if pid not in returning_pids and v["gp"] > 0]

    lineup_min = sum(l["min"] for l in team["lineups"]) or 1
    for l in team["lineups"]:
        l["returning"] = sum(1 for pid in l["player_ids"] if pid in returning_pids)
        l["returning_names"] = sorted(display_name(pid) for pid in l["player_ids"] if pid in returning_pids)
        l["departed_names"] = sorted(display_name(pid) for pid in l["player_ids"] if pid not in returning_pids)
    dist = collections.Counter()
    for l in team["lineups"]:
        dist[l["returning"]] += l["min"]
    return {
        "source_url": roster_team["source_url"],
        "players": out_players,
        "departed": departed,
        "summary": {
            "roster_size": len(players26),
            "returning": sum(1 for p in out_players if p["status"] == "returning"),
            "new": sum(1 for p in out_players if p["status"] == "new"),
            "returning_min_pct": round(100 * sum(prev[pid]["min"] for pid in returning_pids) / total_min, 1),
            "returning_pts_pct": round(100 * sum(prev[pid]["pts"] for pid in returning_pids) / total_pts, 1),
            "lineup_min_by_returning": {str(n): round(100 * dist.get(n, 0) / lineup_min, 1) for n in range(6)},
        },
        "match_notes": notes,
    }


def print_summary(teams_out):
    print("\nteam         games used/total  flipped  excluded  unattributed%  minutes-diff%  pts-mismatch  lineups")
    for k, t in teams_out.items():
        q = t["data_quality"]
        print(f"{k:12s} {q['games_lineup_used']:>4}/{q['games_total']:<4}       {q['orientation_flipped']:>3}      {len(q['excluded']):>3}"
              f"       {q['unattributed_pct']!s:>6}        {q['minutes_check']['total_abs_diff_pct']:>6}       {q['points_check']['mismatches']:>4}      {len(t['lineups'])}")


if __name__ == "__main__":
    main()
