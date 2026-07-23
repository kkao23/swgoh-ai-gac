const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "popular");
const ATTACKERS_DIR = path.join(__dirname, "attackers");
const RANKING_PATH = path.join(__dirname, "ranking.json");
const GLS_PATH = path.join(__dirname, "gls.json");

const WIN_RATE_THRESHOLD = 0.7;

// ===========================================================================
// Shared analysis (same as scoreDefenses.js + scoreAttackers.js)
// ===========================================================================

function processDefenseFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const json = JSON.parse(raw);
  const defenseId = json.data.battles[0]?.defenseLeadId;
  const battles = json.data.battles.filter(
    (b) => b.count >= 10 && b.percentage >= 0.2
  );
  return {
    defenseId,
    battles: battles.map((b) => ({
      attackLeadId: b.attackLeadId,
      attackMemberIds: b.attackMemberIds,
      percentage: b.percentage,
      avgBanners: b.avgBanners,
      count: b.count,
    })),
  };
}

// ---- defense scoring (proportional by battle share) ----

const MIN_LEAD_BATTLES = 50;
const STRONG_PER_LEAD = 0.5;    // flat penalty per unique strong counter lead
const GL_DISCOUNT = 0.5;        // GL counters contribute 50% less proportional penalty

function proportionalDefenseScore(counters, glSet) {
  // Group by attackLeadId
  const groups = {};
  for (const c of counters) {
    if (!groups[c.attackLeadId]) groups[c.attackLeadId] = [];
    groups[c.attackLeadId].push(c);
  }

  // Compute per-lead and total battles
  const leadBattles = {};
  let totalDefBattles = 0;
  for (const [lead, items] of Object.entries(groups)) {
    leadBattles[lead] = items.reduce((s, c) => s + c.count, 0);
    totalDefBattles += leadBattles[lead];
  }

  if (totalDefBattles < 500) return null;

  // Score: each qualifying lead contributes proportionally to its battle share.
  // GL counters are discounted — burning a GL is less costly for the defender.
  let score = 0;
  for (const [lead, items] of Object.entries(groups)) {
    const lb = leadBattles[lead];
    if (lb < MIN_LEAD_BATTLES) continue;

    const weightedWR = items.reduce((s, c) => s + c.percentage * c.count, 0) / lb;
    const weight = lb / totalDefBattles;
    const isGL = glSet.has(lead);

    if (weightedWR > 0.7) {
      const mult = isGL ? GL_DISCOUNT : 1;
      score += STRONG_PER_LEAD + 50 * weight * mult;
    } else if (weightedWR >= 0.5) {
      score -= 5 * weight;
    } else {
      score -= 15 * weight;
    }
  }

  return score;
}

// ---- offense scoring ----

function winRateMult(wr) {
  if (wr < 0.5) return 0;
  const t = Math.min((wr - 0.5) / 0.35, 0.45 / 0.35);
  return 1.0 + t * 2.0;
}

function offenseScore(wins, maxDefScore) {
  return wins.reduce((sum, w) => {
    const difficulty = 1 - w.defScore / maxDefScore;
    return sum + difficulty * winRateMult(w.winRate);
  }, 0);
}

// ===========================================================================
// Roster allocation
// ===========================================================================

