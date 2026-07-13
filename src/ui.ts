import { stdout } from "node:process";

let colorEnabled = Boolean(stdout.isTTY) && !process.env.NO_COLOR;

/** Force color on/off (tests, or explicit user preference). */
export function setColor(on: boolean): void {
  colorEnabled = on;
}

function wrap(open: number, close: number, s: string): string {
  return colorEnabled ? `\x1b[${open}m${s}\x1b[${close}m` : s;
}

/** Semantic colors: cyan=action, green=success, yellow=warn, red=error, gray=meta. */
export const style = {
  bold: (s: string) => wrap(1, 22, s),
  dim: (s: string) => wrap(2, 22, s),
  gray: (s: string) => wrap(90, 39, s),
  cyan: (s: string) => wrap(36, 39, s),
  green: (s: string) => wrap(32, 39, s),
  yellow: (s: string) => wrap(33, 39, s),
  red: (s: string) => wrap(31, 39, s),
};

const ANSI = /\x1b\[[0-9;]*m/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}
export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}
export function padEndVisible(s: string, n: number): string {
  const len = visibleLength(s);
  return len >= n ? s : s + " ".repeat(n - len);
}
export function termWidth(): number {
  return stdout.columns && stdout.columns > 0 ? stdout.columns : 80;
}

/** Rounded card with a title and label/value rows. */
export function card(
  title: string,
  rows: { left: string; right?: string }[],
  width = Math.min(termWidth(), 68),
): string {
  const minTitleWidth = visibleLength(`╭─ ${title} `) + 1;
  const minRowWidth = Math.max(
    0,
    ...rows.map(({ left, right = "" }) => visibleLength(left) + visibleLength(right) + 5),
  );
  width = Math.max(width, minTitleWidth, minRowWidth);
  const textArea = width - 4;
  const header = `╭─ ${style.bold(title)} `;
  const top = header + "─".repeat(Math.max(0, width - visibleLength(header) - 1)) + "╮";
  const bottom = "╰" + "─".repeat(width - 2) + "╯";
  const body = rows.map(({ left, right = "" }) => {
    const gap = textArea - visibleLength(left) - visibleLength(right);
    return "│ " + left + " ".repeat(Math.max(1, gap)) + right + " │";
  });
  return [top, ...body, bottom].join("\n");
}

/** Aligned table with gray headers. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(visibleLength(h), ...rows.map((r) => visibleLength(r[i] ?? ""))),
  );
  const fmt = (cells: string[]) =>
    "  " + cells.map((c, i) => padEndVisible(c, widths[i])).join("   ");
  const head = fmt(headers.map((h) => style.gray(h)));
  const body = rows.map((r) => fmt(r));
  return [head, ...body].join("\n");
}

/** mm:ss from a millisecond duration. */
export function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Coarse relative time in English. */
export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hr`;
  return `${Math.round(h / 24)} days`;
}
