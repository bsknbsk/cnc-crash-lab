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
}

export interface SimResult {
  ok: boolean;
  crash: CrashEvent | null;
  linesExecuted: number;
  cycleTimeSec: number;
  parseErrors: { line: number; message: string }[];
}
