const fs = require("fs");
const path = require("path");

const DEFENSES_DIR = path.join(__dirname, "defenses");

// ---------------------------------------------------------------------------
// Categorize & counter-loading (same logic as analyzeCounters.js)
// ---------------------------------------------------------------------------

function categorize(percentage) {
  if (percentage > 0.9) return "very safe";
  if (percentage >= 0.8) return "safe";
  if (percentage >= 0.7) return "risky";
  if (percentage >= 0.6) return "very risky";
  if (percentage >= 0.45) return "coin flip";
  return "long shot";
}

function processDefenseFile(filePath, excludedLeads, usedUnits) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const json = JSON.parse(raw);
  const battles = json.data.battles.filter(
    (b) => b.count >= 10 && b.percentage >= 0.2
  );

  const counters = [];
  for (const battle of battles) {
    if (usedUnits && battle.attackMemberIds.some((id) => usedUnits.has(id))) {
      continue;
    }
    counters.push({
      attackLeadId: battle.attackLeadId,
      attackMemberIds: battle.attackMemberIds,
      percentage: battle.percentage,
      avgBanners: battle.avgBanners,
      avgBannersWinsOnly: battle.avgBannersWinsOnly,
      count: battle.count,
      category: categorize(battle.percentage),
    });
  }

  const available = counters.filter((c) => !excludedLeads.has(c.attackLeadId));
  available.sort((a, b) => b.percentage - a.percentage);
  return available;
}

function loadAllCounters() {
  const unavailablePath = path.join(__dirname, "unavailableTeams.json");
  const unavailable = JSON.parse(fs.readFileSync(unavailablePath, "utf-8"));
  const excludedLeads = new Set([
    ...(unavailable.defensiveTeams || []),
    ...(unavailable.usedTeams || []),
  ]);
  const usedUnits = new Set(unavailable.usedUnits || []);

  const counters = {};

  for (const zone of ["top", "bottom"]) {
    const zoneDir = path.join(DEFENSES_DIR, zone);
    if (!fs.existsSync(zoneDir)) continue;

    const files = fs
      .readdirSync(zoneDir)
      .filter((f) => f.endsWith(".json"));

    for (const file of files) {
      const filePath = path.join(zoneDir, file);
      const defenseName = path.basename(file, ".json");
      const key = `${zone}/${defenseName}`;
      counters[key] = processDefenseFile(filePath, excludedLeads, usedUnits);
    }
  }

  return counters;
}

// ---------------------------------------------------------------------------
// Backtracking CSP solver
// ---------------------------------------------------------------------------

/**
 * Get the full set of unit IDs used by a counter (lead + all members).
 */
function counterUnits(counter) {
  return [counter.attackLeadId, ...counter.attackMemberIds];
}

/**
 * Attempt to find a valid assignment for a list of defense names.
 *
 * @param {string[]} defenseNames  - ordered list of defense keys to assign
 * @param {object}   counters      - { defenseKey: counter[] }
 * @param {Set}      initialUsed   - units already committed (for partial solves)
 * @returns {{ assignment: object, unassigned: string[] } | null}
 *   assignment maps defenseKey → counter, unassigned lists any that failed
 */
function backtrackAssign(defenseNames, counters, initialUsed = new Set()) {
  // Sort by MRV within the given list (fewest counters first)
  const sorted = [...defenseNames].sort(
    (a, b) => counters[a].length - counters[b].length
  );

  const usedUnits = new Set(initialUsed);
  const assignment = {};
  const unassigned = [];

  function backtrack(index) {
    if (index === sorted.length) return true;

    const defName = sorted[index];
    const options = counters[defName];

    for (const counter of options) {
      const units = counterUnits(counter);

      // Check for unit conflicts
      if (units.some((u) => usedUnits.has(u))) continue;

      // Assign
      for (const u of units) usedUnits.add(u);
      assignment[defName] = counter;

      if (backtrack(index + 1)) return true;

      // Backtrack
      for (const u of units) usedUnits.delete(u);
      delete assignment[defName];
    }

    return false;
  }

  if (backtrack(0)) {
    return { assignment, unassigned: [] };
  }

  return null;
}

/**
 * Greedy fallback: assign what we can in the given order, skipping conflicts.
 * Used when a full solution is impossible — gives a best-effort partial solve.
 */
