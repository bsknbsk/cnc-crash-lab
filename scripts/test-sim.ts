// Test script: npx tsx scripts/test-sim.ts
// Asserts GOOD returns ok and each variant returns its crash type.
import { simulate, runSteps } from "../lib/sim/index";
import {
  GOOD,
  VARIANTS,
  MISSING_G43,
  WRONG_WORK_OFFSET,
} from "../data/samples";
import type { CrashType } from "../lib/sim/types";

let failures = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const good = simulate(GOOD);
check("GOOD ok", good.ok === true, `ok=${good.ok}`);
check("GOOD crash null", good.crash === null, `crash=${JSON.stringify(good.crash)}`);
check("GOOD no parse errors", good.parseErrors.length === 0, JSON.stringify(good.parseErrors));

const steps = runSteps(GOOD);
check("GOOD steps non-empty", steps.length > 0, `steps=${steps.length}`);

// Every consecutive step (from tool start 0,0,200) must be <= 0.5 mm apart.
let prev = { x: 0, y: 0, z: 200 };
let maxGap = 0;
for (const s of steps) {
  const d = Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z);
  if (d > maxGap) maxGap = d;
  prev = s;
}
check("GOOD step spacing <= 0.5mm", maxGap <= 0.5 + 1e-9, `maxGap=${maxGap}`);

// Final step should be the G28 home position (tip Z 200).
const last = steps[steps.length - 1];
check(
  "GOOD ends at home Z200",
  last !== undefined && Math.abs(last.z - 200) < 1e-9,
  `last=${JSON.stringify(last)}`,
);

for (const [type, prog] of Object.entries(VARIANTS) as [CrashType, string][]) {
  const r = simulate(prog);
  check(`${type}: not ok`, r.ok === false, `ok=${r.ok}`);
  check(`${type}: crash type`, r.crash?.type === type, `got ${r.crash?.type}`);
  const vsteps = runSteps(prog);
  check(`${type}: steps stop at crash line`, vsteps.every((s) => s.line <= (r.crash?.line ?? 1e9)), "");
}

const wwo = simulate(WRONG_WORK_OFFSET);
check(
  "WRONG_WORK_OFFSET actualTarget.z = -20",
  wwo.crash?.actualTarget.z === -20,
  `got ${JSON.stringify(wwo.crash?.actualTarget)}`,
);
check(
  "WRONG_WORK_OFFSET zErrorMm = -25",
  wwo.crash?.zErrorMm === -25,
  `got ${wwo.crash?.zErrorMm}`,
);

const mg43 = simulate(MISSING_G43);
check(
  "MISSING_G43 zErrorMm = -120",
  mg43.crash?.zErrorMm === -120,
  `got ${mg43.crash?.zErrorMm}`,
);

// Rapid sideways at cutting depth: G00 X25 while the tip is still at Z-1.
const SIDEWAYS = `G21 G17 G40 G49 G90
G54
T1 M06
S3000 M03
G00 X5 Y5
G43 Z25 H01
G00 Z5
G01 Z-1 F300
G00 X25
M30`;
const side = simulate(SIDEWAYS);
check(
  "sideways: RAPID_INTO_STOCK",
  side.crash?.type === "RAPID_INTO_STOCK",
  `got ${side.crash?.type}`,
);
check(
  "sideways: zErrorMm 0",
  side.crash?.zErrorMm === 0,
  `got ${side.crash?.zErrorMm}`,
);

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All sim checks passed");
