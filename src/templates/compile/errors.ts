// A precise, authored-source-located compilation failure.
//
// Template authoring errors must point a designer at the exact place they went wrong —
// `css: unsupported property "animation" in rule ".header" (line 12)` — not a vague 400.
// CompileError carries a machine `phase` and a human `message` that already includes the
// location, so the admin API can surface it verbatim.
//
// This is a plain error (NOT an AppError): the compiler is a pure library that the admin
// service calls and turns into a 400 with the message. Keeping it decoupled means the
// compiler can be unit-tested and reused without the HTTP error stack.
export type CompilePhase = "html" | "css" | "binding" | "structure";

export class CompileError extends Error {
  public readonly phase: CompilePhase;
  public readonly line?: number;
  public readonly column?: number;

  constructor(phase: CompilePhase, message: string, line?: number, column?: number) {
    // The message is pre-composed WITH the location by the `fail` helpers below, so the
    // `.message` a caller reads is already the exact, designer-facing string.
    super(message);
    this.name = "CompileError";
    this.phase = phase;
    this.line = line;
    this.column = column;
    Object.setPrototypeOf(this, CompileError.prototype);
  }
}

// Compose the trailing "(line N)" / "(line N, col M)" suffix, or nothing when unknown.
const at = (line?: number, column?: number): string => {
  if (line === undefined) return "";
  if (column === undefined) return ` (line ${line})`;
  return ` (line ${line}, col ${column})`;
};

// Throw a located CompileError for a given phase. The `phase:` prefix mirrors the phase so
// the final message reads like `html: unsupported tag <script> (line 4)`.
export const failAt = (
  phase: CompilePhase,
  message: string,
  line?: number,
  column?: number
): never => {
  throw new CompileError(phase, `${phase}: ${message}${at(line, column)}`, line, column);
};

// A value-level normalization failure ("unsupported unit em", "unrecognized color foo"),
// thrown by the pure units/colors helpers which have no idea WHICH property or line they're
// running for. The cascade catches it and re-throws a located CompileError with that context.
// Keeping the helpers ignorant of location is what keeps them trivially unit-testable.
export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
    Object.setPrototypeOf(this, ValueError.prototype);
  }
}
