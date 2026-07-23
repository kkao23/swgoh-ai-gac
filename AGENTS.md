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
| `ranking.json` | Top 10 most popular defensive leads in current meta (e.g. `["GLREY", "JABBATHEHUTT", ...]`). Used by `scoreRoster.js` for meta coverage checking. |
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

Ranks defensive teams by how hard they are to counter.

- Groups counters by attacking lead, splits large variants (>500 battles, ≥2 per lead)
- Classifies: **strong** (>70% WR, ≥200 battles), **uncomfortable** (50-70%, ≥100), **weak** (<50%, ≥50)
- If a lead has any strong comp, the entire lead is treated as strong (duplicate-comp rule)
- Score = S×50 − U×5 − W×15 (lower = better defense)
- Excludes defenses with <500 total battles

### `scoreAttackers.js` — Attacker ranking

Ranks attacking leads by how many hard defenses they can beat.

- Loads defense scores from `popular/`, attacker data from `attackers/`
- Takes best win rate across all comps for each attacker→defense matchup
- Score = Σ(difficulty × multiplier), where difficulty = 1 − defScore/maxDefScore
- Multiplier: 1.0× at 50% WR, 3.0× at 85% WR, 0 below 50%

### `scoreRoster.js` — Roster allocation (main script)

Allocates teams to defense/offense, places defenders into zones, and verifies meta coverage.

**Allocation:**
- Computes `defQuality` and `offQuality` (normalized 0-1) for every team
- Preference = defQuality × 3 − offQuality (defensive value weighted 3×)
- Top 15 → defense, rest → offense
- Defenders sorted by defScore: best → BR wall, next → Top, weakest → BL

**Meta coverage (ranking.json):**
- Uses `popular/` data (NOT `attackers/`) — weighted-average win rate across all variants
- Only counts counters with ≥200 total battles and >70% WR (configurable: `MIN_COUNTER_BATTLES`, `WIN_RATE_THRESHOLD`)
- **Auto-adjust:** if a popular defense has zero counters on offense, swaps the least-defense-preferring counter from defense to offense until all are covered
- **Bipartite matching:** verifies all 10 popular defenses can be assigned unique offense teams simultaneously (DFS augmenting path)

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

- Counter quality data should always come from `popular/` (meta defenses), not `attackers/` (includes weak variants). The `attackers/` data is useful for attacker ranking but unreliable for counter quality.
- `scoreRoster.js` is the active/main script. `scoreRoster_5v5.js` is a variant for 5v5 format and may lag behind in features.
- `scoreRoster.js` and `scoreDefenses.js`/`scoreAttackers.js` duplicate analysis functions rather than sharing a module — keep them self-contained.
- Scores and thresholds are tuned for the current meta. Adjust `WIN_RATE_THRESHOLD`, `MIN_COUNTER_BATTLES`, and scoring weights if the meta shifts significantly.
