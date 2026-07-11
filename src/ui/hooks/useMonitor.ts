import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MonitorWorkerEvent } from "../../core/types/monitor-rpc";
import type {
  ClusterHealthSnapshot,
  ConnectClusterInput,
  ConnectClusterResult,
  Incident,
  MonitorEvent,
} from "../../core/types/monitoring";
import type { NetworkSnapshot } from "../../core/types/network";
import { loadClusterConfig } from "../../core/config/cluster-config";
import { trimMonitorEvents } from "../../core/monitoring/retention";
import { getMonitorApiClient } from "../../lib/monitor-api";

const EMPTY_NETWORK: NetworkSnapshot = {
  topology: { nodes: [], edges: [], updatedAt: "" },
  flows: [],
  ebpf: { connected: false, collectorUrl: "", message: "offline" },
};

const EMPTY_HEALTH: ClusterHealthSnapshot = {
  health: "disconnected",
  connected: false,
  clusterName: "Not connected",
  podCount: 0,
  runningPods: 0,
  failedPods: 0,
  serviceCount: 0,
  openIncidents: 0,
  eventsPerMinute: 0,
};

const EVENT_UI_BATCH_MS = 500;

export function useMonitor() {
  const client = useMemo(() => getMonitorApiClient(), []);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [health, setHealth] = useState<ClusterHealthSnapshot>(EMPTY_HEALTH);
  const [connection, setConnection] = useState<ConnectClusterResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [network, setNetwork] = useState<NetworkSnapshot>(EMPTY_NETWORK);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const pendingEventsRef = useRef<MonitorEvent[]>([]);
  const eventFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingEvents = useCallback(() => {
    if (pendingEventsRef.current.length === 0) {
      return;
    }
    const batch = pendingEventsRef.current;
    pendingEventsRef.current = [];
    setEvents((prev) => {
      const merged = new Map(prev.map((item) => [item.id, item]));
      for (const event of batch) {
        merged.set(event.id, event);
      }
      return trimMonitorEvents([...merged.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
    });
  }, []);

  const queueEvent = useCallback(
    (event: MonitorEvent) => {
      const index = pendingEventsRef.current.findIndex((item) => item.id === event.id);
      if (index >= 0) {
        pendingEventsRef.current[index] = event;
      } else {
        pendingEventsRef.current.unshift(event);
      }
      if (eventFlushTimerRef.current) {
        return;
      }
      eventFlushTimerRef.current = setTimeout(() => {
        eventFlushTimerRef.current = null;
        flushPendingEvents();
      }, EVENT_UI_BATCH_MS);
    },
    [flushPendingEvents],
  );

  useEffect(() => {
    return () => {
      if (eventFlushTimerRef.current) {
        clearTimeout(eventFlushTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = client.onEvent((event: MonitorWorkerEvent) => {
      switch (event.type) {
        case "CONNECTED":
          setConnection(event.result);
          setError(null);
          setBusy(false);
          break;
        case "DISCONNECTED":
          setConnection(null);
          setNamespaces([]);
          break;
        case "MONITOR_EVENT":
          queueEvent(event.event);
          break;
        case "INCIDENT_UPSERTED":
          setIncidents((prev) => {
            const filtered = prev.filter((item) => item.id !== event.incident.id);
            return [event.incident, ...filtered];
          });
          break;
        case "INCIDENT_RESOLVED":
          setIncidents((prev) =>
            prev.map((item) =>
              item.id === event.incidentId
                ? { ...item, status: "resolved", updatedAt: new Date().toISOString() }
                : item,
            ),
          );
          break;
        case "HEALTH_UPDATE":
          setHealth(event.snapshot);
          break;
        case "MONITOR_SNAPSHOT":
          setEvents(event.events);
          setIncidents(event.incidents);
          break;
        case "NETWORK_SNAPSHOT":
          setNetwork(event.snapshot);
          break;
        case "NAMESPACES_UPDATE":
          setNamespaces(event.namespaces);
          break;
        case "ERROR":
          setError(event.message);
          break;
      }
    });

    const config = loadClusterConfig();
    client
      .initSession(config.ebpfCollectorUrl)
      .catch((err: Error) => setError(err.message));

    return unsubscribe;
  }, [client, queueEvent]);

  const connect = useCallback(
    async (input: ConnectClusterInput) => {
      setBusy(true);
      setError(null);
      try {
        const result = await client.request<ConnectClusterResult>({ type: "CONNECT", input });
        setConnection(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to connect";
        setError(message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      await client.request({ type: "DISCONNECT" });
      setConnection(null);
    } finally {
      setBusy(false);
    }
  }, [client]);

  const resolveIncident = useCallback(
    async (incidentId: string) => {
      await client.request({ type: "RESOLVE_INCIDENT", incidentId });
    },
    [client],
  );

  const setNamespace = useCallback(
    async (namespace: string) => {
      try {
        await client.request({ type: "SET_NAMESPACE", namespace });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to set namespace scope";
        setError(message);
      }
    },
    [client],
  );

  const openIncidents = useMemo(
    () => incidents.filter((incident) => incident.status === "open"),
    [incidents],
  );

  const networkEvents = useMemo(
    () => events.filter((event) => event.category === "network" || event.category === "service"),
    [events],
  );

  return {
    events,
    incidents,
    openIncidents,
    networkEvents,
    network,
    namespaces,
    health,
    connection,
    error,
    busy,
    connect,
    disconnect,
    resolveIncident,
    setNamespace,
  };
}
