"""Scrape 2026-27 women's basketball rosters for the dashboard's 18 D1 teams.

Usage: python3 build_rosters.py [--raw-dir DIR] [--out data/rosters_2026-27.json] [--refresh]

Two SIDEARM page templates exist:
  v1  server-rendered <li class="sidearm-roster-player"> markup
  v2  a serialised (devalue) __NUXT_DATA__ payload holding the roster objects
Each roster is validated before it is written (right season, sane size, unique
jerseys/names); problems are reported and the team is flagged, never patched up.
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import date

import requests
from bs4 import BeautifulSoup

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
SEASON = "2026-27"

SITES = {
    "ucsd": "ucsdtritons.com", "calbaptist": "cbulancers.com", "csulb": "longbeachstate.com",
    "csun": "gomatadors.com", "ucirvine": "ucirvinesports.com", "utahvalley": "gouvu.com",
    "ucr": "gohighlanders.com", "ucsb": "ucsbgauchos.com", "calpoly": "gopoly.com",
    "sacstate": "hornetsports.com", "csuf": "fullertontitans.com", "csub": "gorunners.com",
    "lmu": "lmulions.com", "nau": "nauathletics.com", "portlandst": "goviks.com",
    "usd": "usdtoreros.com", "usf": "usfdons.com", "washington": "gohuskies.com",
}


def fetch(key, raw_dir, refresh):
    path = os.path.join(raw_dir, f"{key}.html")
    url = f"https://{SITES[key]}/sports/womens-basketball/roster/{SEASON}"
    if refresh or not os.path.exists(path):
        r = requests.get(url, headers={"User-Agent": UA}, timeout=40)
        r.raise_for_status()
        os.makedirs(raw_dir, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(r.text)
        time.sleep(1.5)
    with open(path, encoding="utf-8") as f:
        return f.read(), url


# ---------------------------------------------------------------- v1 markup
def parse_v1(html):
    soup = BeautifulSoup(html, "html.parser")
    players = []
    for li in soup.select("li.sidearm-roster-player"):
        a = li.select_one("a[aria-label]")
        name = re.sub(r"\s*-\s*View Profile\s*$", "", a["aria-label"]).strip() if a else ""

        def txt(sel):
            el = li.select_one(sel)
            return el.get_text(" ", strip=True) if el else ""
        pos_els = li.select(".sidearm-roster-player-position-long-short")
        players.append({
            "name": name,
            "jersey": txt(".sidearm-roster-player-jersey-number"),
            "pos": pos_els[-1].get_text(strip=True) if pos_els else "",
            "height": txt(".sidearm-roster-player-height"),
            "cls": txt(".sidearm-roster-player-academic-year"),
            "hometown": txt(".sidearm-roster-player-hometown"),
            "from": txt(".sidearm-roster-player-highschool") or txt(".sidearm-roster-player-previous-school"),
        })
    heading = soup.find(string=re.compile(r"\d{4}-\d{2}"))
    return players, (soup.title.get_text(" ", strip=True) if soup.title else "")


# ---------------------------------------------------------------- v2 payload
def unflatten(arr):
    """Decode a devalue-serialised array (as used in __NUXT_DATA__)."""
    sys.setrecursionlimit(10000)
    cache = {}

    def hydrate(i):
        if not isinstance(i, int) or i < 0:
            return None
        if i in cache:
            return cache[i]
        v = arr[i]
        if isinstance(v, list):
            if v and isinstance(v[0], str):
                tag = v[0]
                res = hydrate(v[1]) if tag in ("Reactive", "ShallowReactive", "Ref", "ShallowRef", "readonly") and len(v) > 1 else v[1:] if tag == "Date" else [hydrate(x) for x in v[1:]]
            else:
                res = [hydrate(x) for x in v]
        elif isinstance(v, dict):
            res = {k: hydrate(x) for k, x in v.items()}
        else:
            res = v
        cache[i] = res
        return res

    return hydrate(0)


def find_player_dicts(node, out):
    if isinstance(node, dict):
        if "firstName" in node and "lastName" in node and "jerseyNumber" in node:
            out.append(node)
        for v in node.values():
            find_player_dicts(v, out)
    elif isinstance(node, list):
        for v in node:
            find_player_dicts(v, out)


def parse_v2(html):
    m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        m = re.search(r'<script[^>]*type="application/json"[^>]*>(.*?)</script>', html, re.S)
    arr = json.loads(m.group(1))
    root = unflatten(arr)
    found = []
    find_player_dicts(root, found)
    seen, players = set(), []
    for d in found:
        pid = d.get("playerId") or (d.get("firstName"), d.get("lastName"))
        if pid in seen:
            continue
        seen.add(pid)
        hf, hi = d.get("heightFeet"), d.get("heightInches")
        height = f"{hf}'{hi}\"" if hf not in (None, "", 0, "0") and hi not in (None, "") else ""
        players.append({
            "name": f"{d.get('firstName', '').strip()} {d.get('lastName', '').strip()}".strip(),
            "jersey": str(d.get("jerseyNumber") or "").strip(),
            "pos": (d.get("positionShort") or "").strip(),
            "height": height,
            "cls": (d.get("academicYearShort") or "").strip(),
            "hometown": (d.get("hometown") or "").strip(),
            "from": (d.get("previousSchool") or d.get("highSchool") or "").strip(),
        })
    flat = json.dumps(arr)
    title = re.search(r"<title>(.*?)</title>", html, re.S)
    season_ok = SEASON in flat
    return players, (re.sub(r"\s+", " ", title.group(1)).strip() if title else ""), season_ok


# ---------------------------------------------------------------- validation
def validate(key, players, title, canonical_ok, season_ok):
    problems = []
    if not canonical_ok:
        problems.append("canonical URL is not the 2026-27 roster page")
    if not season_ok:
        problems.append("2026-27 not found in page title/payload")
    if not 8 <= len(players) <= 20:
        problems.append(f"unexpected roster size {len(players)}")
    names = [p["name"] for p in players]
    if len(set(names)) != len(names):
        problems.append("duplicate player names")
    jerseys = [p["jersey"] for p in players if p["jersey"]]
    if len(set(jerseys)) != len(jerseys):
        problems.append("duplicate jersey numbers")
    missing = [p["name"] for p in players if not p["name"]]
    if missing:
        problems.append("player with empty name")
    return problems


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--raw-dir", default=os.path.join(here, "roster_raw_2026-27"))
    ap.add_argument("--out", default="data/rosters_2026-27.json")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--only")
    args = ap.parse_args()

    teams, issues = {}, {}
    for key in SITES:
        if args.only and key != args.only:
            continue
        html, url = fetch(key, args.raw_dir, args.refresh)
        canon = re.search(r'<link[^>]*rel="canonical"[^>]*href="([^"]+)"', html) or re.search(r'<link[^>]*href="([^"]+)"[^>]*rel="canonical"', html)
        canonical_ok = bool(canon and canon.group(1).rstrip("/").endswith(f"/roster/{SEASON}"))
        if "sidearm-roster-player" in html and "__NUXT_DATA__" not in html:
            players, title = parse_v1(html)
            season_ok = SEASON in title or canonical_ok
            template = "v1"
        else:
            players, title, season_ok = parse_v2(html)
            template = "v2"
        for pl in players:
            for k in pl:
                pl[k] = re.sub(r"\s+", " ", str(pl[k])).strip()
        problems = validate(key, players, title, canonical_ok, season_ok)
        teams[key] = {"source_url": url, "template": template, "page_title": title, "players": players}
        if problems:
            issues[key] = problems
        print(f"{key:11s} {template} players={len(players):>2} jerseys_blank={sum(1 for p in players if not p['jersey'])} "
              f"{'OK' if not problems else 'PROBLEMS: ' + '; '.join(problems)}")

    out = {"meta": {"season": SEASON, "fetched": date.today().isoformat(),
                    "source": "official team athletics websites (SIDEARM roster pages)"},
           "issues": issues, "teams": teams}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
