"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  createSparks,
  SPARK_COUNT,
  SPARK_GRAVITY,
} from "../../lib/sparks";
import s from "../../app/landing.module.css";

const HOME: V3m = [0, 0, 120];

type V3m = [number, number, number];

const toScene = (x: number, y: number, z: number): [number, number, number] => [
  x - 175,
  z + 60,
  -(y - 40),
];
const boxSize = (
  sx: number,
  sy: number,
  sz: number,
): [number, number, number] => [sx, sz, sy];

const RAPID_SPEED = 230; // mm/s
const FEED_SPEED = 55; // mm/s
const END_HOLD_S = 1.8;
const CRASH_HOLD_S = 3.6;
const MAX_LIFE = 0.9;

interface Seg {
  p0: V3m;
  p1: V3m;
  dur: number;
  rapid: boolean;
  strip: number; // machined-strip index revealed by this seg, -1 = none
}

interface TickLine {
  n: number;
  code: string;
}

const TICKER1: TickLine[] = [
  { n: 6, code: "G00 X5. Y5." },
  { n: 7, code: "G43 Z25. H01" },
  { n: 8, code: "G00 Z5." },
  { n: 9, code: "G01 Z-1. F300" },
  { n: 10, code: "G01 X105. F800" },
  { n: 11, code: "G01 Y13." },
  { n: 12, code: "G01 X5." },
  { n: 13, code: "G01 Y21." },
  { n: 14, code: "G01 X105." },
  { n: 15, code: "G00 Z25." },
  { n: 18, code: "G28 Z0." },
];

const TICKER2: TickLine[] = TICKER1.map((l) =>
  l.n === 7 ? { ...l, code: "G00 Z25. M08" } : l,
);

function seg(p0: V3m, p1: V3m, rapid: boolean, strip = -1): Seg {
  const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  return { p0, p1, dur: dist / (rapid ? RAPID_SPEED : FEED_SPEED), rapid, strip };
}

// Run 1: the GOOD facing program. Tool starts at X0 Y0 Z120.
const RUN1: Seg[] = [
  seg([0, 0, 120], [5, 5, 120], true),
  seg([5, 5, 120], [5, 5, 25], true),
  seg([5, 5, 25], [5, 5, 5], true),
  seg([5, 5, 5], [5, 5, -1], false),
  seg([5, 5, -1], [105, 5, -1], false, 0),
  seg([105, 5, -1], [105, 13, -1], false),
  seg([105, 13, -1], [5, 13, -1], false, 1),
  seg([5, 13, -1], [5, 21, -1], false),
  seg([5, 21, -1], [105, 21, -1], false, 2),
  seg([105, 21, -1], [105, 21, 25], true),
  seg([105, 21, 25], [105, 21, 120], true),
];

// Run 2: line 7 without G43 — the tool rapids down and stops at Z0.
const RUN2: Seg[] = [
  seg([0, 0, 120], [5, 5, 120], true),
  seg([5, 5, 120], [5, 5, 0], true),
];
const CRASH_AT: V3m = [5, 5, 0];

const T1 = RUN1.reduce((a, sg) => a + sg.dur, 0);
const T2 = RUN2.reduce((a, sg) => a + sg.dur, 0);
const CYCLE = T1 + END_HOLD_S + T2 + CRASH_HOLD_S;

type Phase = "run1" | "end1" | "run2" | "crash";

interface ScenePush {
  pos: V3m;
  tick: number;
  phase: Phase;
  strips: number;
  run2: boolean;
}

interface SceneApi {
  push: (s: ScenePush) => void;
  onCrash: () => void;
}

function datum(o: V3m) {
  return toScene(o[0], o[1], o[2]);
}

