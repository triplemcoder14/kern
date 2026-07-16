import { describe, expect, it } from "vitest";
import {
  dnsAnalysisVerdict,
  dnsFailureReason,
  dnsSearchExpansion,
} from "./investigation-insights";

describe("dnsSearchExpansion", () => {
  it("detects double cluster search domain", () => {
    const result = dnsSearchExpansion(
      "apm-server.demo.svc.cluster.local.svc.cluster.local",
    );
    expect(result?.suggestion).toBe("apm-server.demo.svc.cluster.local");
    expect(result?.expansion.at(-1)).toContain("svc.cluster.local.svc.cluster.local");
  });

  it("detects cluster.local appended onto an FQDN", () => {
    const result = dnsSearchExpansion(
      "demo-app.demo.svc.cluster.local.cluster.local",
    );
    expect(result?.suggestion).toBe("demo-app.demo.svc.cluster.local");
  });

  it("returns null for clean FQDNs", () => {
    expect(dnsSearchExpansion("apm-server.demo.svc.cluster.local")).toBeNull();
  });
});

describe("dnsFailureReason", () => {
  it("explains NXDOMAIN search-path mistakes", () => {
    const result = dnsFailureReason(
      "NXDOMAIN",
      "apm-server.demo.svc.cluster.local.svc.cluster.local",
    );
    expect(result.reason).toMatch(/search domain/i);
    expect(result.suggestion).toMatch(/apm-server\.demo\.svc\.cluster\.local/);
  });
});

describe("dnsAnalysisVerdict", () => {
  it("labels search-path NXDOMAIN as configuration issue", () => {
    expect(dnsAnalysisVerdict("NXDOMAIN", true)).toBe("Configuration issue");
    expect(dnsAnalysisVerdict("NOERROR", false)).toBe("Succeeded");
    expect(dnsAnalysisVerdict("NXDOMAIN", false)).toBe("Failed");
  });
});
