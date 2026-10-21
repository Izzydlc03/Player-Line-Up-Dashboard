"""Cross-check scraped 2026-27 rosters against the 2025-26 national player file.

Returners should advance one class year (FR->SO->JR->SR). If a page were
serving the previous season's roster, most players would keep the same class.

Usage: python3 tools/check_rosters.py
"""
import collections
import json
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import name_match as nm  # noqa: E402
import build_lineup_data as B  # noqa: E402

NEXT = {"FR": "SO", "SO": "JR", "JR": "SR", "SR": "GR"}


def norm_cls(c):
    c = (c or "").upper().replace(".", "").strip()
    m = {"FRESHMAN": "FR", "SOPHOMORE": "SO", "JUNIOR": "JR", "SENIOR": "SR", "GRADUATE": "GR", "GR": "GR", "RFR": "FR", "RSO": "SO", "RJR": "JR", "RSR": "SR"}
    return m.get(c, c)


def candidate_parts(full_name):
    toks = full_name.replace(",", " ").split()
    return [(nm.letters(" ".join(toks[k:])), nm.letters(" ".join(toks[:k]))) for k in range(1, len(toks))]


def main():
    rosters = json.load(open(os.path.join(B.HERE, "data", "rosters_2026-27.json")))
    nat = pd.read_csv(B.NATIONAL_PATH)
    for key, cfg in B.TEAMS.items():
        rows = nat[nat.team == cfg["national"]]
        prev = [(r.name, norm_cls(r.cls), candidate_parts(r.name)) for r in rows.itertuples()]
        cur = rosters["teams"][key]["players"]
        matched, progressed, same, other = 0, 0, 0, 0
        for p in cur:
            parts = candidate_parts(p["name"])
            hits = [(n, c) for n, c, pp in prev if any(nm.same_person(a, b) for a in parts for b in pp)]
            if len(hits) == 1:
                matched += 1
                c26, c25 = norm_cls(p["cls"]), hits[0][1]
                if c26 == NEXT.get(c25):
                    progressed += 1
                elif c26 == c25:
                    same += 1
                else:
                    other += 1
        print(f"{key:11s} 2026-27 players={len(cur):>2} | returners matched={matched:>2} of 2025-26 file ({len(prev)} players) "
              f"| class advanced={progressed} same={same} other={other}")


if __name__ == "__main__":
    main()
