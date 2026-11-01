export type CrashType =
  | "RAPID_INTO_STOCK"
  | "RAPID_INTO_VISE"
  | "MISSING_G43"
  | "WRONG_WORK_OFFSET"
  | "FEED_SPINDLE_OFF";

export interface CrashEvent {
  type: CrashType;
  line: number;
  block: string;
  position: { x: number; y: number; z: number };
  motion: "RAPID" | "FEED";
  spindleRpm: number;
  collidedWith: "STOCK" | "VISE" | "TABLE";
  /** Block target in the active work coordinates, as programmed. */
  commandedTarget: { x: number; y: number; z: number };
  /** Where the tool tip was actually heading, in G54 (machine) terms. */
  actualTarget: { x: number; y: number; z: number };
  /** actualTarget.z minus the intended G54 Z (commanded z, G54 + G43 active). */
  zErrorMm: number;
  /** Active work offset of the crashing block (G54, G55, ...). */
  offset: string;
}

export interface SimResult {
  ok: boolean;
  crash: CrashEvent | null;
  linesExecuted: number;
  cycleTimeSec: number;
  parseErrors: { line: number; message: string }[];
}
