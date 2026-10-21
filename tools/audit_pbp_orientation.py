"""Audit play-by-play score orientation against csv1 final scores.

Usage: python3 audit_pbp_orientation.py <csv-dir> [<csv-dir> ...]

For each game, compares the last (away, home) score in csv3 with csv1's
(away_score, home_score). Reports games where csv3 matches csv1 as-is
("ok"), matches only when the columns are swapped ("swapped"), matches
neither ("mismatch"), or has no scores at all ("no_pbp").
"""
import sys
import pandas as pd


def first_int(v):
    return int(float(str(v).split()[0]))


def audit(folder):
    idx = pd.read_csv(f"{folder}/csv1_game_index.csv")
    pbp = pd.read_csv(f"{folder}/csv3_playbyplay.csv")
    counts = {"ok": 0, "swapped": 0, "mismatch": 0, "no_pbp": 0}
    detail = {"swapped": [], "mismatch": [], "no_pbp": []}
    scored = pbp.dropna(subset=["away_score", "home_score"])
    last = scored.groupby("game_id", sort=False).tail(1).set_index("game_id")
    for _, g in idx.iterrows():
        if g.game_id not in last.index:
            counts["no_pbp"] += 1
            detail["no_pbp"].append(g.game_id)
            continue
        r = last.loc[g.game_id]
        pa, ph = first_int(r.away_score), first_int(r.home_score)
        if (pa, ph) == (g.away_score, g.home_score):
            counts["ok"] += 1
        elif (ph, pa) == (g.away_score, g.home_score):
            counts["swapped"] += 1
            detail["swapped"].append(g.game_id)
        else:
            counts["mismatch"] += 1
            detail["mismatch"].append(f"{g.game_id} pbp=({pa},{ph}) csv1=({g.away_score},{g.home_score})")
    print(f"\n{folder}: {len(idx)} games -> {counts}")
    for k in ("swapped", "mismatch", "no_pbp"):
        for d in detail[k][:12]:
            print(f"  {k}: {d}")
        if len(detail[k]) > 12:
            print(f"  ... and {len(detail[k]) - 12} more {k}")


if __name__ == "__main__":
    for d in sys.argv[1:]:
        audit(d)
