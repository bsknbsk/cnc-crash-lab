# CNC Crash Lab: agent rules

- Next.js App Router + TypeScript. 3D with @react-three/fiber and drei.
- Machine: 3-axis VMC, Fanuc 0i style. Units mm, G21 default.
- Simulator code lives in lib/sim and must be pure TypeScript with no React imports,
  so API routes can import it.
- Every Meta API call happens in app/api/* routes. Never expose MODEL_API_KEY to the browser.
- Never write secrets into files other than .env.local.
- Do not commit or push unless asked.
- Repair costs come only from the Supabase table repair_costs. Never invent prices.
