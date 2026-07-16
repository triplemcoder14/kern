import type { RetentionPolicy } from "../monitoring/retention";

/** User-editable retention caps persisted under the data directory. */
export interface SavedRetentionSettings {
  /** Drop monitor events older than this many hours (0 = count-only). */
  maxEventAgeHours: number;
  maxEvents: number;
  maxIncidents: number;
  maxSnapshots: number;
  maxFlows: number;
  maxSnapshotFlows: number;
}

export interface RetentionSettingsView extends SavedRetentionSettings {
  /** Effective policy currently applied in the API process. */
  applied: RetentionPolicy;
}