function greedyPartial(defenseNames, counters, initialUsed = new Set()) {
  const usedUnits = new Set(initialUsed);
  const assignment = {};
  const unassigned = [];

  for (const defName of defenseNames) {
    const options = counters[defName];
    let found = false;

    for (const counter of options) {
      const units = counterUnits(counter);
      if (units.some((u) => usedUnits.has(u))) continue;

      // Take the first (best, since pre-sorted) non-conflicting counter
      for (const u of units) usedUnits.add(u);
      assignment[defName] = counter;
      found = true;
      break;
    }

    if (!found) {
      unassigned.push(defName);
    }
  }

  return { assignment, unassigned };
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function avgBannersFor(assignment) {
  let total = 0;
  let count = 0;
  for (const counter of Object.values(assignment)) {
    total += counter.avgBanners;
    count++;
  }
  return count > 0 ? total / count : 0;
}

// ---------------------------------------------------------------------------
// Main solver
// ---------------------------------------------------------------------------

function solvePlan(allDefenses, counters, orderFn) {
  const ordered = orderFn(allDefenses);
  const result = backtrackAssign(ordered, counters);
  if (result) return result;

  // Fallback: greedy partial
  return greedyPartial(ordered, counters);
}

function solveTopFirst(allDefenses, counters) {
  const topDefenses = allDefenses.filter((d) => d.startsWith("top/"));
  const bottomDefenses = allDefenses.filter((d) => d.startsWith("bottom/"));

  // Solve top zone first (MRV within top)
  const topResult = backtrackAssign(topDefenses, counters);

  if (!topResult) {
    // Top alone unsolvable — greedy all
    return greedyPartial([...topDefenses, ...bottomDefenses], counters);
  }

  // Collect units used by top
  const usedAfterTop = new Set();
  for (const counter of Object.values(topResult.assignment)) {
    for (const u of counterUnits(counter)) usedAfterTop.add(u);
  }

  // Try to solve bottom with remaining units
  const bottomResult = backtrackAssign(bottomDefenses, counters, usedAfterTop);

  if (bottomResult) {
    return {
      assignment: { ...topResult.assignment, ...bottomResult.assignment },
      unassigned: [],
    };
  }

  // Greedy fill bottom
  const greedyBottom = greedyPartial(bottomDefenses, counters, usedAfterTop);
  return {
    assignment: { ...topResult.assignment, ...greedyBottom.assignment },
    unassigned: greedyBottom.unassigned,
  };
}

function main() {
  const counters = loadAllCounters();
  const allDefenses = Object.keys(counters);

  if (allDefenses.length === 0) {
    console.log("No defense files found.");
    return;
  }

  console.log(`Loaded ${allDefenses.length} defensive teams.\n`);
  console.log("=" .repeat(60));

  // ----- Plan A: Full solve with MRV across all teams -----
  console.log("\nPLAN A — Balanced (MRV across all 10 teams, any valid assignment)");
  console.log("-".repeat(60));

  const planA = solvePlan(allDefenses, counters, (defs) =>
    [...defs].sort((a, b) => counters[a].length - counters[b].length)
  );
  printSolution("A", planA.assignment, counters, planA.unassigned);

  // ----- Plan B: Top-first, best counters for top zone -----
  console.log("\nPLAN B — Top Priority (top zone gets first pick of best counters)");
  console.log("-".repeat(60));

  const planB = solveTopFirst(allDefenses, counters);
  printSolution("B", planB.assignment, counters, planB.unassigned);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printSolution(label, assignment, counters, unassigned) {
  const lines = [];
  let totalBanners = 0;
  let assignedCount = 0;

  // Print top zone first, then bottom
  for (const zone of ["top", "bottom"]) {
    const zoneDefenses = Object.keys(assignment)
      .filter((d) => d.startsWith(`${zone}/`))
      .sort();

    if (zoneDefenses.length === 0) continue;

    lines.push(`── ${zone} zone ──`);

    for (const defName of zoneDefenses) {
      const c = assignment[defName];
      const displayName = defName.replace(/^(top|bottom)\//, "");
      const members = c.attackMemberIds.length > 0
        ? c.attackMemberIds.join(", ")
        : "(solo)";
      lines.push(
        `  vs ${displayName}: ${c.attackLeadId} + [${members}]  ` +
          `(${(c.percentage * 100).toFixed(0)}% win, ${c.avgBanners.toFixed(1)} banners, ${c.count} battles)`
      );
      totalBanners += c.avgBanners;
      assignedCount++;
    }

    lines.push("");
  }

  if (unassigned.length > 0) {
    lines.push(`⚠ Unassigned (no counter available):`);
    for (const name of unassigned) {
      lines.push(`  - ${name}`);
    }
    lines.push("");
  }

  lines.push(`Assigned: ${assignedCount}/${counters ? Object.keys(counters).length : '?'} teams`);
  lines.push(
    `Average banners: ${assignedCount > 0 ? (totalBanners / assignedCount).toFixed(1) : "N/A"}`
  );

  // Also output structured JSON for programmatic use
  const jsonOutput = {};
  for (const [defName, counter] of Object.entries(assignment)) {
    jsonOutput[defName] = {
      attackLeadId: counter.attackLeadId,
      attackMemberIds: counter.attackMemberIds,
      percentage: counter.percentage,
      avgBanners: counter.avgBanners,
      category: counter.category,
    };
  }

  console.log(lines.join("\n"));
  // JSON output (uncomment to enable):
  // console.log(`\n── JSON (Plan ${label}) ──`);
  // console.log(JSON.stringify({ plan: label, assignment: jsonOutput, unassigned }, null, 2));
}

main();
