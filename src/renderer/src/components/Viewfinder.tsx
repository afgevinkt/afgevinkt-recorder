import type { ReactNode } from "react";

// Signature-motief: camera-framing brackets om de bron / live preview.
// live=true kleurt de hoeken coral en toont een REC-badge met mono-timer.
export default function Viewfinder({
  children,
  live = false,
  badge,
  className,
}: {
  children: ReactNode;
  live?: boolean;
  badge?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`vf${className ? " " + className : ""}`} data-live={live}>
      {children}
      <span className="vf__corner tl" />
      <span className="vf__corner tr" />
      <span className="vf__corner bl" />
      <span className="vf__corner br" />
      {live && (
        <span className="vf__rec">
          <span className="dot" /> {badge ?? "REC"}
        </span>
      )}
    </div>
  );
}
