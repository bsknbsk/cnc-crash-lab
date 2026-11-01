"use client";

import { useEffect, useRef, useState } from "react";
import Machine, { setToolTip, type FlashState } from "../components/Machine";
import { GOOD, VARIANTS } from "../data/samples";
import { runSteps, simulate, type SimStep } from "../lib/sim/index";
import type { CrashEvent } from "../lib/sim/types";

const PROGRAMS: Record<string, string> = { GOOD, ...VARIANTS };
const PROGRAM_NAMES = ["GOOD", ...Object.keys(VARIANTS)];

// Editor metrics: text-sm (14px) + leading-6 (24px) + py-3 (12px top pad).
const LINE_H = 24;
const PAD_TOP = 12;

// runSteps samples the path every 0.5 mm, so 2 steps = 1 mm (G01 feed)
// and 8 steps = 4 mm (G00 rapid) per animation frame.
const FEED_STRIDE = 2;
const RAPID_STRIDE = 8;

interface TraceStep {
  name: string;
  arguments: unknown;
  summary: string;
}

function shortArgs(value: unknown): string {
  const flat = (JSON.stringify(value) ?? "").replace(/\s+/g, " ");
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
}

function extractFixedProgram(debrief: string): string | null {
  const m = debrief.match(/```(?:gcode)?\s*\n?([\s\S]*?)```/);
  const program = m?.[1].trim();
  return program ? program : null;
}

