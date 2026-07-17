// Typed domain errors. Each carries the HTTP status + the uniform error-envelope code
// (§5 {code, message, details[]}); the Fastify error handler maps them to responses.
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR";
  readonly httpStatus = 400;
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND";
  readonly httpStatus = 404;
}

/** An out-of-order booking status transition — the single state machine's veto (§2.4). */
export class IllegalTransitionError extends AppError {
  readonly code = "ILLEGAL_TRANSITION";
  readonly httpStatus = 409;
  constructor(
    readonly from: string | null,
    readonly to: string,
  ) {
    super(`Illegal booking transition: ${from ?? "∅"} → ${to}`);
  }
}

/** A precondition on related state failed (e.g. creating a booking from a non-HELD quote). */
export class StateConflictError extends AppError {
  readonly code = "STATE_CONFLICT";
  readonly httpStatus = 409;
}
