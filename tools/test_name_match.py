"""Run name_match against real data: unresolved PBP names, surname-only matches,
and multi-spelling clusters (to catch wrongly merged players).

Usage: python3 test_name_match.py <csv-dir> [<csv-dir> ...]
"""
import sys
import pandas as pd
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import name_match as nm


def run(folder, show_fuzzy=False):
    box = pd.read_csv(f"{folder}/csv2_boxscore_players.csv")
    pbp = pd.read_csv(f"{folder}/csv3_playbyplay.csv")
    box = box[box.player != "TEAM"]

    unresolved, tier3, tier2 = {}, {}, {}
    total = 0
    for gid, grp in pbp.groupby("game_id"):
        cands = [(r.player, nm.parse(r.player)) for r in box[box.game_id == gid].itertuples()]
        for name in {p for p in grp.player.dropna() if p != "TEAM"}:
            total += 1
            got = nm.resolve(name, cands, detail=True)
            if got is None:
                unresolved.setdefault(name, set()).add(gid)
            elif got[1] == 3:
                tier3.setdefault((name, got[0]), set()).add(gid)
            elif got[1] == 2:
                tier2.setdefault((name, got[0]), set()).add(gid)
    print(f"\n{folder}\n  pbp names checked={total} tier2(fuzzy)={len(tier2)} tier3(surname-only)={len(tier3)} unresolved={len(unresolved)}")
    for n, g in sorted(unresolved.items()):
        print(f"    UNRESOLVED {n!r} in {len(g)} game(s), e.g. {sorted(g)[0]}")
    for (p, b), g in sorted(tier3.items()):
        print(f"    SURNAME-ONLY {p!r} -> {b!r} ({len(g)} game(s))")
    if show_fuzzy:
        for (p, b), g in sorted(tier2.items()):
            print(f"    fuzzy {p!r} -> {b!r} ({len(g)})")

    for team, tb in box.groupby("team"):
        cl = nm.cluster(tb.player.unique())
        groups = {}
        for raw, canon in cl.items():
            groups.setdefault(canon, set()).add(raw)
        for canon, variants in groups.items():
            if len({nm.letters(v) for v in variants}) > 1:
                print(f"    MERGED ({team}): {sorted(variants)}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    for d in args:
        run(d, show_fuzzy="--fuzzy" in sys.argv)
