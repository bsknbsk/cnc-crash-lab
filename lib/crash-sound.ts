// lib/crash-sound.ts
// Synthesized crash sound (Web Audio API, no audio files).
// playCrash() is unconditional; the UI owns the speaker toggle.

let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/** Create or resume the shared AudioContext. Call from click handlers. */
export function ensureAudio(): void {
  const ac = audio();
  if (ac && ac.state === "suspended") void ac.resume();
}

function noiseSource(ac: AudioContext): AudioBufferSourceNode {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  return src;
}

/** 60 ms low thump + 350 ms metallic scrape + 200 ms high ping. */
export function playCrash(): void {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;

  const master = ac.createGain();
  master.gain.value = 0.6;
  master.connect(ac.destination);

  // Low thump: sine at 70 Hz with a fast pitch drop, 60 ms.
  const thump = ac.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(70, t);
  thump.frequency.exponentialRampToValueAtTime(35, t + 0.06);
  const thumpGain = ac.createGain();
  thumpGain.gain.setValueAtTime(1, t);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  thump.connect(thumpGain);
  thumpGain.connect(master);
  thump.start(t);
  thump.stop(t + 0.07);

  // Metallic scrape: white noise through a 3000 Hz bandpass, 350 ms.
  const scrape = noiseSource(ac);
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 3000;
  const scrapeGain = ac.createGain();
  scrapeGain.gain.setValueAtTime(0.001, t);
  scrapeGain.gain.exponentialRampToValueAtTime(1, t + 0.005);
  scrapeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  scrape.connect(band);
  band.connect(scrapeGain);
  scrapeGain.connect(master);
  scrape.start(t);
  scrape.stop(t + 0.36);

  // High ping: triangle 2400 Hz, 200 ms decay.
  const ping = ac.createOscillator();
  ping.type = "triangle";
  ping.frequency.value = 2400;
  const pingGain = ac.createGain();
  pingGain.gain.setValueAtTime(0.5, t);
  pingGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  ping.connect(pingGain);
  pingGain.connect(master);
  ping.start(t);
  ping.stop(t + 0.21);
}
