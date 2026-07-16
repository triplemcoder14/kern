/** Normalize transient/cancel errors so they don't look like hard failures. */
export function isTransientFetchError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    if (error.name === "AbortError") {
      return true;
    }
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return true;
    }
    return isTransientFetchMessage(error.message);
  }
  if (typeof error === "string") {
    return isTransientFetchMessage(error);
  }
  return false;
}

export function isTransientFetchMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("aborted") ||
    lower.includes("abort") ||
    lower.includes("the user aborted a request") ||
    lower.includes("signal is aborted")
  );
}

export function friendlySettingsLoadError(error: unknown): {
  soft: boolean;
  message: string;
} {
  if (isTransientFetchError(error)) {
    return { soft: true, message: "Unable to refresh settings." };
  }
  if (error instanceof Error && error.message.trim()) {
    return { soft: false, message: error.message };
  }
  return { soft: false, message: "Unable to load settings." };
}

export function friendlyMonitorError(message: string): {
  soft: boolean;
  message: string;
} {
  if (isTransientFetchMessage(message)) {
    return { soft: true, message: "Unable to refresh. Connection may have been interrupted." };
  }
  return { soft: false, message };
}
