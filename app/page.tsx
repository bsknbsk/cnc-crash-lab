"use client";

import { useRef, useState } from "react";
import Machine, { setToolTip } from "../components/Machine";

const SAMPLE_PROGRAM = `%
O0001 (CRASH LAB DEMO)
G21 G17 G40 G49 G80 G90
G54
T1 M06 (10MM FLAT END MILL)
S5000 M03
G00 X0 Y0 Z200
G00 X50 Y40
G01 Z-5 F300
G01 X90 F600
G00 Z50
M30
%
`;

export default function Home() {
  const [code, setCode] = useState(SAMPLE_PROGRAM);
  const gutterRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const lineCount = code.split("\n").length;

  const syncScroll = () => {
    if (gutterRef.current && areaRef.current) {
      gutterRef.current.scrollTop = areaRef.current.scrollTop;
    }
  };

  const handleReset = () => {
    setToolTip(0, 0, 200);
  };

  return (
    <main className="flex h-screen w-full">
      {/* Left 40%: editor + control panel */}
      <section className="flex w-[40%] flex-col border-r border-zinc-800 bg-zinc-950">
        <header className="border-b border-zinc-800 px-4 py-2">
          <h1 className="font-mono text-sm font-semibold text-zinc-100">
            CNC Crash Lab
          </h1>
          <p className="font-mono text-xs text-zinc-500">
            Fanuc 0i style · G21 · mm
          </p>
        </header>

        {/* G-code editor with line numbers */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div
            ref={gutterRef}
            className="w-12 shrink-0 overflow-hidden bg-zinc-900 py-3 text-right font-mono text-sm leading-6 text-zinc-500 select-none"
            aria-hidden
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="pr-3">
                {i + 1}
              </div>
            ))}
          </div>
          <textarea
            ref={areaRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onScroll={syncScroll}
            spellCheck={false}
            wrap="off"
            className="min-w-0 flex-1 resize-none overflow-auto bg-zinc-950 py-3 pl-3 font-mono text-sm leading-6 whitespace-pre text-zinc-100 outline-none"
            aria-label="G-code editor"
          />
        </div>

        {/* Control panel */}
        <div className="flex gap-2 border-t border-zinc-800 p-3">
          <button
            type="button"
            className="flex-1 rounded bg-green-600 px-3 py-2 font-mono text-sm font-semibold text-white hover:bg-green-500"
          >
            Cycle Start
          </button>
          <button
            type="button"
            className="flex-1 rounded bg-amber-600 px-3 py-2 font-mono text-sm font-semibold text-white hover:bg-amber-500"
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
        <Machine />
      </section>
    </main>
  );
}
