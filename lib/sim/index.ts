// lib/sim/index.ts
// Pure TypeScript Fanuc 0i-style simulator for CNC Crash Lab.
// No React imports: safe to import from API routes and scripts.
import type { CrashEvent, CrashType, SimResult } from "./types";

export interface SimStep {
  line: number;
  x: number;
  y: number;
  z: number;
  motion: "RAPID" | "FEED";
}

type Motion = "RAPID" | "FEED";
type SolidName = "STOCK" | "VISE" | "TABLE";

// ---------------------------------------------------------------------------
// Control + geometry constants (match components/Machine.tsx)
// ---------------------------------------------------------------------------
const TOOL_LENGTH_MM = 120; // T1 / H01 length compensation value
const TOOL_RADIUS = 5; // T1 flat end mill, diameter 10
const TOOL_STICKOUT = 50; // exposed tool length above the tip
const HOLDER_RADIUS = 20; // holder diameter 40
const HOLDER_HEIGHT = 40;
const SAMPLE_MM = 0.5; // collision + path sampling interval
const RAPID_MMPM = 10000; // assumed rapid traverse rate for cycle time
const DEFAULT_FEED_MMPM = 100; // used if G01 runs before any F word
const HOME_TIP_Z = 200; // G28 (G91 Z0) sends the tip straight up here
const EPS = 1e-9;

const OFFSETS: Record<string, { x: number; y: number; z: number }> = {
  G54: { x: 0, y: 0, z: 0 },
  G55: { x: 0, y: 0, z: -25 }, // left over from an old job
};

