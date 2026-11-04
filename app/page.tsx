"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
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

function findActiveOffset(code: string): string {
  return code.match(/G5[4-9]/)?.[0] ?? "G54";
}

const EXAM_STORAGE_KEY = "cnc-crash-lab-exam-completed";

function loadCompletedIds(): number[] {
  try {
    const raw = localStorage.getItem(EXAM_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function saveCompletedIds(ids: number[]): void {
  try {
    localStorage.setItem(EXAM_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Private mode etc: progress just won't persist.
  }
}

function findM30Line(code: string): number | null {
  let found: number | null = null;
  code.split("\n").forEach((raw, i) => {
    const stripped = raw.replace(/\(.*?\)/g, "").trim().toUpperCase();
    if (/^M30(\s|$)/.test(stripped)) found = i + 1;
  });
  return found;
}

function parseDebriefLines(debrief: string): {
  crashLine: number | null;
  causeLine: number | null;
} {
  const crash = debrief.match(/CRASH LINE:?\s*\n?\s*line\s*(\d+)/i);
  const cause = debrief.match(/ROOT CAUSE:?\s*\n?\s*line\s*(\d+)/i);
  return {
    crashLine: crash ? Number(crash[1]) : null,
    causeLine: cause ? Number(cause[1]) : null,
  };
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
  const [causeLine, setCauseLine] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [unclearLines, setUnclearLines] = useState<number[] | null>(null);
  const [visionErrors, setVisionErrors] = useState<
    { line: number; message: string }[] | null
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"practice" | "exam">("practice");
  const [examFault, setExamFault] = useState<{
    id: number;
    changed_line: number;
    hint: string;
    model: string;
    crash_type: string;
  } | null>(null);
  const [examNote, setExamNote] = useState<{
    text: string;
    ok: boolean;
  } | null>(null);
  const [loadingExam, setLoadingExam] = useState(false);
  const [completedIds, setCompletedIds] = useState<number[]>(loadCompletedIds);
  const [examTotal, setExamTotal] = useState<number | null>(null);
  const [examAllDone, setExamAllDone] = useState(false);
  const [endNote, setEndNote] = useState<string | null>(null);
  const cycleTimeRef = useRef(0);
  const parseErrorRef = useRef(false);
  const [costMap, setCostMap] = useState<Record<
    string,
    {
      min_inr: number;
      max_inr: number;
      downtime_hours: number;
      damaged_parts: string;
    }
  > | null>(null);
  const [costFailed, setCostFailed] = useState(false);

  // Preload the whole repair-cost table once; the crash card reads from it.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cost")
      .then((res) => res.json())
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return;
        const map: NonNullable<typeof costMap> = {};
        for (const q of rows) {
          if (q && typeof q.crash_type === "string") map[q.crash_type] = q;
        }
        setCostMap(map);
      })
      .catch(() => {
        if (!cancelled) setCostFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedMs(0);
    setActiveLine(null);
    setCrash(null);
    setFlash({ solid: null, key: 0 });
    setAsking(false);
    setTrace(null);
    setDebrief(null);
    setCauseLine(null);
    setScanning(false);
    setUnclearLines(null);
    setVisionErrors(null);
    setExamNote(null);
    setEndNote(null);
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
    setCauseLine(null);
    setScanning(false);
    setUnclearLines(null);
    setVisionErrors(null);
    setExamNote(null);
    setEndNote(null);
  };

  const timerRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  const handleAsk = async () => {
    if (!crash || asking) return;
    setAsking(true);
    setTrace([]);
    setDebrief(null);
    setElapsedMs(0);
    const started = Date.now();
    timerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - started);
    }, 200);
    try {
      const res = await fetch("/api/instructor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program: code, crash }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as
            | { type: "step"; tool: string; args: unknown; summary: string }
            | { type: "done"; debrief: string }
            | { type: "error"; message: string }
            | { type: "thinking"; turn: number };
          if (ev.type === "step") {
            setTrace((prev) => [
              ...(prev ?? []),
              { name: ev.tool, arguments: ev.args, summary: ev.summary },
            ]);
          } else if (ev.type === "done") {
            setDebrief(ev.debrief);
            setCauseLine(parseDebriefLines(ev.debrief).causeLine);
          } else if (ev.type === "error") {
            setDebrief(`Instructor error: ${ev.message}`);
          }
        }
      }
    } catch {
      setDebrief("Instructor request failed. Check the server and try again.");
    } finally {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsedMs(Date.now() - started);
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
    cycleTimeRef.current = result.cycleTimeSec;
    parseErrorRef.current = result.parseErrors.length > 0;
    playSteps(steps, () => {
      nextLineRef.current = code.split("\n").length + 1;
      if (crashRef.current) {
        showCrash(crashRef.current);
        return;
      }
      if (result.parseErrors.length > 0) return;
      const m30 = findM30Line(code);
      if (m30 !== null) setActiveLine(m30);
      setEndNote(
        `Program end M30, cycle time ${result.cycleTimeSec.toFixed(1)}s`,
      );
      if (tab === "exam" && examFault) {
        if (!completedIds.includes(examFault.id)) {
          const next = [...completedIds, examFault.id];
          setCompletedIds(next);
          saveCompletedIds(next);
        }
        setExamNote({
          text: `Passed: mistake found on line ${examFault.changed_line}`,
          ok: true,
        });
      }
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
      cycleTimeRef.current = result.cycleTimeSec;
      parseErrorRef.current = result.parseErrors.length > 0;
    }
    const total = code.split("\n").length;
    const line = nextLineRef.current;
    if (line > total) return;
    if (crashRef.current && line > crashRef.current.line) return;
    setActiveLine(line);
    if (
      !crashRef.current &&
      !parseErrorRef.current &&
      line === findM30Line(code)
    ) {
      setEndNote(
        `Program end M30, cycle time ${cycleTimeRef.current.toFixed(1)}s`,
      );
    }
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
    setTab("practice");
    setExamFault(null);
    setProgramName(name);
    setCode(PROGRAMS[name]);
    setToolTip(0, 0, 200);
  };

  const handleCodeChange = (value: string) => {
    cancelAnimation();
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedMs(0);
    setCode(value);
    setProgramName("CUSTOM");
    setActiveLine(null);
    setCrash(null);
    setFlash({ solid: null, key: 0 });
    setAsking(false);
    setTrace(null);
    setDebrief(null);
    setCauseLine(null);
    setScanning(false);
    setUnclearLines(null);
    setVisionErrors(null);
    setExamNote(null);
    setEndNote(null);
    stepsRef.current = null;
    crashRef.current = null;
    sessionCodeRef.current = null;
    nextLineRef.current = 1;
  };

  async function shrinkPhoto(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas context");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) throw new Error("JPEG encoding failed");
    return blob;
  }

  const handleScan = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || scanning) return;
    setScanning(true);
    try {
      const photo = await shrinkPhoto(file);
      const form = new FormData();
      form.append("image", photo, "sheet.jpg");
      const res = await fetch("/api/vision", { method: "POST", body: form });
      const data = (await res.json()) as {
        program?: string;
        unclear_lines?: number[];
        parseErrors?: { line: number; message: string }[];
        error?: string;
      };
      if (!res.ok || data.error || typeof data.program !== "string") {
        throw new Error(data.error ?? "Scan failed");
      }
      resetState();
      setTab("practice");
      setExamFault(null);
      setProgramName("CUSTOM");
      setCode(data.program);
      setUnclearLines(data.unclear_lines ?? []);
      setVisionErrors(data.parseErrors ?? []);
    } catch {
      setVisionErrors([
        { line: 0, message: "Scan failed. Try a clearer photo." },
      ]);
    } finally {
      setScanning(false);
    }
  };

  const handleNewQuestion = async () => {
    if (loadingExam) return;
    setLoadingExam(true);
    try {
      const res = await fetch(
        `/api/exam?exclude=${completedIds.join(",")}`,
      );
      const data = (await res.json()) as {
        question?: {
          id: number;
          faulty_program: string;
          changed_line: number;
          hint: string;
          model: string;
          crash_type: string;
        } | null;
        total?: number;
        error?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "No exam questions");
      }
      if (typeof data.total === "number") setExamTotal(data.total);
      if (!data.question) {
        setExamAllDone(true);
        setExamNote({ text: "All questions completed", ok: true });
        return;
      }
      resetState();
      setTab("exam");
      setExamAllDone(false);
      setProgramName("CUSTOM");
      setCode(data.question.faulty_program);
      setExamFault({
        id: data.question.id,
        changed_line: data.question.changed_line,
        hint: data.question.hint,
        model: data.question.model,
        crash_type: data.question.crash_type,
      });
      setToolTip(0, 0, 200);
    } catch {
      setExamNote({ text: "No exam questions yet. Generate faults first.", ok: false });
    } finally {
      setLoadingExam(false);
    }
  };

  const handleResetProgress = () => {
    setCompletedIds([]);
    saveCompletedIds([]);
    setExamAllDone(false);
    setExamNote(null);
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
            ISO Programming · G21 · mm
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
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={scanning}
            className="flex shrink-0 items-center gap-2 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 hover:bg-zinc-800 disabled:opacity-60"
          >
            {scanning && (
              <span
                aria-hidden
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-100 border-t-transparent"
              />
            )}
            {scanning ? "Scanning…" : "Scan program sheet"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleScan}
            aria-label="Scan program sheet"
          />
        </div>

        {/* Practice / Exam tabs */}
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
          {(["practice", "exam"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setExamNote(null);
              }}
              className={`rounded px-3 py-1 font-mono text-xs font-semibold ${
                tab === t
                  ? "bg-zinc-100 text-zinc-900"
                  : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              {t === "practice" ? "Practice" : "Exam"}
            </button>
          ))}
          {tab === "exam" && (
            <button
              type="button"
              onClick={handleNewQuestion}
              disabled={loadingExam}
              className="flex shrink-0 items-center gap-2 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 hover:bg-zinc-800 disabled:opacity-60"
            >
              {loadingExam && (
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-100 border-t-transparent"
                />
              )}
              {loadingExam ? "Loading…" : "New question"}
            </button>
          )}
          {tab === "exam" && (
            <span className="ml-auto font-mono text-xs text-zinc-400">
              Questions completed: {completedIds.length} /{" "}
              {examTotal ?? "…"}
            </span>
          )}
          {tab === "exam" && examAllDone && (
            <button
              type="button"
              onClick={handleResetProgress}
              className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 hover:bg-zinc-800"
            >
              Reset progress
            </button>
          )}
        </div>
        {tab === "exam" && (
          <div className="border-b border-zinc-800 px-4 py-2">
            {examAllDone ? (
              <p className="font-mono text-xs font-semibold text-green-400">
                All questions completed
              </p>
            ) : examFault ? (
              <>
                <p className="font-mono text-[13px] text-gray-100">
                  Hint: {examFault.hint}
                </p>
                <p className="mt-1 font-mono text-xs text-gray-300">
                  Model: {examFault.model} · Find the injected fault, fix it in
                  the editor, then press Cycle Start.
                </p>
              </>
            ) : (
              <p className="font-mono text-xs text-zinc-500">
                Press New question to load a faulty program.
              </p>
            )}
          </div>
        )}

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
              const isMarked =
                (debrief !== null &&
                  causeLine !== null &&
                  causeLine === n) ||
                (unclearLines?.includes(n) ?? false);
              const isActive = activeLine === n && !isCrash && !isMarked;
              return (
                <div
                  key={i}
                  className={`pr-3 ${
                    isCrash
                      ? "bg-red-500/30 font-bold text-red-300"
                      : isMarked
                        ? "bg-amber-500/25 font-bold text-amber-300"
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
                <div
                  className="relative w-full"
                  style={{ height: PAD_TOP * 2 + lineCount * LINE_H }}
                >
                  {debrief !== null &&
                    crash !== null &&
                    crash.line >= 1 &&
                    crash.line <= lineCount && (
                      <div
                        className="absolute inset-x-0 bg-red-500/30"
                        style={{
                          top: PAD_TOP + (crash.line - 1) * LINE_H,
                          height: LINE_H,
                        }}
                      />
                    )}
                  {debrief !== null &&
                    causeLine !== null &&
                    causeLine >= 1 &&
                    causeLine <= lineCount &&
                    causeLine !== crash?.line && (
                      <div
                        className="absolute inset-x-0 bg-amber-500/25"
                        style={{
                          top: PAD_TOP + (causeLine - 1) * LINE_H,
                          height: LINE_H,
                        }}
                      />
                    )}
                  {(unclearLines ?? []).map(
                    (l) =>
                      l >= 1 &&
                      l <= lineCount &&
                      l !== crash?.line &&
                      l !== causeLine && (
                        <div
                          key={`unclear-${l}`}
                          className="absolute inset-x-0 bg-amber-500/25"
                          style={{
                            top: PAD_TOP + (l - 1) * LINE_H,
                            height: LINE_H,
                          }}
                        />
                      ),
                  )}
                  {activeLine !== null &&
                    activeLine >= 1 &&
                    activeLine <= lineCount && (
                      <div
                        className={`absolute inset-x-0 ${
                          crash !== null && crash.line === activeLine
                            ? "bg-red-500/30"
                            : (causeLine !== null &&
                                  causeLine === activeLine) ||
                                (unclearLines?.includes(activeLine) ?? false)
                              ? "bg-amber-500/25"
                              : "bg-emerald-500/20"
                        }`}
                        style={{
                          top: PAD_TOP + (activeLine - 1) * LINE_H,
                          height: LINE_H,
                        }}
                      />
                    )}
                </div>
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

        {/* Program end note */}
        {endNote !== null && (
          <div className="border-t border-zinc-800 px-4 py-2">
            <p className="font-mono text-xs font-semibold text-zinc-100">
              {endNote}
            </p>
          </div>
        )}

        {/* Exam result */}
        {examNote !== null && (
          <div className="border-t border-zinc-800 px-4 py-2">
            <p
              className={`font-mono text-xs font-semibold ${
                examNote.ok ? "text-green-400" : "text-red-400"
              }`}
            >
              {examNote.text}
            </p>
          </div>
        )}

        {/* Transcription parse errors */}
        {visionErrors !== null && visionErrors.length > 0 && (
          <div className="border-t border-zinc-800 px-4 py-2">
            <p className="font-mono text-xs font-semibold text-red-400">
              Transcription needs attention
            </p>
            <ul className="mt-1 max-h-24 overflow-y-auto font-mono text-xs text-zinc-300">
              {visionErrors.map((e, i) => (
                <li key={i}>
                  {e.line > 0 ? `Line ${e.line}: ` : ""}
                  {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

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
        <Machine flash={flash} activeOffset={findActiveOffset(code)} />
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
              {(() => {
                const row = costMap?.[crash.type];
                if (!costMap && !costFailed) {
                  return (
                    <p className="mt-3 animate-pulse font-mono text-sm font-bold text-red-400">
                      Loading repair estimate…
                    </p>
                  );
                }
                if (!row) {
                  return (
                    <p className="mt-3 font-mono text-sm font-bold text-red-400">
                      Repair cost unavailable
                    </p>
                  );
                }
                return (
                  <>
                    <p className="mt-3 font-mono text-lg font-bold text-red-400">
                      Repair: ₹{row.min_inr.toLocaleString("en-IN")} to ₹
                      {row.max_inr.toLocaleString("en-IN")} | Downtime:{" "}
                      {row.downtime_hours} h
                    </p>
                    <p className="mt-1 font-mono text-sm text-zinc-100">
                      {row.damaged_parts}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-zinc-500">
                      Approximate, based on shop-floor experience.
                    </p>
                  </>
                );
              })()}
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
                {asking
                  ? `Asking… ${(elapsedMs / 1000).toFixed(1)}s`
                  : "Ask the Instructor"}
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
