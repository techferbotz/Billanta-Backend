import { BadRequestError } from "./errors/AppError";
import { ParseValuesOptions, Values, ValuesError, parseValues } from "../fields/values";

// The HTTP edge of values-map validation: the same checks as fields/values.ts, with a failure
// turned into the standard 400 envelope. DTOs call this; the pure parser stays HTTP-free.
export const parseValuesOr400 = (raw: unknown, field: string, opts: ParseValuesOptions): Values => {
  try {
    return parseValues(raw, field, opts);
  } catch (err) {
    if (err instanceof ValuesError) throw new BadRequestError(err.message);
    throw err;
  }
};
