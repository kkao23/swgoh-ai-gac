const fs = require("fs");
const path = require("path");

const DEFENSES_DIR = path.join(__dirname, "defenses");

// ---------------------------------------------------------------------------
// Counter-loading (same logic as analyzeCounters.js)
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
      allCounters[key] = processDefenseFile(filePath);
    }
  }

  return allCounters;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function analyzeDefense(defName, counters) {
  // Group by attackLeadId, keep highest percentage + associated data
  const bestByLead = {};
  for (const c of counters) {
    const lead = c.attackLeadId;
    if (!bestByLead[lead] || c.percentage > bestByLead[lead].percentage) {
      bestByLead[lead] = {
        attackLeadId: lead,
        percentage: c.percentage,
        avgBanners: c.avgBanners,
        count: c.count,
        attackMemberIds: c.attackMemberIds,
      };
    }
  }

  const best = Object.values(bestByLead);
  best.sort((a, b) => b.percentage - a.percentage);

  const strong = best.filter((c) => c.percentage > 0.7);
  const weakNotable = best.filter((c) => c.percentage < 0.5 && c.count > 100);

  return { defName, strong, weakNotable };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function main() {
  const allCounters = loadAllCounters();
  const defenses = Object.keys(allCounters).sort();

  for (const zone of ["top", "bottom"]) {
    const zoneDefenses = defenses.filter((d) => d.startsWith(`${zone}/`));
    if (zoneDefenses.length === 0) continue;

    console.log(`== ${zone} zone ==\n`);

    for (const defName of zoneDefenses) {
      const { strong, weakNotable } = analyzeDefense(defName, allCounters[defName]);
      const displayName = defName.replace(/^(top|bottom)\//, "");

      console.log(`── vs ${displayName} ──`);

      if (strong.length > 0) {
        console.log("  Strong counters (>70%):");
        for (const c of strong) {
          const members = c.attackMemberIds.length > 0
            ? c.attackMemberIds.join(", ")
            : "(solo)";
          console.log(
            `    ${c.attackLeadId} + [${members}]  (${(c.percentage * 100).toFixed(0)}%, ${c.avgBanners.toFixed(1)} banners, ${c.count} battles)`
          );
        }
      } else {
        console.log("  Strong counters (>70%): (none)");
      }

      if (weakNotable.length > 0) {
        console.log("  Weak but common (<50%, >100 battles):");
        for (const c of weakNotable) {
          const members = c.attackMemberIds.length > 0
            ? c.attackMemberIds.join(", ")
            : "(solo)";
          console.log(
            `    ${c.attackLeadId} + [${members}]  (${(c.percentage * 100).toFixed(0)}%, ${c.avgBanners.toFixed(1)} banners, ${c.count} battles)`
          );
        }
      }

      console.log("");
    }
  }
}

main();
