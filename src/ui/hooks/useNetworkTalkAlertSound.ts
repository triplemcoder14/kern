import { useEffect, useRef } from "react";
import type { MonitorEvent } from "../../core/types/monitoring";
import { playAlertSound, shouldPlayAlertSound } from "../lib/alert-sound";

export function useNetworkTalkAlertSound(
  events: MonitorEvent[],
  muted: boolean,
  paused: boolean,
): void {
  const seenIds = useRef(new Set<string>());
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (!bootstrapped.current) {
      for (const event of events) {
        seenIds.current.add(event.id);
      }
      bootstrapped.current = true;
      return;
    }

    for (const event of events) {
      if (seenIds.current.has(event.id)) {
        continue;
      }
      seenIds.current.add(event.id);

      if (muted || paused || !shouldPlayAlertSound(event)) {
        continue;
      }

      playAlertSound(event.severity);
    }
  }, [events, muted, paused]);
}
