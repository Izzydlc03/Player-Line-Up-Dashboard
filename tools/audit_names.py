"""List play-by-play player names that do not appear in the same game's box score.

Usage: python3 audit_names.py <csv-dir>
"""
import re
import sys
import pandas as pd


def norm(name):
    return re.sub(r"\s+", "", str(name)).upper()


def main(folder):
    box = pd.read_csv(f"{folder}/csv2_boxscore_players.csv")
    pbp = pd.read_csv(f"{folder}/csv3_playbyplay.csv")
    box_names = {}
    for r in box.itertuples():
        if r.player != "TEAM":
            box_names.setdefault(r.game_id, set()).add(norm(r.player))
    odd_box = box[box.player.str.contains(r"\s,", na=False)]
    print(f"box names with a space before the comma (possible truncation): {len(odd_box)}")
    print(odd_box[["game_id", "team", "player"]].drop_duplicates(["team", "player"]).to_string(index=False))

    miss = {}
    for gid, grp in pbp.groupby("game_id"):
        names = {norm(p) for p in grp.player.dropna() if p != "TEAM"}
        for n in names - box_names.get(gid, set()):
            miss.setdefault(n, set()).add(gid)
    print(f"\nplay-by-play names missing from their game's box score: {len(miss)}")
    for n, gids in sorted(miss.items()):
        print(f"  {n}: {len(gids)} game(s), e.g. {sorted(gids)[0]}")


if __name__ == "__main__":
    main(sys.argv[1])
