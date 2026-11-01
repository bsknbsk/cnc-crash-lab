// Sample programs: one GOOD program plus one variant per crash type.
// Variants are derived from GOOD with the exact edits from the task spec.
import type { CrashType } from "../lib/sim/types";

export const GOOD = `O1001 (FACE TOP 1MM)
G21 G17 G40 G49 G90
G54
T1 M06
S3000 M03
G00 X5. Y5.
G43 Z25. H01 M08
G00 Z5.
G01 Z-1. F300
G01 X105. F800
G01 Y13.
G01 X5.
G01 Y21.
G01 X105.
G00 Z25.
M09
M05
G91 G28 Z0.
G90
M30`;

// MISSING_G43: G43 line replaced so length comp is never activated.
export const MISSING_G43 = GOOD.replace("G43 Z25. H01 M08", "G00 Z25. M08");

// WRONG_WORK_OFFSET: stale G55 offset (0,0,-25) instead of G54.
export const WRONG_WORK_OFFSET = GOOD.replace("\nG54\n", "\nG55\n");

// RAPID_INTO_STOCK: rapid plunge to Z-5 instead of Z5.
export const RAPID_INTO_STOCK = GOOD.replace("G00 Z5.", "G00 Z-5.");

// FEED_SPINDLE_OFF: spindle never turns on.
export const FEED_SPINDLE_OFF = GOOD.replace("S3000 M03\n", "");

// RAPID_INTO_VISE: rapid sidestep over the front jaw, then rapid down into it.
export const RAPID_INTO_VISE = GOOD.replace(
  "G00 Z5.\n",
  "G00 Z5.\nG00 Y-10.\nG00 Z-15.\n",
);

export const VARIANTS: Record<CrashType, string> = {
  MISSING_G43,
  WRONG_WORK_OFFSET,
  RAPID_INTO_VISE,
  RAPID_INTO_STOCK,
  FEED_SPINDLE_OFF,
};
