import { CompiledTemplate } from "../compile/nodes";
import { layoutPage } from "./layout";
import { rasterize } from "./rasterize";
import { SAMPLE_INVOICE } from "./sampleInvoice";

// Child-process entry point: renders ONE compiled template against the sample invoice, replies
// with the PNG, and exits. Forked per render by renderThumbnail.ts — never imported by the server.
//
// Running in its own process means the renderer's libraries and parsed fonts (well over 100 MB at
// peak) are returned to the OS the moment the render ends, and a pathological template can at worst
// kill this process — never hang or crash the API server.

export interface ThumbnailJob {
  compiled: CompiledTemplate;
  widthPx: number;
}

export type ThumbnailReply = { ok: true; png: string } | { ok: false; error: string };

const reply = (message: ThumbnailReply, code: number): void => {
  // exit only once the message has been handed to the parent
  process.send?.(message, () => process.exit(code));
};

process.once("message", (job: ThumbnailJob) => {
  rasterize(layoutPage(job.compiled, SAMPLE_INVOICE), job.widthPx)
    .then((png) => reply({ ok: true, png: png.toString("base64") }, 0))
    .catch((err: unknown) => reply({ ok: false, error: err instanceof Error ? err.message : String(err) }, 1));
});
