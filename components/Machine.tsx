"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { createSparks, SPARK_COUNT, SPARK_GRAVITY } from "../lib/sparks";

// ---------------------------------------------------------------------------
// Machine coordinate system (mm, 1 unit = 1 mm):
//   X right, Y back, Z up.
//   G54 work zero = front-left corner of the stock top surface (0, 0, 0).
// three.js is Y-up with +Z toward the viewer (front of machine), so a
// machine point [x, y, z] renders at three.js [x, z, -y], and a machine
// box size [sx, sy, sz] becomes three.js args [sx, sz, sy].
// ---------------------------------------------------------------------------

export interface ToolTip {
  x: number;
  y: number;
  z: number;
}

export const TOOL_TIP_START: ToolTip = { x: 0, y: 0, z: 200 };

export interface FlashState {
  solid: "STOCK" | "VISE" | "TABLE" | null;
  key: number;
}

// Mutable tool-tip driven by the simulator (see lib/sim). Subscribers are
// notified on every update so the 3D tool follows G-code motion.
const toolTip: ToolTip = { ...TOOL_TIP_START };
const listeners = new Set<(p: ToolTip) => void>();

export function setToolTip(x: number, y: number, z: number): void {
  toolTip.x = x;
  toolTip.y = y;
  toolTip.z = z;
  listeners.forEach((fn) => fn({ ...toolTip }));
}

