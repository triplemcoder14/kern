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

export function isPodServiceTalkEvent(event: MonitorEvent): boolean {
  const talk = event.networkTalk;
  if (!talk) {
    return false;
  }
  const endpointKinds = [talk.srcKind, talk.dstKind];
  return endpointKinds.includes("Pod") || endpointKinds.includes("Service");
}

export interface ActiveTalkSoundState {
  healthyCount: number;
  alertSeverity: MonitorSeverity | null;
}

/** Replay pod/service talk events to find live paths and open alerts. */
export function activeTalkSoundState(events: MonitorEvent[]): ActiveTalkSoundState {
  const sorted = events
    .filter((event) => event.networkTalk && isPodServiceTalkEvent(event))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const healthy = new Set<string>();
  const alerts = new Map<string, MonitorSeverity>();

  for (const event of sorted) {
    applyTalkEvent(event, healthy, alerts);
  }

  return summarizeTalkSoundState(healthy, alerts);
}

function applyTalkEvent(
  event: MonitorEvent,
  healthy: Set<string>,
  alerts: Map<string, MonitorSeverity>,
): void {
  const talk = event.networkTalk;
  if (!talk || !isPodServiceTalkEvent(event)) {
    return;
  }

  if (talk.kind === "started") {
    healthy.add(talk.talkKey);
    alerts.delete(talk.talkKey);
    return;
  }

  if (talk.kind === "degraded") {
    healthy.delete(talk.talkKey);
    alerts.set(talk.talkKey, event.severity);
    return;
  }

  if (talk.kind === "ended") {
    healthy.delete(talk.talkKey);
    alerts.delete(talk.talkKey);
  }
}

function summarizeTalkSoundState(
  healthy: Set<string>,
  alerts: Map<string, MonitorSeverity>,
): ActiveTalkSoundState {
  let alertSeverity: MonitorSeverity | null = null;
  for (const severity of alerts.values()) {
    if (severity === "critical") {
      alertSeverity = "critical";
      break;
    }
    if (severity === "warning") {
      alertSeverity = "warning";
    }
  }

  return {
    healthyCount: healthy.size,
    alertSeverity,
  };
}

/** Keeps live talks even when older start events fall off the UI buffer. */
export function createActiveTalkSoundTracker() {
  const healthy = new Set<string>();
  const alerts = new Map<string, MonitorSeverity>();
  const seenIds = new Set<string>();

  const ingestSorted = (incoming: MonitorEvent[]) => {
    for (const event of incoming) {
      if (seenIds.has(event.id)) {
        continue;
      }
      seenIds.add(event.id);
      applyTalkEvent(event, healthy, alerts);
    }
  };

  return {
    bootstrap(events: MonitorEvent[]) {
      healthy.clear();
      alerts.clear();
      seenIds.clear();
      const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      ingestSorted(sorted);
      return summarizeTalkSoundState(healthy, alerts);
    },
    ingest(events: MonitorEvent[]) {
      const fresh = events.filter((event) => !seenIds.has(event.id));
      if (fresh.length > 10 && fresh.length >= events.length * 0.5) {
        return this.bootstrap(events);
      }

      fresh.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      ingestSorted(fresh);
      return summarizeTalkSoundState(healthy, alerts);
    },
    reset() {
      healthy.clear();
      alerts.clear();
      seenIds.clear();
    },
    snapshot() {
      return summarizeTalkSoundState(healthy, alerts);
    },
  };
}

export function activeTalkSoundStateKey(state: ActiveTalkSoundState): string {
  return `${state.alertSeverity ?? "none"}:${state.healthyCount}`;
}

export function shouldPlayActiveTalkSound(state: ActiveTalkSoundState): boolean {
  return state.alertSeverity !== null || state.healthyCount > 0;
}

/** @deprecated use activeTalkSoundState */
export function activeTalkAlertSeverity(events: MonitorEvent[]): MonitorSeverity | null {
  return activeTalkSoundState(events).alertSeverity;
}

export const TALK_SOUND_REPEAT_MS = 3_000;

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

async function ensureAudioReady(): Promise<boolean> {
  return unlockAlertSound();
}

export async function playAlertSound(severity: MonitorSeverity): Promise<void> {
  if (!(await ensureAudioReady())) {
    return;
  }

  const ctx = getAudioContext();
  const now = ctx.currentTime;

  if (severity === "critical") {
    tone(ctx, 220, now, 0.22, 0.12, "square");
    tone(ctx, 165, now + 0.12, 0.28, 0.1, "square");
    return;
  }

  tone(ctx, 880, now, 0.12, 0.12, "sine");
  tone(ctx, 1175, now + 0.1, 0.2, 0.1, "sine");
}

/** Soft ping for live pod ↔ service traffic. */
export async function playTalkStartedSound(): Promise<void> {
  if (!(await ensureAudioReady())) {
    return;
  }

  const ctx = getAudioContext();
  const now = ctx.currentTime;
  tone(ctx, 523, now, 0.08, 0.085, "sine");
  tone(ctx, 784, now + 0.05, 0.15, 0.075, "sine");
}

export async function playActiveTalkSound(state: ActiveTalkSoundState): Promise<void> {
  if (state.alertSeverity) {
    await playAlertSound(state.alertSeverity);
    return;
  }

  if (state.healthyCount > 0) {
    await playTalkStartedSound();
  }
}