function main() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));

  // --- Load Galactic Legends ---
  const glSet = new Set(JSON.parse(fs.readFileSync(GLS_PATH, "utf-8")));

  // --- Compute defense scores ---
  const defScores = {};
  const allCounters = {};

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const { defenseId, battles: counters } = processDefenseFile(filePath);
    if (!defenseId) continue;
    allCounters[defenseId] = counters;

    const score = proportionalDefenseScore(counters, glSet);
    if (score === null) continue;
    defScores[defenseId] = Math.round(score * 10) / 10;
  }

  const maxDefScore = Math.max(...Object.values(defScores));

  // --- Compute offense scores from attackers/ folder ---
  const attackerFiles = fs.readdirSync(ATTACKERS_DIR).filter((f) => f.endsWith(".json"));
  const attackers = {};

  for (const file of attackerFiles) {
    const raw = fs.readFileSync(path.join(ATTACKERS_DIR, file), "utf-8");
    const json = JSON.parse(raw);
    const attackLeadId = json.data.battles[0]?.attackLeadId;
    if (!attackLeadId) continue;

    const battles = json.data.battles.filter(
      (b) => b.count >= 10 && b.percentage >= 0.2
    );

    const byDef = {};
    for (const b of battles) {
      const defId = b.defenseLeadId;
      if (!byDef[defId]) byDef[defId] = [];
      byDef[defId].push(b);
    }

    const wins = [];
    for (const [defId, items] of Object.entries(byDef)) {
      const defScore = defScores[defId];
      if (defScore === undefined) continue;

      const totalBattles = items.reduce((s, b) => s + b.count, 0);
      if (totalBattles < 50) continue;

      const bestPct = Math.max(...items.map((b) => b.percentage));
      wins.push({ defense: defId, defScore, winRate: bestPct });
    }

    if (wins.length > 0) attackers[attackLeadId] = wins;
  }

  const offScores = {};
  for (const [lead, wins] of Object.entries(attackers)) {
    offScores[lead] = offenseScore(wins, maxDefScore);
  }

  const maxOffScore = Math.max(...Object.values(offScores));

  // =========================================================================
  // Popular defense counter mapping (ranking.json)
  // Uses popular/ data — how attackers perform against the META version of each defense.
  // =========================================================================

  const MIN_COUNTER_BATTLES = 200;

  const popularDefenses = JSON.parse(fs.readFileSync(RANKING_PATH, "utf-8"));
  for (const id of popularDefenses) {
    if (!allCounters[id]) {
      console.warn(`WARNING: "${id}" from ranking.json has no defense data — it won't be checked for coverage.`);
    }
  }

  // popularCounters[defId] = [{ attackerId, winRate, totalBattles }, ...]
  const popularCounters = {};
  for (const popDef of popularDefenses) {
    const counters = allCounters[popDef] || [];

    // Group by attackLeadId, aggregate all variant comps
    const byAttacker = {};
    for (const c of counters) {
      if (!byAttacker[c.attackLeadId]) byAttacker[c.attackLeadId] = [];
      byAttacker[c.attackLeadId].push(c);
    }

    popularCounters[popDef] = [];
    for (const [attackerId, items] of Object.entries(byAttacker)) {
      const totalBattles = items.reduce((s, c) => s + c.count, 0);
      if (totalBattles < MIN_COUNTER_BATTLES) continue;

      // Use the best single variant if it has enough battles; otherwise weighted average.
      // This avoids off-meta comps dragging down the win rate of the main comp.
      const bestVariant = items.reduce((best, c) => c.percentage > best.percentage ? c : best, items[0]);
      const winRate = bestVariant.count >= MIN_COUNTER_BATTLES
        ? bestVariant.percentage
        : items.reduce((s, c) => s + c.percentage * c.count, 0) / totalBattles;

      if (winRate <= WIN_RATE_THRESHOLD) continue;

      popularCounters[popDef].push({
        attackerId,
        winRate,
        totalBattles,
      });
    }

    // Sort best counter first
    popularCounters[popDef].sort((a, b) => b.winRate - a.winRate);
  }

  // =========================================================================
  // Build unified team list
  // =========================================================================

  const allTeams = new Set([
    ...Object.keys(defScores),
    ...Object.keys(offScores),
  ]);

  const teams = [];
  for (const name of allTeams) {
    const defRaw = defScores[name];
    const offRaw = offScores[name];

    const defQuality = defRaw !== undefined ? 1 - defRaw / maxDefScore : 0;
    const offQuality = offRaw !== undefined ? offRaw / maxOffScore : defQuality;

    const pref = defQuality * 3 - offQuality;

    teams.push({ name, defRaw, offRaw, defQuality, offQuality, pref });
  }

  // Sort by defense preference (descending) — top of list = should be on defense
  teams.sort((a, b) => b.pref - a.pref);

  const teamMap = new Map(teams.map((t) => [t.name, t]));

  // =========================================================================
  // Auto-adjust allocation: ensure every popular defense has a counter on offense
  // =========================================================================

  const NUM_DEFENSE_SLOTS = 15;
  const defNames = new Set(teams.slice(0, NUM_DEFENSE_SLOTS).map((t) => t.name));
  const offNames = new Set(teams.slice(NUM_DEFENSE_SLOTS).map((t) => t.name));

  function coveredPopularDefenses() {
    const uncovered = [];
    for (const popDef of popularDefenses) {
      const counters = popularCounters[popDef] || [];
      const hasCounter = counters.some((c) => offNames.has(c.attackerId));
      if (!hasCounter) uncovered.push(popDef);
    }
    return uncovered;
  }

  function countersOnDefense(popDef) {
    const counters = popularCounters[popDef] || [];
    return counters.filter((c) => defNames.has(c.attackerId));
  }

  // Swap loop: greedily move one counter per uncovered defense to offense
  let changed = true;
  let swaps = 0;
  const MAX_SWAPS = 30;

  while (changed && swaps < MAX_SWAPS) {
    changed = false;
    const uncovered = coveredPopularDefenses();
    if (uncovered.length === 0) break;

    for (const popDef of uncovered) {
      const defCounters = countersOnDefense(popDef);
      if (defCounters.length === 0) continue; // no viable counter anywhere — flagged later

      // Pick the counter with lowest pref (least wants to be on defense, easiest to give up)
      defCounters.sort((a, b) => teamMap.get(a.attackerId).pref - teamMap.get(b.attackerId).pref);
      const moveToOffense = defCounters[0].attackerId;

      // Find the best replacement from offense:
      // highest pref that is NOT the unique counter for a still-uncovered defense
      const offArray = [...offNames]
        .map((n) => teamMap.get(n))
        .sort((a, b) => b.pref - a.pref);

      let replacement = null;
      for (const cand of offArray) {
        let isUniqueForUncovered = false;
        for (const pd of popularDefenses) {
          if (!uncovered.includes(pd)) continue;

          // Count how many counters this defense has left on offense (excluding candidate)
          const pdCounters = (popularCounters[pd] || []).filter(
            (c) => offNames.has(c.attackerId) && c.attackerId !== cand.name
          );
          const allPdCountersOffense = (popularCounters[pd] || []).filter(
            (c) => offNames.has(c.attackerId)
          );
          // If candidate is the ONLY counter for this uncovered defense on offense
          if (allPdCountersOffense.length === 1 && allPdCountersOffense[0].attackerId === cand.name) {
            isUniqueForUncovered = true;
            break;
          }
        }
        if (!isUniqueForUncovered) {
          replacement = cand.name;
          break;
        }
      }

      // Fallback: if every offense option is a unique counter, just take the highest pref
      if (!replacement) {
        replacement = offArray[0].name;
      }

      // Execute swap
      defNames.delete(moveToOffense);
      defNames.add(replacement);
      offNames.delete(replacement);
      offNames.add(moveToOffense);
      changed = true;
      swaps++;
      break; // restart loop since sets were mutated
    }
  }

  // Build final sorted arrays
  const defenders = [...defNames].map((n) => teamMap.get(n));
  const offenders = [...offNames].map((n) => teamMap.get(n));

  // Sort defenders by defScore ascending (best defense first) for zone placement
  defenders.sort((a, b) => (a.defRaw ?? 9999) - (b.defRaw ?? 9999));

  const BR = defenders.slice(0, 5);   // bottom right — wall, gates BL
  const TOP = defenders.slice(5, 10); // top — most points
  const BL = defenders.slice(10, 15); // bottom left — gated, weakest

  // --- Output ---

  function printZone(label, pts, list) {
    console.log(`\n${label} (${pts} pts)`);
    console.log("  Team                  DefScore  OffScore  Preference");
    console.log("  ────                  ────────  ────────  ──────────");
    for (const t of list) {
      const ds = t.defRaw !== undefined ? String(t.defRaw) : "—";
      const os = t.offRaw !== undefined ? t.offRaw.toFixed(1) : "—";
      const pf = t.pref.toFixed(2);
      console.log(`  ${t.name.padEnd(22)} ${ds.padStart(6)}  ${os.padStart(8)}  ${pf.padStart(10)}`);
    }
  }

  console.log("=== DEFENSE PLACEMENT ===\n");
  if (swaps > 0) {
    console.log(`(Auto-adjusted: ${swaps} swap(s) to ensure meta coverage)\n`);
  }
  printZone("TOP (5 slots)", 1000, TOP);
  printZone("BOTTOM RIGHT (5 slots, gates BL)", 550, BR);
  printZone("BOTTOM LEFT (5 slots, gated)", 550, BL);

  console.log("\n=== OFFENSE (15 teams) ===");
  console.log("  Team                  DefScore  OffScore  Preference");
  console.log("  ────                  ────────  ────────  ──────────");
  const sortedOff = [...offenders].sort((a, b) => (b.offRaw ?? 0) - (a.offRaw ?? 0));
  for (const t of sortedOff) {
    const ds = t.defRaw !== undefined ? String(t.defRaw) : "—";
    const os = t.offRaw !== undefined ? t.offRaw.toFixed(1) : "—";
    const pf = t.pref.toFixed(2);
    console.log(`  ${t.name.padEnd(22)} ${ds.padStart(6)}  ${os.padStart(8)}  ${pf.padStart(10)}`);
  }

  // =========================================================================
  // Meta coverage report
  // =========================================================================

  console.log("\n=== META COVERAGE (popular defenses from ranking.json) ===");
  console.log("Matches each popular defense against your offense teams (>70% win rate).\n");

  for (const popDef of popularDefenses) {
    const counters = popularCounters[popDef] || [];

    if (counters.length === 0) {
      console.log(`  ${popDef}:  ⚠ NO RELIABLE COUNTER FOUND (no attacker >70% win rate)`);
      continue;
    }

    const offCounters = counters.filter((c) => offNames.has(c.attackerId));
    const defCounters = counters.filter((c) => defNames.has(c.attackerId));

    // Best counter that's on offense
    const bestOff = offCounters.length > 0 ? offCounters[0] : null;
    // Best counter that's on defense (would need to be freed up)
    const bestDef = defCounters.length > 0 ? defCounters[0] : null;

    function fmtCounter(c) {
      return `${c.attackerId}(${(c.winRate * 100).toFixed(0)}%/${c.totalBattles})`;
    }

    if (bestOff) {
      const extras = offCounters.slice(1).map(fmtCounter).join(", ");
      const extraStr = extras ? `  Also: ${extras}` : "";
      console.log(`  ${popDef}:  ${fmtCounter(bestOff)}${extraStr}`);
    } else if (bestDef) {
      console.log(`  ${popDef}:  ${fmtCounter(bestDef)} — ON DEFENSE (consider manual swap)`);
    } else {
      console.log(`  ${popDef}:  ⚠ NO RELIABLE COUNTER FOUND`);
    }
  }

  // Uncovered summary
  const stillUncovered = popularDefenses.filter((pd) => {
    const counters = popularCounters[pd] || [];
    return !counters.some((c) => offNames.has(c.attackerId));
  });

  if (stillUncovered.length > 0) {
    console.log(`\n⚠ ${stillUncovered.length} popular defense(s) NOT covered by your offense:`);
    for (const pd of stillUncovered) {
      const counters = popularCounters[pd] || [];
      if (counters.length > 0) {
        const all = counters.map((c) => `${c.attackerId} (${(c.winRate * 100).toFixed(0)}%/${c.totalBattles}) on defense`).join(", ");
        console.log(`   ${pd}: counters exist but all on defense — ${all}`);
      } else {
        console.log(`   ${pd}: no counter with >${(WIN_RATE_THRESHOLD * 100).toFixed(0)}% WR and ≥${MIN_COUNTER_BATTLES} battles in your roster`);
      }
    }
  }

  // =========================================================================
  // Unique assignment check (bipartite matching)
  // Each offense team can only be used once. Can all popular defenses be
  // assigned a unique counter simultaneously?
  // =========================================================================

  function maxBipartiteMatch(adj, nRight) {
    const matchR = new Array(nRight).fill(-1);
    function dfs(u, seen) {
      for (const v of adj[u]) {
        if (seen[v]) continue;
        seen[v] = true;
        if (matchR[v] === -1 || dfs(matchR[v], seen)) {
          matchR[v] = u;
          return true;
        }
      }
      return false;
    }
    let matched = 0;
    for (let u = 0; u < adj.length; u++) {
      if (dfs(u, new Array(nRight).fill(false))) matched++;
    }
    return { matchR, matched };
  }

  const offArray = [...offNames];
  const popDefsWithCounters = [];
  const adj = [];

  for (const popDef of popularDefenses) {
    const counters = popularCounters[popDef] || [];
    const offCounters = counters.filter((c) => offNames.has(c.attackerId));
    if (offCounters.length > 0) {
      adj.push(offCounters.map((c) => offArray.indexOf(c.attackerId)).filter((i) => i >= 0));
      popDefsWithCounters.push(popDef);
    }
  }

  const { matchR, matched } = maxBipartiteMatch(adj, offArray.length);

  console.log(`\n=== UNIQUE ASSIGNMENT ===`);
  console.log(`Each offense team can only be used once.`);
  console.log(`Matched ${matched} / ${popularDefenses.length} popular defenses to distinct offense teams:\n`);

  const assignedDefs = new Set();
  for (let v = 0; v < matchR.length; v++) {
    if (matchR[v] !== -1) {
      const def = popDefsWithCounters[matchR[v]];
      const atk = offArray[v];
      const c = popularCounters[def].find((x) => x.attackerId === atk);
      console.log(`  ${def.padEnd(22)} → ${atk.padEnd(24)} (${(c.winRate * 100).toFixed(0)}%/${c.totalBattles})`);
      assignedDefs.add(def);
    }
  }

  const unassigned = popularDefenses.filter((d) => !assignedDefs.has(d));
  if (unassigned.length > 0) {
    console.log(`\n  ⚠ ${unassigned.length} defense(s) could not be assigned unique counters:`);
    for (const pd of unassigned) {
      const counters = (popularCounters[pd] || []).filter((c) => offNames.has(c.attackerId));
      if (counters.length === 0) {
        console.log(`    ${pd}: no qualifying counter on offense`);
      } else {
        const names = counters.map((c) => c.attackerId).join(", ");
        console.log(`    ${pd}: counters (${names}) already taken by other defenses`);
      }
    }
  }
}

main();
