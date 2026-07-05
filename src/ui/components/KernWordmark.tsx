interface KernWordmarkProps {
  className?: string;
  showText?: boolean;
}

export function KernWordmark({ className = "", showText = true }: KernWordmarkProps) {
  return (
    <span className={`kern-wordmark${className ? ` ${className}` : ""}`}>
      <span className="kern-logo-mark kern-logo-mark-solid">
        <span className="kern-logo-k">K</span>
      </span>
      {showText ? <span className="kern-logo-text">ERN</span> : null}
    </span>
  );
}
