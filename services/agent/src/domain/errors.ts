// Typed domain errors for agent-service. Each carries the HTTP status + the uniform
// error-envelope code (§5 {code, message, details[]}); the Fastify error handler maps them
// to responses. Mirrors booking-service's AppError pattern.
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

/** No confirmation exists for the supplied token. */
export class ConfirmationNotFoundError extends AppError {
  readonly code = "CONFIRMATION_NOT_FOUND";
  readonly httpStatus = 404;
}

/** The confirmation exists but its 10-minute TTL (§6.3.2) has elapsed. */
export class ConfirmationExpiredError extends AppError {
  readonly code = "CONFIRMATION_EXPIRED";
  readonly httpStatus = 410;
}

/**
 * At redeem time the referenced quote was no longer bookable (not HELD — e.g. consumed by
 * another booking, or expired in the up-to-10-min window since propose). booking-service
 * returned 409; the gate surfaces it cleanly so the user can re-quote (Condition D).
 */
export class QuoteUnavailableError extends AppError {
  readonly code = "QUOTE_UNAVAILABLE";
  readonly httpStatus = 409;
}

/** booking-service returned an unexpected failure during create (not a clean 409). */
export class BookingExecutionError extends AppError {
  readonly code = "BOOKING_EXECUTION_FAILED";
  readonly httpStatus = 502;
}
