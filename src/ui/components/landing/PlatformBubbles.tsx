import type { ReactElement, SVGProps } from "react";

type PlatformId =
  | "on-prem"
  | "kubernetes"
  | "docker"
  | "linux"
  | "helm"
  | "minio"
  | "aws-s3"
  | "cloudflare-r2";

interface PlatformBubble {
  id: PlatformId;
  label: string;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
}

const PLATFORMS: readonly PlatformBubble[] = [
  { id: "kubernetes", label: "Kubernetes", x: 6, y: 18, size: 46, delay: 0, duration: 9 },
  { id: "docker", label: "Docker", x: 18, y: 8, size: 42, delay: 1.2, duration: 8 },
  { id: "linux", label: "Linux", x: 32, y: 22, size: 40, delay: 0.4, duration: 10 },
  { id: "helm", label: "Helm", x: 44, y: 10, size: 44, delay: 2.1, duration: 7.5 },
  { id: "on-prem", label: "On-prem", x: 58, y: 28, size: 38, delay: 0.8, duration: 11 },
  { id: "minio", label: "MinIO", x: 72, y: 12, size: 42, delay: 1.6, duration: 8.5 },
  { id: "aws-s3", label: "AWS S3", x: 84, y: 24, size: 40, delay: 2.8, duration: 9.5 },
  { id: "cloudflare-r2", label: "Cloudflare R2", x: 92, y: 6, size: 44, delay: 0.2, duration: 10.5 },
  { id: "kubernetes", label: "Kubernetes", x: 14, y: 62, size: 36, delay: 3.2, duration: 8 },
  { id: "docker", label: "Docker", x: 38, y: 72, size: 34, delay: 1.9, duration: 9 },
  { id: "helm", label: "Helm", x: 62, y: 68, size: 36, delay: 2.4, duration: 7 },
  { id: "linux", label: "Linux", x: 78, y: 58, size: 32, delay: 4.1, duration: 11 },
] as const;

function IconOnPrem(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <rect x="3" y="4" width="18" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="10" width="18" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="16" width="18" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6.5" cy="6.5" r="0.9" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r="0.9" fill="currentColor" />
      <circle cx="6.5" cy="18.5" r="0.9" fill="currentColor" />
    </svg>
  );
}

function IconKubernetes(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M12 2.2 3.5 7v10L12 21.8 20.5 17V7L12 2.2Zm0 1.6 6.9 3.9v7.8L12 19.4l-6.9-3.9V7.7L12 3.8Z"
      />
      <path fill="currentColor" d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" opacity="0.85" />
    </svg>
  );
}

function IconDocker(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M4 11h2v2H4v-2Zm3 0h2v2H7v-2Zm3 0h2v2h-2v-2Zm3 0h2v2h-2v-2Zm-9 3h2v2H4v-2Zm3 0h2v2H7v-2Zm3 0h2v2h-2v-2Zm9-6h-2V7h2v1Zm-3 0h-2V7h2v1Zm-3 0H9V7h2v1Zm8 3h1.5a3.5 3.5 0 0 1-3.4 2.7 5.8 5.8 0 0 1-2.3-1.1 6.5 6.5 0 0 1-1.2-2.7H7.8a7.8 7.8 0 0 0 2.4 4.6 8.2 8.2 0 0 0 5.8 2.1 6.2 6.2 0 0 0 6.1-5.1H18Z"
      />
    </svg>
  );
}

function IconLinux(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M12 3c-2.8 0-5 2.4-5 5.4 0 1.8.8 3.4 2 4.4-.3.9-.5 1.9-.5 2.9 0 2.2 1.5 4 3.4 4.3v1.5h1.2v-1.4c.6.1 1.2.1 1.9 0v1.4H16v-1.5c1.9-.3 3.4-2.1 3.4-4.3 0-1-.2-2-.5-2.9 1.2-1 2-2.6 2-4.4C21 5.4 18.8 3 16 3c-.9 0-1.7.3-2.4.7A4.6 4.6 0 0 0 12 3Z"
      />
      <circle cx="10.2" cy="9.8" r="0.7" fill="var(--l-bg)" />
      <circle cx="13.8" cy="9.8" r="0.7" fill="var(--l-bg)" />
    </svg>
  );
}

function IconHelm(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        d="M12 4c-3.3 0-6 1.8-6 4s2.7 4 6 4 6-1.8 6-4-2.7-4-6-4Zm-8 8c0 2.2 3.6 4 8 4s8-1.8 8-4M4 16c0 2.2 3.6 4 8 4s8-1.8 8-4"
      />
      <path stroke="currentColor" strokeWidth="1.5" d="M12 4v16" />
    </svg>
  );
}

function IconMinio(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M4 18.5 12 4l8 14.5H4Zm4.2-2.5h7.6L12 8.5 8.2 16Z"
      />
    </svg>
  );
}

function IconAws(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M6.5 16.5c4.2 2.2 9.7 2.2 13.8 0 .3-.2.6.1.4.4-1.5 1.8-4.2 3-7.3 3s-5.8-1.2-7.3-3c-.2-.3 0-.6.4-.4ZM5.8 14.2c5.1 2.8 11.9 2.8 17 0 .3-.2.6.1.4.4-.6.7-1.6 1.3-2.8 1.8-2.4 1-5.2 1-7.6 0-1.2-.5-2.2-1.1-2.8-1.8-.2-.3 0-.6.4-.4Z"
      />
      <path fill="currentColor" d="M12 5.5 5.2 8.1c-.3.1-.3.5 0 .6L12 11.3l6.8-2.6c.3-.1.3-.5 0-.6L12 5.5Z" />
    </svg>
  );
}

function IconCloudflare(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M16.8 10.2a3.6 3.6 0 0 0-3.5-2.8H8.4a4.8 4.8 0 0 0 .1 9.6h8.1a3.2 3.2 0 0 0 0-6.4h-.5a2.4 2.4 0 0 1-2.3-2 2.2 2.2 0 0 1 2.2-2.4h.8Z"
      />
    </svg>
  );
}

const ICONS: Record<PlatformId, (props: SVGProps<SVGSVGElement>) => ReactElement> = {
  "on-prem": IconOnPrem,
  kubernetes: IconKubernetes,
  docker: IconDocker,
  linux: IconLinux,
  helm: IconHelm,
  minio: IconMinio,
  "aws-s3": IconAws,
  "cloudflare-r2": IconCloudflare,
};

export function PlatformBubbles() {
  return (
    <div className="landing-platform-bubbles" aria-hidden>
      {PLATFORMS.map((platform, index) => {
        const Icon = ICONS[platform.id];
        return (
          <div
            key={`${platform.id}-${index}`}
            className="landing-platform-bubble"
            style={{
              left: `${platform.x}%`,
              top: `${platform.y}%`,
              width: platform.size,
              height: platform.size,
              animationDelay: `${platform.delay}s`,
              animationDuration: `${platform.duration}s`,
            }}
          >
            <Icon className="landing-platform-icon" />
            <span className="landing-platform-label">{platform.label}</span>
          </div>
        );
      })}
    </div>
  );
}
