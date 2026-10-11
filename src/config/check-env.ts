import { auditEnvironmentVariables } from "./env-diagnostic";

/**
 * CLI runner for safe zero-exposure environment audit.
 * Usage: npx tsx src/config/check-env.ts
 */
export function runCheckEnv(): void {
  const items = auditEnvironmentVariables(process.env);

  console.log("\n================================================================================");
  console.log("             ISHAARA BACKEND — ZERO-EXPOSURE ENVIRONMENT AUDIT                  ");
  console.log("================================================================================\n");

  const formatted = items.map((item) => ({
    "Variable": item.variable,
    "Status": item.isSet ? (item.isValidFormat ? "SET (VALID)" : "SET (INVALID)") : "NOT SET",
    "Required (Prod)": item.isRequiredInProduction ? "YES" : "OPTIONAL",
    "Feature Active": item.featureEnabled ? "YES" : "DISABLED",
    "Feature": item.feature,
    "Notes": item.notes || "-",
  }));

  console.table(formatted);

  const missingRequired = items.filter(
    (i) => i.isRequiredInProduction && (!i.isSet || !i.isValidFormat)
  );

  if (missingRequired.length > 0) {
    console.log(`\n❌ ATTENTION: ${missingRequired.length} mandatory production configuration items require attention:`);
    missingRequired.forEach((i) => {
      console.log(`   - ${i.variable} (${i.feature}): ${!i.isSet ? "Missing" : "Invalid format"}`);
    });
    console.log("");
  } else {
    console.log("\n✅ All mandatory production configuration items are configured with valid format.\n");
  }
}

if (require.main === module || (process.argv && process.argv[1]?.endsWith("check-env.ts"))) {
  runCheckEnv();
}
