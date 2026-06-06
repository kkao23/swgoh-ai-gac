# swgoh-ai-gac

AI-powered Grand Arena Championship roster optimization for SWGOH.

## Data

Two data sources, updated each season:

| Folder | Contains |
|---|---|
| `popular/` | Per-defense files — "how did every attacker perform against this defensive team?" |
| `attackers/` | Per-attacker files — "how did this attacking lead perform against every defense?" |

## Scripts

### `scoreDefenses.js`

Ranks defensive teams by how hard they are to counter.

**Algorithm:**
- Groups counters by attacking lead, splits large compositions (>500 battles, ≥2 per lead) into separate entries
- Classifies each entry: **strong** (>70% win rate, ≥200 battles), **uncomfortable** (50-70%, ≥100), **weak** (<50%, ≥50)
- **Duplicate-comp rule**: if a lead has any strong comp, the entire lead is strong
- **Score** = S×50 − U×5 − W×15 (lower = better defense)
- Defenses with <500 total battles are excluded

```
node scoreDefenses.js
```

### `scoreAttackers.js`

Ranks attacking leads by how many hard defenses they can beat reliably.

**Algorithm:**
- Loads defense scores from `popular/`, attacker performance from `attackers/`
- For each attacker, groups by defense faced and takes the best win rate across all comps
- **Score** = Σ difficulty × multiplier, where difficulty = 1 − defScore/maxDefScore
- Multiplier: 1.0× at 50% win rate, 3.0× at 85%, capped at 95%. Below 50% = 0.

```
node scoreAttackers.js
```

### `scoreRoster.js`

Allocates 30 teams into 15 defense + 15 offense, and places defenders into zones.

**Zone structure (3v3 GAC):**
- **Top** (5 slots, 1000 pts) — second-best defenders
- **Bottom Right** (5 slots, 550 pts) — **best defenders** (gates Bottom Left)
- **Bottom Left** (5 slots, 550 pts) — weakest defenders, unreachable until BR is cleared

**Algorithm:**
- Computes `defQuality` and `offQuality` (normalized 0-1) for every team
- **Rank** = defQuality × 3 − offQuality (being a great defender counts 3× more)
- Top 15 by rank → defense, rest → offense
- Defenders sorted by defScore: best → BR wall, next → Top, weakest → BL
- Teams with no defense data default to offense

```
node scoreRoster.js
```

## Quick start

```bash
# Update data each season, then:
node scoreDefenses.js   # Which teams are hardest to beat?
node scoreAttackers.js  # Which teams beat the most defenses?
node scoreRoster.js     # Optimal 15/15 split + zone placement
```