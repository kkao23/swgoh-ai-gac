# swgoh-ai-gac

AI-powered Grand Arena Championship roster optimization for SWGOH.

## Data

Two data sources, updated each season:

| Folder | Contains |
|---|---|
| `popular/` | Per-defense files — "how did every attacker perform against this defensive team?" (meta comps — source of truth for counter quality) |
| `attackers/` | Per-attacker files — "how did this attacking lead perform against every defense?" (includes weaker defense variants) |

## Config

| File | Purpose |
|---|---|
| `ranking.json` | Top 10 most popular defensive leads in current meta — checked for coverage |
| `gls.json` | Galactic Legend character IDs — GL counters are discounted (requiring a GL = stronger defense) |

## Scripts

### `scoreDefenses.js`

Ranks defensive teams by how hard they are to counter. Uses the original classification-based scoring.

```
node scoreDefenses.js
```

### `scoreAttackers.js`

Ranks attacking leads by how many hard defenses they can beat reliably.

```
node scoreAttackers.js
```

### `scoreRoster.js` (main script)

Allocates 30 teams into 15 defense + 15 offense, places defenders into zones, and verifies meta coverage.

**Zone structure (3v3 GAC):**
- **Top** (5 slots, 1000 pts) — second-best defenders
- **Bottom Right** (5 slots, 550 pts) — **best defenders** (gates Bottom Left)
- **Bottom Left** (5 slots, 550 pts) — weakest defenders, unreachable until BR is cleared

**Defense scoring** (proportional by battle share):
- Each counter lead weighted by its share of total defense battles
- `STRONG_PER_LEAD = 0.5` flat penalty per unique strong counter — more counter options = worse defense
- `GL_DISCOUNT = 0.5` — Galactic Legend counters contribute 50% less penalty
- Score = Σ(strong leads: 0.5 + 50 × weight × GL_discount) − Σ(uncomfortable: 5 × weight) − Σ(weak: 15 × weight)
- Lower = better defense

**Meta coverage (ranking.json):**
- Checks all 10 popular defenses against your offense pool (>70% WR, ≥200 battles)
- Uses best-variant win rate (not weighted average) to avoid off-meta comps diluting main comp stats
- Auto-adjusts allocation to ensure every popular defense has at least one counter on offense
- Bipartite matching verifies all 10 can be assigned unique offense teams simultaneously

```
node scoreRoster.js
```

### `scoreRoster_5v5.js`

5v5 variant (11 defense slots, 4/4/3 zone split). Original scoring, no meta coverage.

```
node scoreRoster_5v5.js
```

### `solveGAC.js`

Backtracking CSP solver — assigns specific attackers to opponent defenses. Three strategies: balanced, top-priority, punt-hardest.

```
node solveGAC.js
```

## Quick start

```bash
# Update data each season, then:
node scoreDefenses.js   # Which teams are hardest to beat?
node scoreAttackers.js  # Which teams beat the most defenses?
node scoreRoster.js     # Optimal 15/15 split + zone placement + meta coverage
```
