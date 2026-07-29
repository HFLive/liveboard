type SiteBrandMarkProps = {
  className?: string;
  tone: "light" | "dark";
};

export function SiteBrandMark({ className = "", tone }: SiteBrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`site-brand-mark ${className}`.trim()}
      data-brand-tone={tone}
      style={{
        backgroundImage: `var(--site-brand-icon-${tone})`,
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "contain",
      }}
    >
      <span className="site-brand-fallback">LB</span>
    </span>
  );
}
