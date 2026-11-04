// lib/sparks.ts
// Pure spark-burst math for the crash impact effect (no React imports).
export interface SparkBurst {
  positions: Float32Array; // 60 * 3, start at the impact point
  velocities: Float32Array; // 60 * 3, mm/s
  colors: Float32Array; // 60 * 3, rgb 0..1
  lifetimes: Float32Array; // 60, seconds until fade-out (0.5..0.9)
}

export const SPARK_COUNT = 60;
export const SPARK_MIN_SPEED = 150;
export const SPARK_MAX_SPEED = 400;
export const SPARK_GRAVITY = 2500; // mm/s^2 downward

const PALETTE: Array<[number, number, number]> = [
  [1.0, 0.824, 0.478], // #FFD27A
  [1.0, 0.604, 0.235], // #FF9A3C
  [1.0, 1.0, 1.0], // #FFFFFF
];

const SOLID_CENTER: Record<string, [number, number]> = {
  STOCK: [50, 40],
  TABLE: [50, 40],
};

/** XY center of the collided solid: front vs back vise jaw by impact Y. */
export function solidCenterXY(solid: string, y: number): [number, number] {
  if (solid === "VISE") return y < 40 ? [50, -7.5] : [50, 87.5];
  return SOLID_CENTER[solid] ?? [50, 40];
}

export function createSparks(
  x: number,
  y: number,
  z: number,
  solid: string,
): SparkBurst {
  const positions = new Float32Array(SPARK_COUNT * 3);
  const velocities = new Float32Array(SPARK_COUNT * 3);
  const colors = new Float32Array(SPARK_COUNT * 3);
  const lifetimes = new Float32Array(SPARK_COUNT);

  const [cx, cy] = solidCenterXY(solid, y);
  let ax = x - cx;
  let ay = y - cy;
  const alen = Math.hypot(ax, ay);
  if (alen > 1e-6) {
    ax /= alen;
    ay /= alen;
  } else {
    ax = 1;
    ay = 0;
  }

  for (let i = 0; i < SPARK_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    // Random outward direction, biased upward and away from the solid.
    const dx = Math.cos(theta) * r + ax * 0.9;
    const dy = Math.sin(theta) * r + ay * 0.9;
    const dz = Math.random() * 1.2 + 0.25;
    const len = Math.hypot(dx, dy, dz) || 1;
    const speed =
      SPARK_MIN_SPEED + Math.random() * (SPARK_MAX_SPEED - SPARK_MIN_SPEED);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    velocities[i * 3] = (dx / len) * speed;
    velocities[i * 3 + 1] = (dy / len) * speed;
    velocities[i * 3 + 2] = (dz / len) * speed;
    const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
    lifetimes[i] = 0.5 + Math.random() * 0.4;
  }

  return { positions, velocities, colors, lifetimes };
}
