# AGENTS.md

SWGOH Grand Arena Championship roster optimizer. Given battle data from swgoh.gg, determines optimal 3v3 defense/offense splits, zone placement, and attacker assignments.

## Data directories

| Directory | Contains |
|---|---|
| `popular/` | Per-defense files — "how every attacker performed against THIS defensive lead" (meta comps). **Source of truth for counter quality.** |
| `attackers/` | Per-attacker files — "how this attacking lead performed against every defense" (includes weaker defense variants — noisy). |
| `defenses/` | Opponent's actual defensive teams organized by zone: `defenses/top/` and `defenses/bottom/`. |

All JSON files follow the swgoh.gg battle stats schema: `data.battles[]` with `attackLeadId`, `defenseLeadId`, `percentage` (attacker win rate), `count`, `avgBanners`, and member arrays.

## Key config files

| File | Purpose |
|---|---|
| `ranking.json` | Top 10 most popular defensive leads in current meta. Used by `scoreRoster.js` for meta coverage checking. IDs must match `defenseLeadId` values in `popular/` data exactly. |
| `gls.json` | List of Galactic Legend character IDs. GL counters are discounted in defense scoring — requiring a GL to beat a defense is a defensive strength. |
| `unavailableTeams.json` | `defensiveTeams` (leads already on defense), `usedTeams` (leads already used), `usedUnits` (individual units already committed). Used by `solveGAC.js` to exclude unavailable counters. |
| `characterIds.json` | Reference list of all SWGOH character IDs. |

## GAC zone structure (3v3)

```
Top (5 slots, 1000 pts)        — 200 pts/slot
Bottom Right (5 slots, 550 pts) — 110 pts/slot, GATES Bottom Left
Bottom Left (5 slots, 550 pts)  — 110 pts/slot, only reachable after BR is cleared
```

Strategy: **Gatekeeper wall** — put your 5 best defenders in BR. A BR hold denies 1,100 points (BL is unreachable). Next 5 in Top, weakest 5 in BL.

## Scripts

### `scoreDefenses.js` — Defense ranking

Ranks defensive teams by how hard they are to counter. **Note: uses the old classification-based scoring (S×50 − U×5 − W×15). May not reflect the proportional + GL-discount system used by `scoreRoster.js`.**

### `scoreAttackers.js` — Attacker ranking

Ranks attacking leads by how many hard defenses they can beat. Uses defense scores from `scoreDefenses.js`.

### `scoreRoster.js` — Roster allocation (main script)

Allocates teams to defense/offense, places defenders into zones, and verifies meta coverage.

**Allocation:**
- Computes `defQuality` and `offQuality` (normalized 0-1) for every team
- Preference = defQuality × 3 − offQuality (defensive value weighted 3×)
- Top 15 → defense, rest → offense
- Defenders sorted by defScore: best → BR wall, next → Top, weakest → BL

**Defense scoring** (`proportionalDefenseScore`, configurable at top of file):
- `MIN_LEAD_BATTLES = 50` — minimum battles for a counter lead to qualify
- `STRONG_PER_LEAD = 0.5` — flat penalty per unique strong counter lead. More counter options = worse defense.
- `GL_DISCOUNT = 0.5` — GL counters contribute 50% less proportional penalty. Requiring a GL to beat a team is a defensive strength.
- Reads `gls.json` to identify GL character IDs.
- Score formula: for each qualifying lead (>50 battles), weighted by its share of total defense battles:
  - WR > 70%: `score += STRONG_PER_LEAD + 50 × weight × (isGL ? GL_DISCOUNT : 1)`
  - WR 50-70%: `score -= 5 × weight`
  - WR < 50%: `score -= 15 × weight`
- Defenses with <500 total battles are excluded.
- Lower score = better defense.

**Meta coverage (`ranking.json`):**
- Uses `popular/` data (NOT `attackers/`) for counter quality
- Best-variant win rate: if a single variant has ≥200 battles, use its win rate directly; otherwise use weighted average across all variants. Prevents off-meta comps from dragging down main-comp win rates.
- Minimum thresholds: ≥200 total battles, >70% WR (configurable: `MIN_COUNTER_BATTLES`, `WIN_RATE_THRESHOLD`)
- **Auto-adjust:** if a popular defense has zero counters on offense, swaps the least-defense-preferring counter from defense to offense until all are covered
- **Bipartite matching:** verifies all 10 popular defenses can be assigned unique offense teams simultaneously (DFS augmenting path). Reports which defenses are left unassigned if coverage is incomplete.

### `scoreRoster_5v5.js` — 5v5 roster allocation

Same as `scoreRoster.js` but for 5v5 GAC (11 defense slots, 4/4/3 zone split). Does not include the ranking.json meta coverage features.

### `solveGAC.js` — Counter assignment solver

Given specific opponent defenses in `defenses/`, finds optimal attacker assignments using backtracking CSP.

- Reads `unavailableTeams.json` to exclude leads/units already committed
- MRV ordering (fewest counters first)
- Unit-level conflict tracking (lead + members can't be reused)
- Three strategies: balanced, top-priority, top+4-of-5-bottom (punts hardest)
- Falls back to greedy partial assignment if full solve impossible

### `analyzeCounters.js` — Counter analysis (JSON output)

Outputs JSON of all available counters for opponent defenses, with categories (very safe/safe/risky/very risky/coin flip/long shot). Respects `unavailableTeams.json` exclusions.

### `analyzeDefenses.js` — Defense analysis (human-readable)

Lists strong/uncomfortable/weak counters for each defense in `popular/`, with members, win rates, banners, and battle counts.

## Data flow

```
swgoh.gg API → popular/ + attackers/
                    ↓
              scoreDefenses.js → defense strength rankings
              scoreAttackers.js → attacker strength rankings
                    ↓
              scoreRoster.js → defense/offense split + zone placement + meta coverage
                    ↓
              solveGAC.js → specific attacker assignments vs opponent defenses
```

## When modifying

- Counter quality data should always come from `popular/` (meta defenses), not `attackers/` (includes weak variants).
- `scoreRoster.js` is the active/main script. `scoreRoster_5v5.js` is a variant for 5v5 format and may lag behind in features.
- `scoreDefenses.js` and `scoreAttackers.js` use the old classification-based scoring and are not kept in sync with `scoreRoster.js`'s proportional system.
- Thresholds are tuned for the current meta. Adjust `WIN_RATE_THRESHOLD`, `MIN_COUNTER_BATTLES`, `MIN_LEAD_BATTLES`, `STRONG_PER_LEAD`, and `GL_DISCOUNT` if the meta shifts.
- `ranking.json` and `gls.json` IDs must match the `defenseLeadId`/`attackLeadId` values in the data files exactly — there is no fuzzy matching.
