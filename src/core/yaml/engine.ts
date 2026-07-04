import { loadAll } from "js-yaml";
import type { K8sResource, ResourceKind } from "../types/k8s";

const SUPPORTED_KINDS: ResourceKind[] = [
  "Pod",
  "Deployment",
  "Service",
  "Namespace",
];

export interface ParseResult {
  resources: K8sResource[];
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateResource(doc: unknown, index: number): K8sResource | string {
  if (!isRecord(doc)) {
    return `Document ${index + 1}: expected an object`;
  }

  const kind = doc.kind;
  if (
    typeof kind !== "string" ||
    !SUPPORTED_KINDS.includes(kind as ResourceKind)
  ) {
    return `Document ${index + 1}: unsupported kind "${String(kind)}"`;
  }

  if (!isRecord(doc.metadata) || typeof doc.metadata.name !== "string") {
    return `Document ${index + 1}: metadata.name is required`;
  }

  return doc as unknown as K8sResource;
}

export function parseYamlDocuments(yaml: string): ParseResult {
  const resources: K8sResource[] = [];
  const errors: string[] = [];

  if (!yaml.trim()) {
    return { resources, errors: ["YAML input is empty"] };
  }

  let documents: unknown[];
  try {
    documents = loadAll(yaml) as unknown[];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown YAML parse error";
    return { resources, errors: [message] };
  }

  // const kind = doc.kind { }

  documents.forEach((doc, index) => {
    if (doc === null || doc === undefined) {
      return;
    }

    const result = validateResource(doc, index);
    if (typeof result === "string") {
      errors.push(result);
      return;
    }

    resources.push(result);
  });

  if (resources.length === 0 && errors.length === 0) {
    errors.push("No valid Kubernetes resources found in YAML");
  }

  return { resources, errors };
}
