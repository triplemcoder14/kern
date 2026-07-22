import { useRef } from "react";
import type { GraphLayout, GraphLod } from "../../core/network/graph-model";

/**
 * Freeze the service-map layout while the user is investigating a node/edge.
 * Live NETWORK_SNAPSHOT ticks rebuild the graph and can change bundled edge IDs;
 * without a freeze, selection highlight and detail panels appear to vanish.
 * LOD changes still refresh the freeze so expand/zoom levels stay usable.
 */
export function useInvestigationLayout(
  layout: GraphLayout,
  investigating: boolean,
  lod: GraphLod,
): GraphLayout {
  const frozenRef = useRef<{ lod: GraphLod; layout: GraphLayout } | null>(null);

  if (!investigating) {
    frozenRef.current = null;
    return layout;
  }

  if (!frozenRef.current || frozenRef.current.lod !== lod) {
    frozenRef.current = { lod, layout };
  }

  return frozenRef.current.layout;
}
