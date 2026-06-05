const fs = require("fs");
const path = require("path");

const DEFENSES_DIR = path.join(__dirname, "defenses");

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

  // Build categorized counter list
  const counters = [];
  for (const battle of battles) {
    // Skip battles that use units already committed elsewhere
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

  // Filter out leads that are already on defense or used elsewhere
  const available = counters.filter((c) => !excludedLeads.has(c.attackLeadId));

  // Sort by percentage descending (best counters first)
  available.sort((a, b) => b.percentage - a.percentage);

  return available;
}

function main() {
  // Load unavailable teams
  const unavailablePath = path.join(__dirname, "unavailableTeams.json");
  const unavailable = JSON.parse(fs.readFileSync(unavailablePath, "utf-8"));
  const excludedLeads = new Set([
    ...(unavailable.defensiveTeams || []),
    ...(unavailable.usedTeams || []),
  ]);
  const usedUnits = new Set(unavailable.usedUnits || []);

  const output = {};

  // Scan defenses/top/ and defenses/bottom/ subdirectories
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
      output[key] = processDefenseFile(filePath, excludedLeads, usedUnits);
    }
  }

  console.log(JSON.stringify(output, null, 2));
}

main();
