import { fork } from "child_process";
import path from "path";
import { CompiledTemplate } from "../compile/nodes";
import type { ThumbnailJob, ThumbnailReply } from "./thumbnailWorker";

// Render a compiled template's page 1, filled with the sample invoice, to a PNG `widthPx` wide.
//
// The work happens in a short-lived child process (see thumbnailWorker.ts) with a capped heap and a
// hard deadline, so a render can neither pin memory in the API server nor stall it. A render takes
// about a second; thumbnails are only made at publish time, so the spawn cost doesn't matter.

// APP-012 §2: the picker's grid cards are ~155–180 dp wide — up to ~630 px on a 3.5× phone.
export const THUMBNAIL_WIDTH = 640;

const TIMEOUT_MS = 30_000;
const HEAP_MB = 256;

// The worker sits beside this file: .ts under ts-node (dev, scripts), .js once compiled to dist/.
const RUNNING_TS = __filename.endsWith(".ts");
const WORKER = path.join(__dirname, `thumbnailWorker${RUNNING_TS ? ".ts" : ".js"}`);

export function renderThumbnailPng(compiled: CompiledTemplate, widthPx: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER, [], {
      execArgv: [...(RUNNING_TS ? ["-r", "ts-node/register/transpile-only"] : []), `--max-old-space-size=${HEAP_MB}`],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });

    let settled = false;
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      outcome();
    };
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() => reject(new Error(`thumbnail render timed out after ${TIMEOUT_MS / 1000}s`)));
    }, TIMEOUT_MS);

    child.once("message", (msg: ThumbnailReply) =>
      settle(() => (msg.ok ? resolve(Buffer.from(msg.png, "base64")) : reject(new Error(msg.error)))));
    child.once("error", (err) => settle(() => reject(err)));
    child.once("exit", (code, signal) =>
      settle(() => reject(new Error(`thumbnail renderer exited (${signal ?? `code ${code}`}) without a result`))));

    const job: ThumbnailJob = { compiled, widthPx };
    child.send(job);
  });
}
