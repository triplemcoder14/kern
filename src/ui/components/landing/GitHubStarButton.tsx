import { useEffect, useState } from "react";

const GITHUB_OWNER = "triplemcoder14";
const GITHUB_REPO = "kern";
const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
const REFRESH_MS = 120_000;

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="landing-github-star-mark">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.18.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.51-1.04 2.18-.82 2.18-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.54.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function formatGitHubStarCount(count: number): string {
  if (count >= 1_000_000) {
    const value = count / 1_000_000;
    return value >= 10 ? `${Math.round(value)}M` : `${trimTrailingZero(value.toFixed(1))}M`;
  }
  if (count >= 1_000) {
    const value = count / 1_000;
    return value >= 10 ? `${Math.round(value)}k` : `${trimTrailingZero(value.toFixed(1))}k`;
  }
  return count.toLocaleString();
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.0$/, "");
}

async function fetchStarCount(): Promise<number | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { stargazers_count?: number };
    return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
  } catch {
    return null;
  }
}

export function GitHubStarButton({ className }: { className?: string }) {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const count = await fetchStarCount();
      if (!cancelled && count !== null) setStars(count);
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const countLabel = stars === null ? "…" : formatGitHubStarCount(stars);
  const ariaLabel =
    stars === null
      ? "Star KERN on GitHub"
      : `Star KERN on GitHub (${stars.toLocaleString()} stars)`;

  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noreferrer"
      className={`landing-github-star${className ? ` ${className}` : ""}`}
      aria-label={ariaLabel}
    >
      <span className="landing-github-star-label">
        <GitHubMark />
        Star
      </span>
      <span className="landing-github-star-count" aria-hidden={stars === null}>
        {countLabel}
      </span>
    </a>
  );
}
