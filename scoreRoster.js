const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "popular");

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

function aggregate(items) {
  const totalCount = items.reduce((s, c) => s + c.count, 0);
  return {
    attackLeadId: items[0].attackLeadId,
    percentage: items.reduce((s, c) => s + c.percentage * c.count, 0) / totalCount,
    avgBanners: items.reduce((s, c) => s + c.avgBanners * c.count, 0) / totalCount,
    count: totalCount,
    attackMemberIds: items.reduce((b, c) => (c.count > b.count ? c : b)).attackMemberIds,
  };
}

// ---- defense scoring ----

function analyzeDefense(counters) {
  const groups = {};
  for (const c of counters) {
    const lead = c.attackLeadId;
    if (!groups[lead]) groups[lead] = [];
    groups[lead].push(c);
  }
  const leadBattles = {};
  let totalDefBattles = 0;
  for (const [lead, items] of Object.entries(groups)) {
    leadBattles[lead] = items.reduce((s, c) => s + c.count, 0);
    totalDefBattles += leadBattles[lead];
  }
  const results = [];
  for (const [, items] of Object.entries(groups)) {
    const large = items.filter((c) => c.count > 500);
    if (large.length >= 2) {
      for (const c of large) results.push({ ...c });
      const small = items.filter((c) => c.count <= 500);
      if (small.length > 0) results.push(aggregate(small));
    } else {
      results.push(aggregate(items));
    }
  }
  const MIN_STRONG = 200, MIN_UNCOMFORTABLE = 100, MIN_WEAK = 50;
  const strong = results.filter((c) => c.percentage > 0.7 && leadBattles[c.attackLeadId] >= MIN_STRONG);
  const uncomfortable = results.filter((c) => c.percentage >= 0.5 && c.percentage <= 0.7 && leadBattles[c.attackLeadId] >= MIN_UNCOMFORTABLE);
  const weakNotable = results.filter((c) => c.percentage < 0.5 && c.count > 100 && leadBattles[c.attackLeadId] >= MIN_WEAK);
  return { strong, uncomfortable, weakNotable, totalBattles: totalDefBattles };
}

function applyDuplicateRule({ strong, uncomfortable, weakNotable }) {
  const strongLeads = new Set(strong.map((c) => c.attackLeadId));
  const fStrong = [...strong], fUnc = [], fWeak = [];
  for (const c of uncomfortable) strongLeads.has(c.attackLeadId) ? fStrong.push(c) : fUnc.push(c);
  for (const c of weakNotable) strongLeads.has(c.attackLeadId) ? fStrong.push(c) : fWeak.push(c);
  return { strong: fStrong, uncomfortable: fUnc, weak: fWeak };
}

function uniqueLeads(entries) {
  return new Set(entries.map((c) => c.attackLeadId)).size;
}

function defenseScore({ strong, uncomfortable, weak }) {
  return uniqueLeads(strong) * 50 - uniqueLeads(uncomfortable) * 5 - uniqueLeads(weak) * 15;
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

  // --- Compute defense scores ---
  const defScores = {};
  const allCounters = {};

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const { defenseId, battles: counters } = processDefenseFile(filePath);
    if (!defenseId) continue;
    allCounters[defenseId] = counters;

    const analysis = analyzeDefense(counters);
    if (analysis.totalBattles < 500) continue;
    const { strong, uncomfortable, weak } = applyDuplicateRule(analysis);
    defScores[defenseId] = defenseScore({ strong, uncomfortable, weak });
  }

  const maxDefScore = Math.max(...Object.values(defScores));

  // --- Compute offense scores ---
  const attackers = {};

  for (const [defName, counters] of Object.entries(allCounters)) {
    const defScore = defScores[defName];
    if (defScore === undefined) continue;

    const groups = {};
    for (const c of counters) {
      const lead = c.attackLeadId;
      if (!groups[lead]) groups[lead] = [];
      groups[lead].push(c);
    }

    for (const [lead, items] of Object.entries(groups)) {
      const totalBattles = items.reduce((s, c) => s + c.count, 0);
      if (totalBattles < 50) continue;
      const bestPct = Math.max(...items.map((c) => c.percentage));
      if (!attackers[lead]) attackers[lead] = [];
      attackers[lead].push({ defense: defName, defScore, winRate: bestPct });
    }
  }

  const offScores = {};
  for (const [lead, wins] of Object.entries(attackers)) {
    if (wins.length > 0) {
      offScores[lead] = offenseScore(wins, maxDefScore);
    }
  }

  const maxOffScore = Math.max(...Object.values(offScores));

  // --- Build unified team list ---
  const allTeams = new Set([
    ...Object.keys(defScores),
    ...Object.keys(offScores),
  ]);

  const teams = [];
  for (const name of allTeams) {
    const defRaw = defScores[name];
    const offRaw = offScores[name];

    // Normalize: higher = better. Missing data: no def score = 0 (goes to offense),
    // no off score = same as def score (assume balanced, don't penalize)
    const defQuality = defRaw !== undefined ? 1 - defRaw / maxDefScore : 0;
    const offQuality = offRaw !== undefined ? offRaw / maxOffScore : defQuality;

    // Rank = defQuality × 3 - offQuality
    // A great defender (0.9) with decent offense (0.5) still beats
    // a mediocre defender (0.6) with no offense data (0.6)
    const pref = defQuality * 3 - offQuality;

    teams.push({ name, defRaw, offRaw, defQuality, offQuality, pref });
  }

  // Sort by defense preference (descending) — top of list = should be on defense
  teams.sort((a, b) => b.pref - a.pref);

  // Allocate: top 15 → defense, rest → offense
  const defenders = teams.slice(0, 15);
  const offenders = teams.slice(15);

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
  printZone("TOP (5 slots)", 1000, TOP);
  printZone("BOTTOM RIGHT (5 slots, gates BL)", 550, BR);
  printZone("BOTTOM LEFT (5 slots, gated)", 550, BL);

  console.log("\n=== OFFENSE (15 teams) ===");
  console.log("  Team                  DefScore  OffScore  Preference");
  console.log("  ────                  ────────  ────────  ──────────");
  // Show best attackers first
  const sortedOff = [...offenders].sort((a, b) => (b.offRaw ?? 0) - (a.offRaw ?? 0));
  for (const t of sortedOff) {
    const ds = t.defRaw !== undefined ? String(t.defRaw) : "—";
    const os = t.offRaw !== undefined ? t.offRaw.toFixed(1) : "—";
    const pf = t.pref.toFixed(2);
    console.log(`  ${t.name.padEnd(22)} ${ds.padStart(6)}  ${os.padStart(8)}  ${pf.padStart(10)}`);
  }
}

main();
