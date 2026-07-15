import { TraceFlameStack } from "./TraceFlameStack";
import type { ProfileStackFrame } from "../../../core/types/profiling";

/** @deprecated Prefer TraceFlameStack — kept for existing imports. */
export function NetworkFlameStack({
  frames,
  label = "Network flame graph",
}: {
  frames: ProfileStackFrame[];
  label?: string;
}) {
  return <TraceFlameStack frames={frames} label={label} variant="network" />;
}
