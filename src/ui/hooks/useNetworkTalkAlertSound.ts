import { useEffect, useRef } from "react";
import type { MonitorEvent } from "../../core/types/monitoring";
import {
  activeTalkSoundStateKey,
  createActiveTalkSoundTracker,
  playActiveTalkSound,
  shouldPlayActiveTalkSound,
  TALK_SOUND_REPEAT_MS,
  unlockAlertSound,
} from "../lib/alert-sound";

export function useNetworkTalkAlertSound(
  events: MonitorEvent[],
  muted: boolean,
  enabled: boolean,
): void {
  const trackerRef = useRef(createActiveTalkSoundTracker());
  const bootstrappedRef = useRef(false);
  const stateKeyRef = useRef<string>("none:0");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tick = (force: boolean) => {
    if (muted || !enabled) {
      return;
    }

    const state = trackerRef.current.snapshot();
    const key = activeTalkSoundStateKey(state);

    if (!shouldPlayActiveTalkSound(state)) {
      stateKeyRef.current = key;
      return;
    }

    if (!force && key === stateKeyRef.current) {
      void playActiveTalkSound(state);
      return;
    }

    stateKeyRef.current = key;
    void playActiveTalkSound(state);
  };

  useEffect(() => {
    if (muted || !enabled) {
      return undefined;
    }

    const unlock = () => {
      void unlockAlertSound();
    };

    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [muted, enabled]);

  useEffect(() => {
    if (!enabled) {
      trackerRef.current.reset();
      bootstrappedRef.current = false;
      stateKeyRef.current = "none:0";
      return;
    }

    if (!bootstrappedRef.current) {
      trackerRef.current.bootstrap(events);
      bootstrappedRef.current = true;
    } else {
      trackerRef.current.ingest(events);
    }
  }, [events, enabled]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (muted || !enabled) {
      stateKeyRef.current = "none:0";
      return undefined;
    }

    tick(true);

    intervalRef.current = setInterval(() => {
      tick(false);
    }, TALK_SOUND_REPEAT_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [muted, enabled]);

  useEffect(() => {
    if (muted || !enabled) {
      return;
    }
    tick(true);
  }, [events, muted, enabled]);
}
