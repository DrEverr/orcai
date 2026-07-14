import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface ClipboardImage {
  bytes: Uint8Array | null;
  hint: string | null;
}

async function commandExists(cmd: string): Promise<boolean> {
  const proc = Bun.spawn(["/bin/sh", "-c", `command -v ${cmd}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
}

async function capture(cmd: string[]): Promise<Uint8Array | null> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const [buffer, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    proc.exited,
  ]);
  const bytes = new Uint8Array(buffer);
  return exitCode === 0 && bytes.length > 0 ? bytes : null;
}

async function captureMacClipboardWithOsaScript(): Promise<Uint8Array | null> {
  const path = join(tmpdir(), `orcai-clipboard-${crypto.randomUUID()}.png`);
  const script = `
on run argv
  set outPath to item 1 of argv
  set pngData to the clipboard as «class PNGf»
  set outFile to open for access POSIX file outPath with write permission
  set eof of outFile to 0
  write pngData to outFile
  close access outFile
end run
`;
  const proc = Bun.spawn(["osascript", "-e", script, path], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    await rm(path, { force: true });
    return null;
  }
  try {
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    return bytes.length > 0 ? bytes : null;
  } finally {
    await rm(path, { force: true });
  }
}

export async function readClipboardImage(): Promise<ClipboardImage> {
  if (process.platform === "darwin") {
    if (await commandExists("pngpaste")) {
      const bytes = await capture(["pngpaste", "-"]);
      if (bytes) return { bytes, hint: null };
    }
    const bytes = await captureMacClipboardWithOsaScript();
    return bytes
      ? { bytes, hint: null }
      : { bytes: null, hint: "Clipboard does not contain a PNG image." };
  }

  if (process.platform === "linux") {
    if (await commandExists("wl-paste")) {
      const bytes = await capture(["wl-paste", "--no-newline", "--type", "image/png"]);
      if (bytes) return { bytes, hint: null };
    }
    if (await commandExists("xclip")) {
      const bytes = await capture(["xclip", "-selection", "clipboard", "-t", "image/png", "-o"]);
      if (bytes) return { bytes, hint: null };
    }
    return {
      bytes: null,
      hint: "Clipboard image paste needs wl-paste or xclip with a PNG image in the clipboard.",
    };
  }

  return { bytes: null, hint: "Native Windows is not supported for image paste; run orcai through WSL." };
}