function Scene({
  api,
  frozen,
  parked,
}: {
  api: SceneApi;
  frozen: boolean;
  parked: V3m | null;
}) {
  const tip = useRef<V3m>([0, 0, 120]);
  const elapsed = useRef(0);
  const last = useRef({ tick: -1, phase: "" as string, strips: -1, run2: false });
  const crashed = useRef(false);
  const toolRef = useRef<THREE.Group>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [flashOn, setFlashOn] = useState(false);
  const [sparkKey, setSparkKey] = useState(0);
  const [stripsShown, setStripsShown] = useState(0);
  const spark = useRef<{ vel: Float32Array; t: number } | null>(null);
  const ptsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(SPARK_COUNT * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    g.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(SPARK_COUNT * 3), 3),
    );
    return g;
  }, []);
  useEffect(() => () => geom.dispose(), [geom]);

  // Flash the stock red three times on crash.
  useEffect(() => {
    if (flashKey === 0) return;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      if (n >= 7) {
        clearInterval(id);
        setFlashOn(false);
      } else {
        setFlashOn(n % 2 === 1);
      }
    }, 220);
    return () => {
      clearInterval(id);
      setFlashOn(false);
    };
  }, [flashKey]);

  // Ignite sparks at the impact point.
  useEffect(() => {
    if (sparkKey === 0) return;
    const s = createSparks(CRASH_AT[0], CRASH_AT[1], CRASH_AT[2], "STOCK");
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const vel = new Float32Array(SPARK_COUNT * 3);
    for (let i = 0; i < SPARK_COUNT; i++) {
      arr[i * 3] = s.positions[i * 3] - 175;
      arr[i * 3 + 1] = s.positions[i * 3 + 2] + 60;
      arr[i * 3 + 2] = -(s.positions[i * 3 + 1] - 40);
      vel[i * 3] = s.velocities[i * 3];
      vel[i * 3 + 1] = s.velocities[i * 3 + 2];
      vel[i * 3 + 2] = -s.velocities[i * 3 + 1];
    }
    (geom.getAttribute("color") as THREE.BufferAttribute).array.set(s.colors);
    pos.needsUpdate = true;
    geom.getAttribute("color").needsUpdate = true;
    spark.current = { vel, t: 0 };
    if (ptsRef.current) ptsRef.current.visible = true;
    if (matRef.current) matRef.current.opacity = 1;
  }, [sparkKey, geom]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    // Sparks always animate (they finish in under a second).
    const sp = spark.current;
    if (sp) {
      sp.t += dt;
      const pos = geom.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < SPARK_COUNT; i++) {
        sp.vel[i * 3 + 1] -= SPARK_GRAVITY * dt;
        arr[i * 3] += sp.vel[i * 3] * dt;
        arr[i * 3 + 1] += sp.vel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += sp.vel[i * 3 + 2] * dt;
      }
      pos.needsUpdate = true;
      if (matRef.current) {
        matRef.current.opacity = Math.max(0, 1 - sp.t / MAX_LIFE);
      }
      if (sp.t >= MAX_LIFE) {
        spark.current = null;
        if (ptsRef.current) ptsRef.current.visible = false;
      }
    }
    if (frozen) return;
    elapsed.current += dt;
    const t = elapsed.current % CYCLE;

    let phase: Phase;
    let segs: Seg[];
    let local: number;
    if (t < T1) {
      phase = "run1";
      segs = RUN1;
      local = t;
    } else if (t < T1 + END_HOLD_S) {
      phase = "end1";
      segs = RUN1;
      local = T1;
    } else if (t < T1 + END_HOLD_S + T2) {
      phase = "run2";
      segs = RUN2;
      local = t - T1 - END_HOLD_S;
    } else {
      phase = "crash";
      segs = RUN2;
      local = T2;
    }

    // Walk segments to find position, ticker line, completed strips.
    let acc = 0;
    let segIdx = segs.length - 1;
    let strips = 0;
    for (let i = 0; i < segs.length; i++) {
      if (local < acc + segs[i].dur || i === segs.length - 1) {
        segIdx = i;
        const f = segs[i].dur > 0 ? Math.min(1, (local - acc) / segs[i].dur) : 1;
        const p0 = segs[i].p0;
        const p1 = segs[i].p1;
        tip.current = [
          p0[0] + (p1[0] - p0[0]) * f,
          p0[1] + (p1[1] - p0[1]) * f,
          p0[2] + (p1[2] - p0[2]) * f,
        ];
        break;
      }
      acc += segs[i].dur;
      if (segs[i].strip >= 0) strips = Math.max(strips, segs[i].strip + 1);
    }
    if (phase === "end1") strips = 3;
    if (phase === "crash") {
      if (!crashed.current) {
        crashed.current = true;
        setFlashKey((k) => k + 1);
        setSparkKey((k) => k + 1);
        api.onCrash();
      }
    } else if (crashed.current && phase === "run1") {
      crashed.current = false;
    }

    if (toolRef.current) {
      toolRef.current.position.set(...toScene(tip.current[0], tip.current[1], tip.current[2]));
    }
    const L = last.current;
    if (segIdx !== L.tick || phase !== L.phase || strips !== L.strips) {
      L.tick = segIdx;
      L.phase = phase;
      L.strips = strips;
      setStripsShown(strips);
      api.push({
        pos: [...tip.current] as V3m,
        tick: segIdx,
        phase,
        strips,
        run2: phase === "run2" || phase === "crash",
      });
    }
  });

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[150, 250, 180]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      {/* Table */}
      <mesh position={toScene(50, 40, -50)} receiveShadow>
        <boxGeometry args={boxSize(500, 280, 20)} />
        <meshStandardMaterial color="#374151" roughness={0.8} metalness={0.2} />
      </mesh>
      {/* Vise jaws */}
      <mesh position={toScene(50, -7.5, -25)} castShadow receiveShadow>
        <boxGeometry args={boxSize(120, 15, 30)} />
        <meshStandardMaterial color="#9ca3af" roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={toScene(50, 87.5, -25)} castShadow receiveShadow>
        <boxGeometry args={boxSize(120, 15, 30)} />
        <meshStandardMaterial color="#9ca3af" roughness={0.6} metalness={0.4} />
      </mesh>
      {/* Stock X 0..100 Y 0..80 Z -30..0 */}
      <mesh position={toScene(50, 40, -15)} castShadow receiveShadow>
        <boxGeometry args={boxSize(100, 80, 30)} />
        <meshStandardMaterial
          color={flashOn ? "#ef4444" : "#2563eb"}
          roughness={0.5}
          metalness={0.1}
        />
      </mesh>
      {/* Machined strips on the stock top */}
      {[5, 13, 21].map(
        (y, i) =>
          i < stripsShown && (
            <mesh key={y} position={toScene(55, y, 0.3)}>
              <boxGeometry args={boxSize(100, 10, 0.6)} />
              <meshStandardMaterial color="#c9d4da" roughness={0.4} metalness={0.3} />
            </mesh>
          ),
      )}
      {/* G54 datum: sphere + 30 mm triad at the stock top front-left */}
      <mesh position={datum([0, 0, 0])}>
        <sphereGeometry args={[3, 16, 16]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <Line points={[datum([0, 0, 0]), datum([30, 0, 0])]} color="#ef4444" lineWidth={2} />
      <Line points={[datum([0, 0, 0]), datum([0, 30, 0])]} color="#22c55e" lineWidth={2} />
      <Line points={[datum([0, 0, 0]), datum([0, 0, 30])]} color="#3b82f6" lineWidth={2} />
      <Html position={datum([0, 0, 16])} center className="pointer-events-none select-none">
        <div className="whitespace-nowrap rounded bg-green-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
          G54
        </div>
      </Html>
      {/* Tool + holder + spindle head */}
      {/* Frozen park position (reduced-motion still frame); useFrame owns it otherwise. */}
      <group ref={toolRef} position={toScene(...(parked ?? HOME))}>
        <mesh position={[0, 25, 0]} castShadow>
          <cylinderGeometry args={[5, 5, 50, 24]} />
          <meshStandardMaterial color="#D9A066" metalness={0.9} roughness={0.3} />
        </mesh>
        <mesh position={[0, 70, 0]} castShadow>
          <cylinderGeometry args={[20, 20, 40, 24]} />
          <meshStandardMaterial color="#C49060" metalness={0.7} roughness={0.45} />
        </mesh>
        <mesh position={[0, 115, 0]} castShadow>
          <boxGeometry args={[70, 50, 70]} />
          <meshStandardMaterial color="#1f2937" metalness={0.5} roughness={0.6} />
        </mesh>
      </group>
      <points ref={ptsRef} geometry={geom} visible={false} frustumCulled={false}>
        <pointsMaterial
          ref={matRef}
          size={2.5}
          vertexColors
          transparent
          opacity={1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
    </>
  );
}

