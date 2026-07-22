import { useRef } from "react";

/**
 * Keep the last matching item while `selectedId` stays set, even if live data
 * drops that id from the current window (common with sliding flow samples).
 */
export function useStickyById<T extends { id: string }>(
  items: T[],
  selectedId: string | null,
): T | null {
  const stickyRef = useRef<T | null>(null);

  if (selectedId == null) {
    stickyRef.current = null;
    return null;
  }

  const found = items.find((item) => item.id === selectedId) ?? null;
  if (found) {
    stickyRef.current = found;
    return found;
  }

  return stickyRef.current?.id === selectedId ? stickyRef.current : null;
}

/**
 * Freeze a live list while the user is investigating a row/edge so new entries
 * do not reshuffle or wipe the selection highlight and detail panel.
 */
export function useFrozenWhileSelected<T>(items: T[], frozen: boolean): T[] {
  const frozenRef = useRef(items);
  if (!frozen) {
    frozenRef.current = items;
  }
  return frozen ? frozenRef.current : items;
}
