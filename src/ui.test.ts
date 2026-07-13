import { expect, test } from "bun:test";
import {
  fmtDuration,
  padEndVisible,
  relativeTime,
  setColor,
  stripAnsi,
  table,
  visibleLength,
} from "./ui.ts";

setColor(false); // render without ANSI for deterministic assertions

test("fmtDuration formats mm:ss", () => {
  expect(fmtDuration(43_000)).toBe("00:43");
  expect(fmtDuration(78_000)).toBe("01:18");
});

test("stripAnsi and visibleLength ignore escape codes", () => {
  const s = "\x1b[31mabc\x1b[39m";
  expect(stripAnsi(s)).toBe("abc");
  expect(visibleLength(s)).toBe(3);
});

test("padEndVisible pads to width by visible length", () => {
  expect(padEndVisible("ab", 5)).toBe("ab   ");
  expect(padEndVisible("abcde", 3)).toBe("abcde");
});

test("relativeTime buckets minutes", () => {
  expect(relativeTime(new Date(Date.now() - 4 * 60_000).toISOString())).toBe("4 min");
  expect(relativeTime(new Date().toISOString())).toBe("just now");
});

test("table aligns columns", () => {
  const out = table(["ROLE", "MODEL"], [["a", "x"], ["bbb", "y"]]);
  const lines = out.split("\n");
  expect(lines).toHaveLength(3); // header + 2 rows
  // both data rows start their 2nd column at the same offset
  const col2 = (line: string) => line.indexOf("x") >= 0 ? line.indexOf("x") : line.indexOf("y");
  expect(col2(lines[1]!)).toBe(col2(lines[2]!));
});