export default function Home() {
  const [code, setCode] = useState(GOOD);
  const [programName, setProgramName] = useState("GOOD");
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [crash, setCrash] = useState<CrashEvent | null>(null);
  const [flash, setFlash] = useState<FlashState>({ solid: null, key: 0 });
  const [running, setRunning] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [asking, setAsking] = useState(false);
  const [trace, setTrace] = useState<TraceStep[] | null>(null);
  const [debrief, setDebrief] = useState<string | null>(null);

  const gutterRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const stepsRef = useRef<SimStep[] | null>(null);
  const crashRef = useRef<CrashEvent | null>(null);
  const sessionCodeRef = useRef<string | null>(null);
  const nextLineRef = useRef(1);
  const frameRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const runningRef = useRef(false);

  const lineCount = code.split("\n").length;

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  const cancelAnimation = () => {
    cancelledRef.current = true;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    runningRef.current = false;
    setRunning(false);
  };

  // Play a list of 0.5 mm steps, advancing 1 mm/frame on feed moves and
  // 4 mm/frame on rapids. The tool + holder follow via setToolTip.
  const playSteps = (steps: SimStep[], done: () => void) => {
    if (steps.length === 0) {
      done();
      return;
    }
    cancelledRef.current = false;
    runningRef.current = true;
    setRunning(true);
    let i = 0;
    let lastLine = -1;
    const tick = () => {
      if (cancelledRef.current) return;
      const s = steps[i];
      setToolTip(s.x, s.y, s.z);
      if (s.line !== lastLine) {
        lastLine = s.line;
        setActiveLine(s.line);
      }
      const ni = i + (s.motion === "RAPID" ? RAPID_STRIDE : FEED_STRIDE);
      if (ni >= steps.length) {
        const last = steps[steps.length - 1];
        setToolTip(last.x, last.y, last.z);
        setActiveLine(last.line);
        frameRef.current = null;
        runningRef.current = false;
        setRunning(false);
        done();
        return;
      }
      i = ni;
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  };

  const resetState = () => {
    cancelAnimation();
    setActiveLine(null);
    setCrash(null);
    setFlash({ solid: null, key: 0 });
    setAsking(false);
    setTrace(null);
    setDebrief(null);
    stepsRef.current = null;
    crashRef.current = null;
    sessionCodeRef.current = null;
    nextLineRef.current = 1;
  };

  const showCrash = (c: CrashEvent) => {
    setCrash(c);
    setActiveLine(c.line);
    setFlash({ solid: c.collidedWith, key: Date.now() });
    setAsking(false);
    setTrace(null);
    setDebrief(null);
  };

  const handleAsk = async () => {
    if (!crash || asking) return;
    setAsking(true);
    setTrace(null);
    setDebrief(null);
    try {
      const res = await fetch("/api/instructor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program: code, crash }),
      });
      const data = (await res.json()) as {
        trace?: TraceStep[];
        debrief?: string;
      };
      setTrace(data.trace ?? []);
      setDebrief(data.debrief ?? "");
    } catch {
      setDebrief("Instructor request failed. Check the server and try again.");
    } finally {
      setAsking(false);
    }
  };

  const handleLoadFixed = () => {
    if (!debrief) return;
    const fixed = extractFixedProgram(debrief);
    if (!fixed) return;
    resetState();
    setProgramName("CUSTOM");
    setCode(fixed);
    setToolTip(0, 0, 200);
  };

  const handleCycleStart = () => {
    if (runningRef.current) return;
    resetState();
    const result = simulate(code);
    const steps = runSteps(code);
    stepsRef.current = steps;
    crashRef.current = result.crash;
    sessionCodeRef.current = code;
    playSteps(steps, () => {
      nextLineRef.current = code.split("\n").length + 1;
      if (crashRef.current) showCrash(crashRef.current);
    });
  };

  const handleSingleBlock = () => {
    if (runningRef.current) return;
    if (sessionCodeRef.current !== code) {
      resetState();
      const result = simulate(code);
      stepsRef.current = runSteps(code);
      crashRef.current = result.crash;
      sessionCodeRef.current = code;
    }
    const total = code.split("\n").length;
    const line = nextLineRef.current;
    if (line > total) return;
    if (crashRef.current && line > crashRef.current.line) return;
    setActiveLine(line);
    const segs = (stepsRef.current ?? []).filter((s) => s.line === line);
    nextLineRef.current = line + 1;
    if (segs.length === 0) {
      if (crashRef.current && line >= crashRef.current.line) {
        showCrash(crashRef.current);
      }
      return;
    }
    playSteps(segs, () => {
      if (crashRef.current && line >= crashRef.current.line) {
        showCrash(crashRef.current);
      }
    });
  };

  const handleReset = () => {
    resetState();
    setToolTip(0, 0, 200);
  };

  const handleSelectProgram = (name: string) => {
    resetState();
    setProgramName(name);
    setCode(PROGRAMS[name]);
    setToolTip(0, 0, 200);
  };

  const handleCodeChange = (value: string) => {
    cancelAnimation();
    setCode(value);
    setProgramName("CUSTOM");
    setActiveLine(null);
    setCrash(null);
    setFlash({ solid: null, key: 0 });
    setAsking(false);
    setTrace(null);
    setDebrief(null);
    stepsRef.current = null;
    crashRef.current = null;
    sessionCodeRef.current = null;
    nextLineRef.current = 1;
  };

  const syncScroll = () => {
    if (gutterRef.current && areaRef.current) {
      gutterRef.current.scrollTop = areaRef.current.scrollTop;
      setScrollTop(areaRef.current.scrollTop);
    }
  };

  return (
    <main className="flex h-screen w-full">
      {/* Left 40%: program select + editor + control panel */}
      <section className="flex w-[40%] flex-col border-r border-zinc-800 bg-zinc-950">
        <header className="border-b border-zinc-800 px-4 py-2">
          <h1 className="font-mono text-sm font-semibold text-zinc-100">
            CNC Crash Lab
          </h1>
          <p className="font-mono text-xs text-zinc-500">
            Fanuc 0i style · G21 · mm
          </p>
        </header>

        {/* Program dropdown */}
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
          <label
            htmlFor="program-select"
            className="font-mono text-xs text-zinc-400"
          >
            Program
          </label>
          <select
            id="program-select"
            value={programName}
            onChange={(e) => handleSelectProgram(e.target.value)}
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 outline-none"
          >
            {PROGRAM_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {programName === "CUSTOM" && (
              <option value="CUSTOM">Custom (edited)</option>
            )}
          </select>
        </div>

        {/* G-code editor with line numbers */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div
            ref={gutterRef}
            className="w-12 shrink-0 overflow-hidden bg-zinc-900 py-3 text-right font-mono text-sm leading-6 text-zinc-500 select-none"
            aria-hidden
          >
            {Array.from({ length: lineCount }, (_, i) => {
              const n = i + 1;
              const isCrash = crash !== null && crash.line === n;
              const isActive = activeLine === n && !isCrash;
              return (
                <div
                  key={i}
                  className={`pr-3 ${
                    isCrash
                      ? "bg-red-500/30 font-bold text-red-300"
                      : isActive
                        ? "bg-emerald-500/20 text-emerald-300"
                        : ""
                  }`}
                >
                  {n}
                </div>
              );
            })}
          </div>
          <div className="relative min-w-0 flex-1 bg-zinc-950">
            {/* Current-line highlight behind the transparent textarea */}
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden"
              aria-hidden
            >
              <div style={{ transform: `translateY(${-scrollTop}px)` }}>
                {activeLine !== null &&
                  activeLine >= 1 &&
                  activeLine <= lineCount && (
                    <div
                      className={
                        crash !== null && crash.line === activeLine
                          ? "bg-red-500/30"
                          : "bg-emerald-500/20"
                      }
                      style={{
                        marginTop: PAD_TOP + (activeLine - 1) * LINE_H,
                        height: LINE_H,
                      }}
                    />
                  )}
              </div>
            </div>
            <textarea
              ref={areaRef}
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              onScroll={syncScroll}
              spellCheck={false}
              wrap="off"
              className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent py-3 pl-3 font-mono text-sm leading-6 whitespace-pre text-zinc-100 outline-none"
              aria-label="G-code editor"
            />
          </div>
        </div>

        {/* Control panel */}
        <div className="flex gap-2 border-t border-zinc-800 p-3">
          <button
            type="button"
            onClick={handleCycleStart}
            disabled={running}
            className="flex-1 rounded bg-green-600 px-3 py-2 font-mono text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
          >
            Cycle Start
          </button>
          <button
            type="button"
            onClick={handleSingleBlock}
            disabled={running}
            className="flex-1 rounded bg-amber-600 px-3 py-2 font-mono text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
          >
            Single Block
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="flex-1 rounded bg-zinc-700 px-3 py-2 font-mono text-sm font-semibold text-white hover:bg-zinc-600"
          >
            Reset
          </button>
        </div>
      </section>

      {/* Right 60%: 3D machine view */}
      <section className="relative w-[60%] bg-black">
        <Machine flash={flash} />
        {crash && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-6">
            <div className="pointer-events-auto max-h-[85vh] w-[28rem] overflow-y-auto rounded-lg border border-red-600 bg-zinc-950/95 p-4 shadow-2xl">
              <h2 className="font-mono text-sm font-bold text-red-400">
                CRASH · {crash.type}
              </h2>
              <p className="mt-1 font-mono text-xs text-zinc-300">
                Line {crash.line}
              </p>
              <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-2 font-mono text-xs text-zinc-100">
                {crash.block}
              </pre>
              <button
                type="button"
                onClick={handleAsk}
                disabled={asking}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded bg-sky-600 px-3 py-2 font-mono text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
              >
                {asking && (
                  <span
                    aria-hidden
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                  />
                )}
                {asking ? "Asking…" : "Ask the Instructor"}
              </button>
              {trace && trace.length > 0 && (
                <ol className="mt-3 list-decimal space-y-1 pl-5 font-mono text-base text-zinc-200">
                  {trace.map((t, i) => (
                    <li key={i} className="break-words">
                      <span className="text-sky-300">{t.name}</span>
                      <span className="text-zinc-500">
                        {" "}
                        {shortArgs(t.arguments)}
                      </span>
                      <span> → {t.summary}</span>
                    </li>
                  ))}
                </ol>
              )}
              {debrief !== null && (
                <pre className="mt-3 rounded bg-zinc-900 p-2 font-mono text-xs whitespace-pre-wrap text-zinc-100">
                  {debrief}
                </pre>
              )}
              {debrief && extractFixedProgram(debrief) && (
                <button
                  type="button"
                  onClick={handleLoadFixed}
                  className="mt-3 w-full rounded bg-green-600 px-3 py-2 font-mono text-sm font-semibold text-white hover:bg-green-500"
                >
                  Load fixed program
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
