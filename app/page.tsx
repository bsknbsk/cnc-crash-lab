import Link from "next/link";
import type { CSSProperties } from "react";
import s from "./landing.module.css";

// Inline button styles so the calls to action render even if the
// stylesheet fails to load.
const OPEN_APP_STYLE: CSSProperties = {
  display: "inline-block",
  background: "#F0A33A",
  color: "#1A1205",
  padding: "10px 18px",
  borderRadius: 4,
  fontWeight: 600,
  textDecoration: "none",
};

const HOW_STYLE: CSSProperties = {
  display: "inline-block",
  border: "1px solid #93A2AB",
  color: "inherit",
  padding: "10px 18px",
  borderRadius: 4,
  textDecoration: "none",
};

const FEATURES: { title: string; tag: string; desc: string }[] = [
  {
    title: "Virtual 3-axis machine",
    tag: "Simulator",
    desc: "Type or load a program, then run it with Cycle Start or Single Block. The table, vise, stock and tool are drawn to scale in millimetres, and the current line is highlighted as the tool moves.",
  },
  {
    title: "Crash detection with cost",
    tag: "Simulator + cost table",
    desc: "Every move is checked against the part, the vise and the table. A crash stops the machine and shows the line, the type of mistake, and an approximate repair cost and downtime from a reference table.",
  },
  {
    title: "Instructor agent",
    tag: "Muse Spark 1.3",
    desc: "Explains what happened in plain shop language, marks the crash line and the line with the real mistake, and gives a corrected program that has already run without a crash on the simulator.",
  },
  {
    title: "Program sheet scanner",
    tag: "Muse Spark 1.3 vision",
    desc: "Photograph a handwritten program sheet. It loads into the editor exactly as written, mistakes included, and lines that were hard to read are highlighted for checking.",
  },
  {
    title: "Exam mode",
    tag: "Fault Injector agent",
    desc: "Practice on programs with one hidden, realistic mistake. Each question is confirmed on the simulator before it is used, and progress is tracked as questions are completed.",
  },
];

const CRASH_TYPES: { code: string; meaning: string }[] = [
  {
    code: "MISSING_G43",
    meaning: "Tool length offset not applied after a tool change",
  },
  {
    code: "WRONG_WORK_OFFSET",
    meaning: "Program uses a different part zero than the one set up",
  },
  { code: "RAPID_INTO_STOCK", meaning: "Fast positioning move into the part" },
  {
    code: "RAPID_INTO_VISE",
    meaning: "Fast positioning move into the vise jaws",
  },
  {
    code: "FEED_SPINDLE_OFF",
    meaning: "Cutting move with the spindle stopped",
  },
];

const STEPS: { title: string; desc: string }[] = [
  {
    title: "Run the program",
    desc: "Load a sample, type your own, or scan a paper sheet, then press Cycle Start.",
  },
  {
    title: "See the crash",
    desc: "The machine stops at the impact point and the card shows the crash type, line, repair cost and downtime.",
  },
  {
    title: "Ask the Instructor",
    desc: "The agent looks up the codes involved, reads the cost and safety habit, and writes a correction.",
  },
  {
    title: "Run the verified fix",
    desc: "The correction has already passed the simulator. Load it and run the program to M30.",
  },
];

const STACK: { label: string; value: string; detail: string }[] = [
  {
    label: "Instructor agent",
    value: "Muse Spark 1.3",
    detail: "Meta Model API, tool calling: code lookup, cost lookup, simulator run",
  },
  {
    label: "Sheet scanner",
    value: "Muse Spark 1.3 vision",
    detail: "Structured output, transcribes exactly as written",
  },
  {
    label: "Fault Injector agent",
    value: "Muse Spark 1.3",
    detail: "One realistic mistake per question, confirmed on the simulator",
  },
  {
    label: "Coding agent",
    value: "Muse Code",
    detail: "Used to build the application",
  },
  {
    label: "Application",
    value: "Next.js on Vercel",
    detail: "Server routes keep API keys off the browser",
  },
  {
    label: "3D and data",
    value: "react-three-fiber, Supabase",
    detail: "Machine view, repair cost table, verified question bank",
  },
];

function CrosshairIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      className={s.brandMark}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="1"
        y="1"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M9 4v10M4 9h10" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