export default function MiniMachine() {
  const [reduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [visible, setVisible] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Push-driven DOM mirrors; Scene only calls these on real changes.
  const [pos, setPos] = useState<V3m>([0, 0, 120]);
  const [tick, setTick] = useState(0);
  const [phase, setPhase] = useState<Phase>("run1");
  const [run2, setRun2] = useState(false);
  const lastPosAt = useRef(0);

  const api = useMemo<SceneApi>(
    () => ({
      push: (p) => {
        setTick(p.tick);
        setPhase(p.phase);
        setRun2(p.run2);
        const now = performance.now();
        if (now - lastPosAt.current > 100) {
          lastPosAt.current = now;
          setPos(p.pos);
        }
      },
      // Crash visuals (sparks, red flash) live inside the scene.
      onCrash: () => {},
    }),
    [],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const ob = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.05 },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  const lines = run2 ? TICKER2 : TICKER1;
  // 5-line window around the current line.
  const start = Math.max(0, Math.min(tick - 2, lines.length - 5));
  const window5 = lines.slice(start, start + 5);
  const crashTick = run2 ? 1 : -1;

  const shownPos: V3m = reduced ? [55, 5, -1] : pos;
  const shownTick = reduced ? 4 : tick;

  const chip =
    phase === "crash"
      ? { text: "Crash · MISSING_G43 · line 7", tone: "crash" }
      : phase === "end1"
        ? { text: "Program end M30", tone: "ok" }
        : run2 || phase === "run2"
          ? { text: "Run 2 · G43 missing on line 7", tone: "run" }
          : { text: "Run 1 · Correct program", tone: "run" };
  const sub = reduced
    ? "Animation paused (reduced motion)"
    : chip.text.startsWith("Run 1")
      ? "Facing the top of the part, 1 mm deep"
      : chip.text.startsWith("Run 2")
        ? "Tool length offset not applied after the tool change"
        : chip.text.startsWith("Crash")
          ? ""
          : "Facing the top of the part, 1 mm deep";

  return (
    <div ref={wrapRef}>
      <div className={s.previewBox}>
        <Canvas
          shadows
          camera={{ position: [170, 150, 200], fov: 45, near: 1, far: 2000 }}
          gl={{ antialias: true, alpha: true }}
          frameloop={visible && !reduced ? "always" : "never"}
          style={{ touchAction: "pan-y" }}
        >
          <Scene
            api={api}
            frozen={!visible || reduced}
            parked={reduced ? [55, 5, -1] : null}
          />
          <OrbitControls
            target={toScene(50, 40, -15)}
            makeDefault
            enableZoom={false}
            enablePan={false}
          />
        </Canvas>
        <div className={s.statusChip}>
          <span
            className={`${s.statusLabel} ${chip.tone === "crash" ? s.statusLabelCrash : chip.tone === "ok" ? s.statusLabelOk : ""}`}
          >
            {chip.text}
          </span>
          {sub !== "" && <p className={s.statusSub}>{sub}</p>}
          {phase === "crash" && (
            <p className={s.statusRepair}>
              Repair ₹40,000 to ₹4,50,000 · 48 h downtime
            </p>
          )}
        </div>
      </div>
      <div className={s.previewMeta}>
        <ol className={s.ticker} aria-label="Program">
          {window5.map((l, i) => {
            const gi = start + i;
            const isCrashLine = run2 && gi === crashTick && phase === "crash";
            return (
              <li
                key={`${l.n}-${i}`}
                className={
                  isCrashLine ? s.crashed : gi === shownTick ? s.current : ""
                }
              >
                <span className={s.ln}>{l.n}</span>
                <span>{l.code}</span>
              </li>
            );
          })}
        </ol>
        <div className={s.readout}>
          <div className={s.readoutTitle}>Tool tip, G54 (mm)</div>
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <div key={axis} className={s.readoutRow}>
              <span>{axis}</span>
              <span>{shownPos[i].toFixed(3)}</span>
            </div>
          ))}
        </div>
      </div>
      <p className={s.caption}>
        Miniature of the app&apos;s machine cell: table, vise, aluminium stock
        and a 10 mm end mill. Green marker: G54 part zero. Drag to rotate.
      </p>
    </div>
  );
}