function useToolTip(): ToolTip {
  const [pos, setPos] = useState<ToolTip>({ ...toolTip });
  useEffect(() => {
    const fn = (p: ToolTip) => setPos(p);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return pos;
}

type V3 = [number, number, number];

function toScene(x: number, y: number, z: number): V3 {
  return [x, z, -y];
}

function boxSize(sx: number, sy: number, sz: number): V3 {
  return [sx, sz, sy];
}

const TOOL_RADIUS = 5; // T1 flat end mill, diameter 10
const TOOL_STICKOUT = 50; // exposed length above the tip
const HOLDER_RADIUS = 20; // diameter 40
const HOLDER_HEIGHT = 40;

function Tool({ tip }: { tip: ToolTip }) {
  const toolCenter = toScene(tip.x, tip.y, tip.z + TOOL_STICKOUT / 2);
  const holderCenter = toScene(
    tip.x,
    tip.y,
    tip.z + TOOL_STICKOUT + HOLDER_HEIGHT / 2,
  );
  return (
    <group>
      {/* T1 flat end mill, light brown cylinder from tip up 50 mm */}
      <mesh position={toolCenter} castShadow>
        <cylinderGeometry args={[TOOL_RADIUS, TOOL_RADIUS, TOOL_STICKOUT, 32]} />
        <meshStandardMaterial color="#D9A066" metalness={0.9} roughness={0.3} />
      </mesh>
      {/* Holder, diameter 40 x height 40, sitting on top of the tool */}
      <mesh position={holderCenter} castShadow>
        <cylinderGeometry
          args={[HOLDER_RADIUS, HOLDER_RADIUS, HOLDER_HEIGHT, 32]}
        />
        <meshStandardMaterial color="#C49060" metalness={0.7} roughness={0.45} />
      </mesh>
    </group>
  );
}

// Stored work-offset origins in machine Z (G54 = identity).
const OFFSET_Z: Record<string, number> = { G54: 0, G55: -25 };

function Datum({
  name,
  machineZ,
  tag,
  labelClass,
}: {
  name: string;
  machineZ: number;
  tag: string;
  labelClass: string;
}) {
  const o = toScene(0, 0, machineZ);
  return (
    <group>
      <mesh position={o}>
        <sphereGeometry args={[3, 16, 16]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      {/* 30 mm triad: X red, Y green, Z blue */}
      <Line points={[o, toScene(30, 0, machineZ)]} color="#ef4444" lineWidth={2} />
      <Line points={[o, toScene(0, 30, machineZ)]} color="#22c55e" lineWidth={2} />
      <Line
        points={[o, toScene(0, 0, machineZ + 30)]}
        color="#3b82f6"
        lineWidth={2}
      />
      <Html
        position={toScene(0, 0, machineZ + 16)}
        center
        className="pointer-events-none select-none"
      >
        <div
          className={`whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] font-bold text-white ${labelClass}`}
        >
          {name} X0 Y0 Z0 ({tag})
        </div>
      </Html>
    </group>
  );
}

export interface ImpactBurst {
  x: number;
  y: number;
  z: number;
  solid: "STOCK" | "VISE" | "TABLE";
  key: number;
}

const SPARK_MAX_LIFE = 0.9;
const SHAKE_MM = 3;
const SHAKE_S = 0.4;
const FLASH_S = 0.25;

// Spark burst + point-light flash + shake. Everything advances in useFrame
// with refs only, so the animation never re-renders React.
function ImpactFX({
  burst,
  children,
}: {
  burst: ImpactBurst | null;
  children: ReactNode;
}) {
  const shakeRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const sim = useRef<{ vel: Float32Array; life: Float32Array; t: number } | null>(
    null,
  );
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

  useEffect(() => {
    if (!burst) {
      sim.current = null;
      return;
    }
    const s = createSparks(burst.x, burst.y, burst.z, burst.solid);
    // Machine space (x right, y back, z up) renders as scene [x, z, -y].
    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
    const parr = posAttr.array as Float32Array;
    const vel = new Float32Array(SPARK_COUNT * 3);
    for (let i = 0; i < SPARK_COUNT; i++) {
      parr[i * 3] = s.positions[i * 3];
      parr[i * 3 + 1] = s.positions[i * 3 + 2];
      parr[i * 3 + 2] = -s.positions[i * 3 + 1];
      vel[i * 3] = s.velocities[i * 3];
      vel[i * 3 + 1] = s.velocities[i * 3 + 2];
      vel[i * 3 + 2] = -s.velocities[i * 3 + 1];
    }
    (geom.getAttribute("color") as THREE.BufferAttribute).array.set(s.colors);
    posAttr.needsUpdate = true;
    geom.getAttribute("color").needsUpdate = true;
    sim.current = { vel, life: s.lifetimes, t: 0 };
    if (pointsRef.current) pointsRef.current.visible = true;
  }, [burst, geom]);

  useFrame((_, rawDt) => {
    const st = sim.current;
    if (!st) return;
    const dt = Math.min(rawDt, 0.05);
    st.t += dt;
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < SPARK_COUNT; i++) {
      if (st.t >= st.life[i]) {
        arr[i * 3 + 1] = -9999;
        continue;
      }
      st.vel[i * 3 + 1] -= SPARK_GRAVITY * dt;
      arr[i * 3] += st.vel[i * 3] * dt;
      arr[i * 3 + 1] += st.vel[i * 3 + 1] * dt;
      arr[i * 3 + 2] += st.vel[i * 3 + 2] * dt;
    }
    pos.needsUpdate = true;
    if (matRef.current) {
      matRef.current.opacity = Math.max(0, 1 - st.t / SPARK_MAX_LIFE);
    }
    if (lightRef.current) {
      lightRef.current.intensity =
        st.t < FLASH_S ? 50 * (1 - st.t / FLASH_S) : 0;
    }
    if (shakeRef.current) {
      if (st.t < SHAKE_S) {
        const a = SHAKE_MM * (1 - st.t / SHAKE_S);
        shakeRef.current.position.set(
          (Math.random() - 0.5) * 2 * a,
          (Math.random() - 0.5) * 2 * a,
          (Math.random() - 0.5) * 2 * a,
        );
      } else {
        shakeRef.current.position.set(0, 0, 0);
      }
    }
    if (st.t >= SPARK_MAX_LIFE) {
      sim.current = null;
      if (pointsRef.current) pointsRef.current.visible = false;
      if (lightRef.current) lightRef.current.intensity = 0;
      if (shakeRef.current) shakeRef.current.position.set(0, 0, 0);
    }
  });

  const at: V3 = burst ? toScene(burst.x, burst.y, burst.z) : [0, 0, 0];
  return (
    <group ref={shakeRef}>
      {children}
      <points
        ref={pointsRef}
        geometry={geom}
        visible={false}
        frustumCulled={false}
      >
        <pointsMaterial
          ref={matRef}
          size={2.5}
          vertexColors
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
      <pointLight
        ref={lightRef}
        position={at}
        color="#ff9a3c"
        intensity={0}
        distance={500}
      />
    </group>
  );
}

export default function Machine({
  flash,
  activeOffset = "G54",
  burst = null,
}: {
  flash?: FlashState;
  activeOffset?: string;
  burst?: ImpactBurst | null;
}) {
  const tip = useToolTip();
  const [flashOn, setFlashOn] = useState(false);

  // Flash the collided solid red three times when a crash arrives.
  // All state updates happen in timer callbacks so the effect body itself
  // only subscribes. Ticks 1, 3, 5 are red; tick 7 ends on dark.
  useEffect(() => {
    if (!flash || flash.solid === null || flash.key === 0) return;
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
  }, [flash]);

  const stockFlash = flashOn && flash?.solid === "STOCK";
  const viseFlash = flashOn && flash?.solid === "VISE";
  const tableFlash = flashOn && flash?.solid === "TABLE";

  const activeZ = OFFSET_Z[activeOffset] ?? 0;
  const showBuried = activeOffset !== "G54";

  return (
    <Canvas
      shadows
      camera={{ position: [-120, 180, 200], fov: 45, near: 1, far: 5000 }}
    >
      <ImpactFX burst={burst}>
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[150, 250, 180]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />

      {/* Stock: X 0..100, Y 0..80, Z -30..0, blue */}
      <mesh position={toScene(50, 40, -15)} castShadow receiveShadow>
        <boxGeometry args={boxSize(100, 80, 30)} />
        <meshStandardMaterial
          color={stockFlash ? "#ef4444" : "#2563eb"}
          emissive={stockFlash ? "#7f1d1d" : "#000000"}
          roughness={0.5}
          metalness={0.1}
          transparent={showBuried}
          opacity={showBuried ? 0.5 : 1}
        />
      </mesh>

      {/* G54 datum always at the stock top front-left corner */}
      <Datum name="G54" machineZ={0} tag="setup" labelClass="bg-green-600" />

      {/* Active non-G54 offset: buried datum + dashed drop line */}
      {showBuried && (
        <group>
          <Datum
            name={activeOffset}
            machineZ={activeZ}
            tag="ACTIVE"
            labelClass="bg-red-600"
          />
          <Line
            points={[toScene(0, 0, 0), toScene(0, 0, activeZ)]}
            color="#ef4444"
            lineWidth={2}
            dashed
            dashSize={2}
            gapSize={2}
          />
          <Html
            position={toScene(10, 0, activeZ / 2)}
            center
            className="pointer-events-none select-none"
          >
            <div className="font-mono text-[10px] font-bold whitespace-nowrap text-red-400">
              {Math.abs(activeZ)} mm
            </div>
          </Html>
        </group>
      )}

      {/* Vise jaws: X -10..110, Z -40..-10, grey */}
      {/* Front jaw: Y -15..0 */}
      <mesh position={toScene(50, -7.5, -25)} castShadow receiveShadow>
        <boxGeometry args={boxSize(120, 15, 30)} />
        <meshStandardMaterial
          color={viseFlash ? "#ef4444" : "#9ca3af"}
          emissive={viseFlash ? "#7f1d1d" : "#000000"}
          roughness={0.6}
          metalness={0.4}
        />
      </mesh>
      {/* Back jaw: Y 80..95 */}
      <mesh position={toScene(50, 87.5, -25)} castShadow receiveShadow>
        <boxGeometry args={boxSize(120, 15, 30)} />
        <meshStandardMaterial
          color={viseFlash ? "#ef4444" : "#9ca3af"}
          emissive={viseFlash ? "#7f1d1d" : "#000000"}
          roughness={0.6}
          metalness={0.4}
        />
      </mesh>

      {/* Table: X -200..300, Y -100..180, Z -60..-40, dark grey */}
      <mesh position={toScene(50, 40, -50)} receiveShadow>
        <boxGeometry args={boxSize(500, 280, 20)} />
        <meshStandardMaterial
          color={tableFlash ? "#ef4444" : "#374151"}
          emissive={tableFlash ? "#7f1d1d" : "#000000"}
          roughness={0.8}
          metalness={0.2}
        />
      </mesh>

      {/* Reference grid just above the table top (Z = -40) */}
      <gridHelper
        args={[500, 50, "#6b7280", "#4b5563"]}
        position={toScene(50, 40, -39.9)}
      />

      <Tool tip={tip} />
      </ImpactFX>

      <OrbitControls target={toScene(50, 40, -15)} makeDefault />
    </Canvas>
  );
}
