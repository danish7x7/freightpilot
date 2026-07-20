/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Gateway origin for rates-service. Defaults to http://localhost:8080 for local compose. */
  readonly VITE_RATES_URL?: string;
  /** Gateway origin for booking-service. Defaults to http://localhost:8081 for local compose. */
  readonly VITE_BOOKING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
