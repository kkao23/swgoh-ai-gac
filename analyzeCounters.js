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

function processDefenseFile(filePath, excludedLeads) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const json = JSON.parse(raw);
  const battles = json.data.battles.filter(
    (b) => b.count >= 10 && b.percentage >= 0.2
  );

  // Build categorized counter list
  const counters = [];
  for (const battle of battles) {
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

  const files = fs
    .readdirSync(DEFENSES_DIR)
    .filter((f) => f.endsWith(".json"));

  const output = {};

  for (const file of files) {
    const filePath = path.join(DEFENSES_DIR, file);
    const defenseName = path.basename(file, ".json");
    output[defenseName] = processDefenseFile(filePath, excludedLeads);
  }

  console.log(JSON.stringify(output, null, 2));
}

main();