interface Solid {
  name: SolidName;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

// Machine coordinates. G54 work zero = front-left corner of stock top.
const SOLIDS: Solid[] = [
  { name: "STOCK", minX: 0, minY: 0, minZ: -30, maxX: 100, maxY: 80, maxZ: 0 },
  // Front vise jaw: X -10..110, Y -15..0, Z -40..-10
  { name: "VISE", minX: -10, minY: -15, minZ: -40, maxX: 110, maxY: 0, maxZ: -10 },
  // Back vise jaw: X -10..110, Y 80..95, Z -40..-10
  { name: "VISE", minX: -10, minY: 80, minZ: -40, maxX: 110, maxY: 95, maxZ: -10 },
  // Table: X -200..300, Y -100..180, Z -60..-40
  { name: "TABLE", minX: -200, minY: -100, minZ: -60, maxX: 300, maxY: 180, maxZ: -40 },
];

const SUPPORTED_G = new Set([0, 1, 17, 21, 28, 40, 43, 49, 54, 55, 90, 91]);
const SUPPORTED_M = new Set([3, 5, 6, 8, 9, 30]);

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
interface Block {
  line: number;
  raw: string;
  g: number[];
  m: number[];
  f?: number;
  s?: number;
  t?: number;
  h?: number;
  x?: number;
  y?: number;
  z?: number;
}

interface ParseOutcome {
  blocks: Block[];
  errors: { line: number; message: string }[];
}

const TOKEN_RE = /([A-Za-z])\s*(-?(?:\d+\.?\d*|\.\d+))/g;

function parseProgram(program: string): ParseOutcome {
  const blocks: Block[] = [];
  const errors: { line: number; message: string }[] = [];
  const lines = program.split("\n");

  lines.forEach((rawLine, idx) => {
    const line = idx + 1;
    // Strip (parenthesised comments), possibly several per line.
    const stripped = rawLine.replace(/\(.*?\)/g, "").trim();
    if (stripped === "") return;

    const block: Block = { line, raw: rawLine, g: [], m: [] };
    TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    let bad = "";
    let failed = false;

    while ((m = TOKEN_RE.exec(stripped)) !== null) {
      const gap = stripped.slice(lastEnd, m.index);
      if (/\S/.test(gap)) {
        bad = gap.trim();
        failed = true;
        break;
      }
      lastEnd = m.index + m[0].length;
      const letter = m[1].toUpperCase();
      const value = Number(m[2]);
      if (Number.isNaN(value)) {
        errors.push({ line, message: `Bad number in ${m[0].trim()}` });
        failed = true;
        break;
      }
      if (letter === "G") {
        if (!SUPPORTED_G.has(value)) {
          errors.push({ line, message: `Unsupported G code G${m[2]}` });
          failed = true;
          break;
        }
        block.g.push(value);
      } else if (letter === "M") {
        if (!SUPPORTED_M.has(value)) {
          errors.push({ line, message: `Unsupported M code M${m[2]}` });
          failed = true;
          break;
        }
        block.m.push(value);
      } else if (letter === "X") block.x = value;
      else if (letter === "Y") block.y = value;
      else if (letter === "Z") block.z = value;
      else if (letter === "F") block.f = value;
      else if (letter === "S") block.s = value;
      else if (letter === "T") block.t = value;
      else if (letter === "H") block.h = value;
      else if (letter === "N" || letter === "O") {
        // Line / program numbers: supported, no effect.
      } else {
        errors.push({ line, message: `Unsupported address ${letter}` });
        failed = true;
        break;
      }
    }

    if (!failed) {
      const tail = stripped.slice(lastEnd);
      if (/\S/.test(tail)) {
        errors.push({ line, message: `Unrecognized code "${tail.trim()}"` });
        failed = true;
      }
    }
    if (!failed) {
      // A block with only N/O words is a no-op (e.g. the O1001 header).
      blocks.push(block);
    }
  });

  return { blocks, errors };
}

// ---------------------------------------------------------------------------
// Collision geometry
// ---------------------------------------------------------------------------
interface Contact {
  part: "TOOL" | "HOLDER";
  solid: SolidName;
}

// Strict inequalities (with epsilon): exact edge-touching clears, any real
// overlap is contact. This keeps the GOOD facing program (tool edge exactly
// at the stock edge, X105 vs stock X100) crash-free while plunges still hit.
function cylinderHits(
  tipX: number,
  tipY: number,
  z0: number,
  z1: number,
  radius: number,
  s: Solid,
): boolean {
  const cx = Math.min(Math.max(tipX, s.minX), s.maxX);
  const cy = Math.min(Math.max(tipY, s.minY), s.maxY);
  const dx = tipX - cx;
  const dy = tipY - cy;
  const r = radius - EPS;
  if (dx * dx + dy * dy >= r * r) return false;
  const lo = Math.max(z0, s.minZ);
  const hi = Math.min(z1, s.maxZ);
  return hi - lo > EPS;
}

function contactAt(tipX: number, tipY: number, tipZ: number): Contact | null {
  // Tool cylinder first (it hangs lowest, so it meets material first).
  for (const s of SOLIDS) {
    if (cylinderHits(tipX, tipY, tipZ, tipZ + TOOL_STICKOUT, TOOL_RADIUS, s)) {
      return { part: "TOOL", solid: s.name };
    }
  }
  for (const s of SOLIDS) {
    if (
      cylinderHits(
        tipX,
        tipY,
        tipZ + TOOL_STICKOUT,
        tipZ + TOOL_STICKOUT + HOLDER_HEIGHT,
        HOLDER_RADIUS,
        s,
      )
    ) {
      return { part: "HOLDER", solid: s.name };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Crash classification (fixed priority order)
// ---------------------------------------------------------------------------
function classify(o: {
  g43SinceToolChange: boolean;
  offset: string;
  solid: SolidName;
  motion: Motion;
  spindleOn: boolean;
}): CrashType {
  if (!o.g43SinceToolChange) return "MISSING_G43";
  if (o.offset !== "G54") return "WRONG_WORK_OFFSET";
  if (o.solid === "VISE") return "RAPID_INTO_VISE";
  if (o.motion === "RAPID" && o.solid === "STOCK") return "RAPID_INTO_STOCK";
  if (o.motion === "FEED" && o.solid === "STOCK" && !o.spindleOn) {
    return "FEED_SPINDLE_OFF";
  }
  // Fallback: every other contact is still a crash but only five types
  // exist. Vise hits are handled above, so rapids read as rapid-into-stock
  // and feeds (holder rubs, table grazes) as feed-without-cutting.
  if (o.motion === "RAPID") return "RAPID_INTO_STOCK";
  return "FEED_SPINDLE_OFF";
}

// ---------------------------------------------------------------------------
// Execution engine (shared by simulate and runSteps)
// ---------------------------------------------------------------------------
interface EngineResult {
  crash: CrashEvent | null;
  crashLine: number | null;
  cycleTimeSec: number;
  steps: SimStep[];
  finishedAtLine: number | null;
}

function execute(blocks: Block[], collectSteps: boolean): EngineResult {
  // Modal state
  let motion: Motion = "RAPID";
  let absolute = true; // G90 (true) vs G91 (false)
  let offsetName = "G54";
  let g43Active = false;
  let g43SinceToolChange = false;
  let spindleOn = false;
  let spindleRpm = 0;
  let feed = DEFAULT_FEED_MMPM;

  // Positions. Tip is tracked in machine coords (= G54 work coords).
  // Work position is derived so the tip starts at (0, 0, 200) with G43 off.
  let tip = { x: 0, y: 0, z: HOME_TIP_Z };
  let work = { x: 0, y: 0, z: HOME_TIP_Z + TOOL_LENGTH_MM };

  const steps: SimStep[] = [];
  let cycleTimeSec = 0;

  const tipFromWork = (w: { x: number; y: number; z: number }): { x: number; y: number; z: number } => {
    const o = OFFSETS[offsetName];
    return {
      x: w.x + o.x,
      y: w.y + o.y,
      z: w.z + o.z - (g43Active ? 0 : TOOL_LENGTH_MM),
    };
  };

  for (const b of blocks) {
    // G words first (modal groups), in token order.
    for (const g of b.g) {
      if (g === 0) motion = "RAPID";
      else if (g === 1) motion = "FEED";
      else if (g === 90) absolute = true;
      else if (g === 91) absolute = false;
      else if (g === 54 || g === 55) offsetName = `G${g}`;
      else if (g === 43) {
        g43Active = true;
        g43SinceToolChange = true;
      } else if (g === 49) g43Active = false;
      // G17/G21/G28/G40 are accepted but need no state here (G28 handled below).
    }
    if (b.f !== undefined) feed = b.f;
    if (b.s !== undefined) spindleRpm = b.s;
    // M words: tool change resets the G43 requirement; M03/M05 flip spindle.
    for (const mm of b.m) {
      if (mm === 6) {
        g43Active = false;
        g43SinceToolChange = false;
      } else if (mm === 3) spindleOn = true;
      else if (mm === 5) spindleOn = false;
      // M08/M09 (coolant) and M30 (end) need no extra state here.
    }

    // Determine the move for this block, if any.
    let target: { x: number; y: number; z: number } | null = null;
    let moveMotion: Motion = motion;
    if (b.g.includes(28)) {
      // G28 with G91 Z0: rapid straight up so the tip reaches Z 200.
      target = { x: tip.x, y: tip.y, z: HOME_TIP_Z };
      moveMotion = "RAPID";
    } else if (b.x !== undefined || b.y !== undefined || b.z !== undefined) {
      const w = { ...work };
      if (absolute) {
        if (b.x !== undefined) w.x = b.x;
        if (b.y !== undefined) w.y = b.y;
        if (b.z !== undefined) w.z = b.z;
      } else {
        if (b.x !== undefined) w.x += b.x;
        if (b.y !== undefined) w.y += b.y;
        if (b.z !== undefined) w.z += b.z;
      }
      target = tipFromWork(w);
      // Commit the work position only if the move completes (no crash).
      // Stash it on the block for now; stored below after sampling.
      (b as { __w?: { x: number; y: number; z: number } }).__w = w;
    }

    if (b.m.includes(30)) {
      // M30 ends the program after any same-block move completes.
      if (target === null) {
        return { crash: null, crashLine: null, cycleTimeSec, steps, finishedAtLine: b.line };
      }
      // Fall through: execute the move, then finish after the loop iteration.
      const res = runMove(b, target, moveMotion);
      if (res !== null) return res;
      return { crash: null, crashLine: null, cycleTimeSec, steps, finishedAtLine: b.line };
    }
    if (target === null) continue;

    const res = runMove(b, target, moveMotion);
    if (res !== null) return res;
  }

  return { crash: null, crashLine: null, cycleTimeSec, steps, finishedAtLine: null };

  function runMove(
    b: Block,
    target: { x: number; y: number; z: number },
    moveMotion: Motion,
  ): EngineResult | null {
    const dx = target.x - tip.x;
    const dy = target.y - tip.y;
    const dz = target.z - tip.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rate = moveMotion === "RAPID" ? RAPID_MMPM : feed > 0 ? feed : DEFAULT_FEED_MMPM;
    const fullTime = (dist / rate) * 60;
    const n = dist < EPS ? 1 : Math.ceil(dist / SAMPLE_MM - EPS);

    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const px = tip.x + dx * t;
      const py = tip.y + dy * t;
      const pz = tip.z + dz * t;
      if (collectSteps) steps.push({ line: b.line, x: px, y: py, z: pz, motion: moveMotion });
      const hit = contactAt(px, py, pz);
      const cutting =
        hit !== null &&
        hit.part === "TOOL" &&
        hit.solid === "STOCK" &&
        moveMotion === "FEED" &&
        spindleOn;
      if (hit !== null && !cutting) {
        cycleTimeSec += fullTime * (i / n);
        const crash: CrashEvent = {
          type: classify({
            g43SinceToolChange,
            offset: offsetName,
            solid: hit.solid,
            motion: moveMotion,
            spindleOn,
          }),
          line: b.line,
          block: b.raw.trim(),
          position: { x: px, y: py, z: pz },
          motion: moveMotion,
          spindleRpm,
          collidedWith: hit.solid,
        };
        return { crash, crashLine: b.line, cycleTimeSec, steps, finishedAtLine: null };
      }
    }

    cycleTimeSec += fullTime;
    tip = { ...target };
    const w = (b as { __w?: { x: number; y: number; z: number } }).__w;
    if (w !== undefined) work = { ...w };
    else if (b.g.includes(28)) {
      // Re-derive work Z so tip/work stay consistent after homing.
      const o = OFFSETS[offsetName];
      work = { ...work, z: tip.z - o.z + (g43Active ? 0 : TOOL_LENGTH_MM) };
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function simulate(program: string): SimResult {
  const totalLines = program.split("\n").length;
  const { blocks, errors } = parseProgram(program);
  if (errors.length > 0) {
    return { ok: false, crash: null, linesExecuted: 0, cycleTimeSec: 0, parseErrors: errors };
  }
  const r = execute(blocks, false);
  if (r.crash !== null) {
    return {
      ok: false,
      crash: r.crash,
      linesExecuted: r.crashLine ?? 0,
      cycleTimeSec: r.cycleTimeSec,
      parseErrors: [],
    };
  }
  return {
    ok: true,
    crash: null,
    linesExecuted: totalLines,
    cycleTimeSec: r.cycleTimeSec,
    parseErrors: [],
  };
}

// Tool-tip path sampled every 0.5 mm for animation. Stops at the first
// crash (inclusive) or at M30 / end of program. Lines with parse errors
// are skipped.
export function runSteps(program: string): SimStep[] {
  const { blocks } = parseProgram(program);
  return execute(blocks, true).steps;
}
