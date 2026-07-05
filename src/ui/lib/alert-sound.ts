import type { MonitorEvent, MonitorSeverity } from "../../core/types/monitoring";

const MUTE_STORAGE_KEY = "kern.events.alertSoundMuted";

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function isAlertSoundMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setAlertSoundMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
  } catch {
    // ignore quota / private mode
  }
}

export async function unlockAlertSound(): Promise<boolean> {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  return ctx.state === "running";
}

export function shouldPlayAlertSound(event: MonitorEvent): boolean {
  if (!event.networkTalk) {
    return false;
  }
  if (event.networkTalk.kind === "degraded") {
    return true;
  }
  return event.severity === "critical";
}

function tone(
  ctx: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  volume: number,
  type: OscillatorType,
): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(volume, startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration);
}

export function playAlertSound(severity: MonitorSeverity): void {
  const ctx = getAudioContext();
  if (ctx.state !== "running") {
    return;
  }

  const now = ctx.currentTime;

  if (severity === "critical") {
    tone(ctx, 220, now, 0.22, 0.07, "square");
    tone(ctx, 165, now + 0.12, 0.28, 0.06, "square");
    return;
  }

  tone(ctx, 880, now, 0.12, 0.08, "sine");
  tone(ctx, 1175, now + 0.1, 0.2, 0.07, "sine");
}
