const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "popular");

// ---------------------------------------------------------------------------
// Counter-loading
// ---------------------------------------------------------------------------

function processDefenseFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const json = JSON.parse(raw);
  const battles = json.data.battles.filter(
    (b) => b.count >= 10 && b.percentage >= 0.2
  );

  return battles.map((battle) => ({
    attackLeadId: battle.attackLeadId,
    attackMemberIds: battle.attackMemberIds,
    percentage: battle.percentage,
    avgBanners: battle.avgBanners,
    count: battle.count,
  }));
}

function loadAllCounters() {
  const allCounters = {};
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"));

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const name = path.basename(file, ".json");
    allCounters[name] = processDefenseFile(filePath);
  }
  return allCounters;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function aggregate(items) {
  const totalCount = items.reduce((sum, c) => sum + c.count, 0);
  const weightedPct =
    items.reduce((sum, c) => sum + c.percentage * c.count, 0) / totalCount;
  const weightedBanners =
    items.reduce((sum, c) => sum + c.avgBanners * c.count, 0) / totalCount;
  const mostBattled = items.reduce((best, c) =>
    c.count > best.count ? c : best
  );
  return {
    attackLeadId: items[0].attackLeadId,
    percentage: weightedPct,
    avgBanners: weightedBanners,
    count: totalCount,
    attackMemberIds: mostBattled.attackMemberIds,
  };
}

function analyzeDefense(defName, counters) {
  const groups = {};
  for (const c of counters) {
    const lead = c.attackLeadId;
    if (!groups[lead]) groups[lead] = [];
    groups[lead].push(c);
  }

  // Total battles per lead + per defense (for confidence thresholds)
  const leadBattles = {};
  let totalDefBattles = 0;
  for (const [lead, items] of Object.entries(groups)) {
    leadBattles[lead] = items.reduce((sum, c) => sum + c.count, 0);
    totalDefBattles += leadBattles[lead];
  }

  const results = [];
  for (const [, items] of Object.entries(groups)) {
    const large = items.filter((c) => c.count > 500);

    if (large.length >= 2) {
      // Split: each large comp is its own entry, aggregate the rest
      for (const c of large) {
        results.push({
          attackLeadId: c.attackLeadId,
          percentage: c.percentage,
          avgBanners: c.avgBanners,
          count: c.count,
          attackMemberIds: c.attackMemberIds,
        });
      }
      const small = items.filter((c) => c.count <= 500);
      if (small.length > 0) results.push(aggregate(small));
    } else {
      results.push(aggregate(items));
    }
  }

  results.sort((a, b) => b.percentage - a.percentage);

  const MIN_STRONG = 200;
  const MIN_UNCOMFORTABLE = 100;
  const MIN_WEAK = 50;

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

  return { defName, strong, uncomfortable, weakNotable, totalBattles: totalDefBattles };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function applyDuplicateRule({ strong, uncomfortable, weakNotable }) {
  const strongLeads = new Set(strong.map((c) => c.attackLeadId));

  const finalStrong = [...strong];
  const finalUncomfortable = [];
  const finalWeak = [];

  for (const c of uncomfortable) {
    strongLeads.has(c.attackLeadId) ? finalStrong.push(c) : finalUncomfortable.push(c);
  }
  for (const c of weakNotable) {
    strongLeads.has(c.attackLeadId) ? finalStrong.push(c) : finalWeak.push(c);
  }

  return { strong: finalStrong, uncomfortable: finalUncomfortable, weak: finalWeak };
}

function uniqueLeads(entries) {
  return new Set(entries.map((c) => c.attackLeadId)).size;
}

function totalBattles(entries) {
  return entries.reduce((sum, c) => sum + c.count, 0);
}

function score({ strong, uncomfortable, weak }) {
  return uniqueLeads(strong) * 50
       + uniqueLeads(uncomfortable) * 20
       + uniqueLeads(weak) * 10;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function main() {
  const allCounters = loadAllCounters();
  const defenses = Object.keys(allCounters).sort();

  const rows = [];
  const insufficient = [];

  for (const defName of defenses) {
    const analysis = analyzeDefense(defName, allCounters[defName]);

    if (analysis.totalBattles < 500) {
      insufficient.push(defName);
      continue;
    }

    const { strong, uncomfortable, weak } = applyDuplicateRule(analysis);

    rows.push({
      name: defName,
      sLeads: uniqueLeads(strong),
      sBattles: totalBattles(strong),
      uLeads: uniqueLeads(uncomfortable),
      uBattles: totalBattles(uncomfortable),
      wLeads: uniqueLeads(weak),
      wBattles: totalBattles(weak),
      score: score({ strong, uncomfortable, weak }),
    });
  }

  rows.sort((a, b) => b.score - a.score);

  console.log(
    "Defense              S-Ld  S-Bat    U-Ld  U-Bat    W-Ld  W-Bat     Score"
  );
  console.log(
    "───────              ────  ─────    ────  ─────    ────  ─────     ─────"
  );

  for (const r of rows) {
    console.log(
      `${r.name.padEnd(21)} ${String(r.sLeads).padStart(4)}  ${String(r.sBattles).padStart(5)}    ${String(r.uLeads).padStart(4)}  ${String(r.uBattles).padStart(5)}    ${String(r.wLeads).padStart(4)}  ${String(r.wBattles).padStart(5)}     ${String(r.score).padStart(5)}`
    );
  }

  if (insufficient.length > 0) {
    console.log(`\nInsufficient data (<500 battles): ${insufficient.join(", ")}`);
  }
}

main();
