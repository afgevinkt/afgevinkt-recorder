/** Seconden → m:ss (mono-timer). */
export function mmss(totaalSec: number): string {
  const s = Math.max(0, Math.floor(totaalSec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Bytes → leesbare grootte. */
export function bytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "—";
  const eenheden = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < eenheden.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${eenheden[i]}`;
}
