// Generate exam faults: node --env-file=.env.local --import tsx scripts/generate-faults.ts
// GOOD program, 5 faults per crash type. Prints one pass/fail line per fault.
import { generateFault } from "../lib/fault";
import { GOOD } from "../data/samples";
import type { CrashType } from "../lib/sim/types";

const TYPES: CrashType[] = [
  "MISSING_G43",
  "WRONG_WORK_OFFSET",
  "RAPID_INTO_STOCK",
  "RAPID_INTO_VISE",
  "FEED_SPINDLE_OFF",
];

async function main(): Promise<void> {
  let failures = 0;
  for (const type of TYPES) {
    for (let i = 1; i <= 5; i++) {
      try {
        const fault = await generateFault(GOOD, type);
        console.log(
          `PASS ${type} #${i}: changed line ${fault.changed_line} [${fault.model}] hint: ${fault.hint.slice(0, 80)}`,
        );
      } catch (e) {
        failures += 1;
        console.log(`FAIL ${type} #${i}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (failures > 0) {
    console.log(`${failures} fault(s) failed`);
    process.exit(1);
  }
  console.log("All faults generated and saved");
}

void main();
