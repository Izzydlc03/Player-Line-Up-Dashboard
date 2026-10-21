"""Strict player-name matching between play-by-play and box score names.

Play-by-play names ("FALCONHERNANDEZ,DAN") and box score names ("Falcon
Hernandez, Daniela") differ by case, accents, hyphens, apostrophes, spacing,
truncation (play-by-play cuts names at ~20 characters), compound surnames
("KOUBEK" vs "Shum-Koubek") and nicknames ("Maddie" vs "Madison"). Names are
compared as letters-only components and a play-by-play name is only matched
when exactly ONE box score candidate fits at a given strictness tier;
ambiguous or unmatched names return None (never a guess).
"""
import re
import unicodedata


def letters(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Z]", "", s.upper())


def parse(raw):
    """'Last, First' / 'LAST,FIRST' -> (last, first) as letters-only strings.
    No comma -> the whole string is treated as the last-name part."""
    raw = str(raw)
    if "," in raw:
        last, first = raw.split(",", 1)
        return letters(last), letters(first)
    return letters(raw), ""


def _prefix(a, b, min_len):
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return len(short) >= min_len and long_.startswith(short)


def _suffix(a, b, min_len):
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return len(short) >= min_len and long_.endswith(short)


def _last_rel(pl, bl):
    if pl == bl:
        return "eq"
    if _prefix(pl, bl, 3):
        return "prefix"
    if _suffix(pl, bl, 4):
        return "suffix"
    return None


def _first_rel(pf, bf, last_rel):
    if pf == bf:
        return "eq"
    if _prefix(pf, bf, 1 if last_rel == "eq" else 2):
        return "prefix"
    if len(pf) >= 3 and len(bf) >= 3 and pf[:3] == bf[:3]:
        return "nick"
    return None


def tier(pbp_parts, box_parts):
    """Return 1 (exact), 2 (compatible), 3 (surname-only) or 0 (no match)."""
    pl, pf = pbp_parts
    bl, bf = box_parts
    if not pl or not bl:
        return 0
    if pbp_parts == box_parts:
        return 1
    lr = _last_rel(pl, bl)
    if lr is None:
        # Play-by-play name cut off inside a compound surname, no first name
        if pf == "" and len(pl) >= 7 and (bl + bf).startswith(pl):
            return 2
        return 0
    if pf == "":
        return 2 if len(pl) >= 7 and lr in ("eq", "prefix") else 0
    if bf and _first_rel(pf, bf, lr):
        return 2
    if lr == "eq" and len(pl) >= 5:
        return 3
    return 0


def resolve(pbp_name, candidates, detail=False):
    """candidates: list of (key, (last, first)). Returns the matching key (or
    (key, tier) with detail=True), or None. The best tier that yields exactly
    one distinct key wins; a tier with several keys is ambiguous -> None."""
    p = parse(pbp_name)
    by_tier = {1: set(), 2: set(), 3: set()}
    for key, parts in candidates:
        t = tier(p, parts)
        if t:
            by_tier[t].add(key)
    for t in (1, 2, 3):
        if by_tier[t]:
            if len(by_tier[t]) == 1:
                key = next(iter(by_tier[t]))
                return (key, t) if detail else key
            return None
    return None


def same_person(a_parts, b_parts):
    """Strict test for clustering two box-score spellings of one player
    (no nickname or surname-only matching, so teammates are never merged)."""
    al, af = a_parts
    bl, bf = b_parts
    if a_parts == b_parts:
        return True
    if not af or not bf:
        return False
    last_ok = al == bl or _prefix(al, bl, 4) or _suffix(al, bl, 4)
    first_ok = af == bf or _prefix(af, bf, 3)
    return last_ok and first_ok


def relaxed_same_person(a_parts, b_parts):
    """Looser test used ONLY for spellings that never share a game roster:
    same surname (equal / prefix / suffix) and first names equal, prefix or
    sharing their first three letters (Maddie / Madison)."""
    al, af = a_parts
    bl, bf = b_parts
    if not af or not bf:
        return False
    last_ok = al == bl or _prefix(al, bl, 4) or _suffix(al, bl, 4)
    first_ok = af == bf or _prefix(af, bf, 3) or (len(af) >= 3 and len(bf) >= 3 and af[:3] == bf[:3])
    return last_ok and first_ok


def cluster(names, together=None):
    """Group spellings of the same player. names: iterable of raw box names.
    together: optional set of frozenset({a, b}) pairs that appeared in the same
    game roster (so they are different people and are never merged).
    Returns {raw_name: canonical_raw_name}; the canonical spelling is the
    longest (most detailed) one in the group."""
    together = together or set()

    def richness(n):
        # most letters first, then keep accents, then proper capitalisation
        return (-len(letters(n)), -sum(1 for c in n if ord(c) > 127), -sum(1 for c in n if c.isupper()), n)

    names = sorted(set(names), key=richness)
    parent = {n: n for n in names}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def group(x):
        r = find(x)
        return [n for n in names if find(n) == r]

    parts = {n: parse(n) for n in names}
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            if find(a) == find(b):
                continue
            strict = same_person(parts[a], parts[b])
            if not strict and not relaxed_same_person(parts[a], parts[b]):
                continue
            # never merge groups that contain two names listed in the same game
            if any(frozenset((x, y)) in together for x in group(a) for y in group(b)):
                continue
            parent[find(b)] = find(a)
    return {n: find(n) for n in names}