// Static illustration of the machine cell: table, vise, stock, tool and the
// green G54 part-zero marker. Plain SVG, no WebGL.
function MachineSketch() {
  return (
    <svg
      viewBox="0 0 400 300"
      width="400"
      height="300"
      className={s.previewSvg}
      role="img"
      aria-label="Machine cell: table, vise, aluminium stock, end mill and G54 part zero"
    >
      {/* table */}
      <rect x="20" y="248" width="360" height="20" fill="#374151" />
      {/* vise base + jaws */}
      <rect x="110" y="212" width="180" height="36" fill="#9ca3af" />
      <rect x="110" y="188" width="28" height="60" fill="#9ca3af" />
      <rect x="262" y="188" width="28" height="60" fill="#9ca3af" />
      {/* stock */}
      <rect x="138" y="182" width="124" height="30" fill="#2563eb" />
      {/* faced strips on the stock top */}
      <rect x="138" y="182" width="124" height="4" fill="#c9d4da" />
      {/* end mill + holder + spindle */}
      <rect x="192" y="102" width="16" height="80" fill="#D9A066" />
      <rect x="184" y="52" width="32" height="50" fill="#C49060" />
      <rect x="170" y="12" width="60" height="40" fill="#1f2937" />
      {/* G54 datum triad at the stock top front-left corner */}
      <circle cx="138" cy="182" r="5" fill="#ffffff" />
      <line x1="138" y1="182" x2="168" y2="182" stroke="#ef4444" strokeWidth="2" />
      <line x1="138" y1="182" x2="138" y2="152" stroke="#3b82f6" strokeWidth="2" />
      <rect x="146" y="150" width="34" height="16" rx="3" fill="#2f7a4f" />
      <text
        x="163"
        y="162"
        textAnchor="middle"
        fontFamily="monospace"
        fontSize="10"
        fontWeight="bold"
        fill="#ffffff"
      >
        G54
      </text>
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={`${s.inner} ${s.headerRow}`}>
          <Link href="/" className={s.brand}>
            <CrosshairIcon />
            CNC Crash Lab
          </Link>
          <nav className={s.nav} aria-label="Sections">
            <span className={s.navLinks}>
              <Link href="#features">Features</Link>{" "}
              <Link href="#how">How it works</Link>{" "}
              <Link href="#stack">Built with</Link>
            </span>
            <Link href="/app" style={OPEN_APP_STYLE}>
              Open the app
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className={`${s.inner} ${s.hero}`}>
          <div className={s.heroGrid}>
            <div>
              <p className={s.eyebrow}>ISO G-code training simulator</p>
              <h1 className={s.h1}>Crash the virtual machine first</h1>
              <p className={s.lede}>
                CNC Crash Lab runs your program on a 3-axis milling machine in
                the browser. When a mistake causes a crash, it shows the
                approximate repair cost and downtime, explains the cause, and
                proves the fix before you try again.
              </p>
              <div className={s.btnRow}>
                <Link href="/app" style={OPEN_APP_STYLE}>
                  Open the app
                </Link>
                <a href="#how" style={HOW_STYLE}>
                  See how it works
                </a>
              </div>
              <p className={s.fineprint}>
                Runs in any modern browser. Nothing to install.
              </p>
            </div>
            <div>
              <div className={s.previewBox}>
                <MachineSketch />
              </div>
              <p className={s.caption}>
                Miniature of the app&apos;s machine cell: table, vise,
                aluminium stock and a 10 mm end mill. Green marker: G54 part
                zero.
              </p>
            </div>
          </div>
        </section>

        <section id="features" className={`${s.inner} ${s.section}`}>
          <p className={s.eyebrow}>What it does</p>
          <h2 className={s.h2}>A training cell where mistakes are free</h2>
          <p className={s.intro}>
            Every function is built around one idea: let a trainee see what a
            programming or setup mistake actually does, then learn the correct
            habit.
          </p>
          <div className={s.rows}>
            {FEATURES.map((f) => (
              <div key={f.title} className={s.row}>
                <div>
                  <h3 className={s.rowTitle}>{f.title}</h3>
                  <span className={s.tag}>{f.tag}</span>
                </div>
                <p className={s.rowDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
          <h3 className={s.miniHead}>Crash types it detects</h3>
          <ul className={s.crashList}>
            {CRASH_TYPES.map((c) => (
              <li key={c.code}>
                <code>{c.code}</code>
                <span>{c.meaning}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" className={`${s.inner} ${s.section}`}>
          <h2 className={s.h2}>From crash to verified fix</h2>
          <ol className={s.steps}>
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span className={s.stepNum}>0{i + 1}</span>
                <h3 className={s.stepTitle}>{step.title}</h3>
                <p className={s.stepDesc}>{step.desc}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="stack" className={`${s.inner} ${s.section}`}>
          <h2 className={s.h2}>Meta models on a deterministic simulator</h2>
          <p className={s.intro}>
            The simulator decides whether a crash happened. The AI explains,
            generates and verifies against it, and every cost it quotes comes
            from the reference table.
          </p>
          <ul className={s.stackGrid}>
            {STACK.map((item) => (
              <li key={item.label}>
                <div className={s.stackLabel}>{item.label}</div>
                <div className={s.stackValue}>{item.value}</div>
                <p className={s.stackDetail}>{item.detail}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={`${s.inner} ${s.band}`}>
          <h2 className={s.h2}>Run your first program</h2>
          <Link href="/app" style={OPEN_APP_STYLE}>
            Open the app
          </Link>
        </section>
      </main>

      <footer className={`${s.inner} ${s.footer}`}>
        <p>
          CNC Crash Lab · Built for the Meta Global AI Developer Hackathon 2026
        </p>
        <p>Repair costs are approximate reference values for training.</p>
      </footer>
    </div>
  );
}
