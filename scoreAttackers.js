const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "popular");

// ---------------------------------------------------------------------------
// Load & defense scoring (same as scoreDefenses.js)
// ---------------------------------------------------------------------------

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
      for (const c of large) {
        results.push({ ...c });
      }
      const small = items.filter((c) => c.count <= 500);
      if (small.length > 0) results.push(aggregate(small));
    } else {
      results.push(aggregate(items));
    }
  }

  const MIN_STRONG = 200, MIN_UNCOMFORTABLE = 100, MIN_WEAK = 50;
  const strong = results.filter(
    (c) => c.percentage > 0.7 && leadBattles[c.attackLeadId] >= MIN_STRONG
  );
  const uncomfortable = results.filter(
    (c) =>
      c.percentage >= 0.5 &&
      c.percentage <= 0.7 &&
      leadBattles[c.attackLeadId] >= MIN_UNCOMFORTABLE
  );
  const weakNotable = results.filter(
    (c) =>
      c.percentage < 0.5 &&
      c.count > 100 &&
      leadBattles[c.attackLeadId] >= MIN_WEAK
  );

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

// ---------------------------------------------------------------------------
// Offensive scoring
// ---------------------------------------------------------------------------

function main() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));

  // Step 1: compute defense scores
  const defenseScores = {};
  const allCounters = {};

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const { defenseId, battles: counters } = processDefenseFile(filePath);
    if (!defenseId) continue;
    allCounters[defenseId] = counters;

    const analysis = analyzeDefense(counters);
    if (analysis.totalBattles < 500) {
      defenseScores[defenseId] = null; // insufficient data
      continue;
    }
    const { strong, uncomfortable, weak } = applyDuplicateRule(analysis);
    defenseScores[defenseId] = defenseScore({ strong, uncomfortable, weak });
  }

  const maxDefScore = Math.max(...Object.values(defenseScores).filter((s) => s !== null));

  // Step 2: build reverse index — for each attacking lead, list defenses beaten
  const attackers = {};

  for (const [defName, counters] of Object.entries(allCounters)) {
    const defScore = defenseScores[defName];
    if (defScore === null) continue; // skip insufficient-data defenses

    // Group attacking comps by lead
    const groups = {};
    for (const c of counters) {
      const lead = c.attackLeadId;
      if (!groups[lead]) groups[lead] = [];
      groups[lead].push(c);
    }

    for (const [lead, items] of Object.entries(groups)) {
      const totalBattles = items.reduce((s, c) => s + c.count, 0);
      if (totalBattles < 50) continue;

      // Best win rate across comps (duplicate-comp rule: if any comp works, the lead works)
      const bestPct = Math.max(...items.map((c) => c.percentage));
      if (!attackers[lead]) attackers[lead] = [];
      attackers[lead].push({ defense: defName, defScore, winRate: bestPct, battles: totalBattles });
    }
  }

  // Step 3: compute offense scores
  // Multiplier: 1.0 at 50%, 3.0 at 85%, capped at 95%. Below 50% = 0 (no penalty).
  function winRateMult(wr) {
    if (wr < 0.5) return 0;
    const t = Math.min((wr - 0.5) / 0.35, 0.45 / 0.35);
    return 1.0 + t * 2.0;
  }

  const rows = [];

  for (const [lead, wins] of Object.entries(attackers)) {
    if (wins.length === 0) continue;

    const score = wins.reduce((sum, w) => {
      const difficulty = 1 - w.defScore / maxDefScore;
      return sum + difficulty * winRateMult(w.winRate);
    }, 0);

    // Also track how many top-5 defenses this lead beats (>50% win rate)
    const sortedDefs = Object.entries(defenseScores)
      .filter(([, s]) => s !== null)
      .sort((a, b) => a[1] - b[1]);
    const top5 = sortedDefs.slice(0, 5).map(([n]) => n);
    const beatsTop5 = wins.filter((w) => top5.includes(w.defense)).length;

    rows.push({
      name: lead,
      beaten: wins.length,
      beatsTop5,
      score,
    });
  }

  rows.sort((a, b) => b.score - a.score);

  // Output
  console.log("Attacker             Beats  Top5     Score");
  console.log("────────             ─────  ────     ─────");
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(21)} ${String(r.beaten).padStart(5)}  ${String(r.beatsTop5).padStart(4)}  ${String(r.score.toFixed(1)).padStart(8)}`
    );
  }

  // Reference: defense rankings
  console.log("\nDefense reference:");
  const defRank = Object.entries(defenseScores)
    .filter(([, s]) => s !== null)
    .sort((a, b) => a[1] - b[1]);
  for (const [name, score] of defRank) {
    console.log(`  ${name.padEnd(21)} ${score}`);
  }
}

main();
