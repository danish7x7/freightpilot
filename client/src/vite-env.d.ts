/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Gateway origin for rates-service. Defaults to http://localhost:8080 for local compose. */
  readonly VITE_RATES_URL?: string;
  /** Gateway origin for booking-service. Defaults to http://localhost:8081 for local compose. */
  readonly VITE_BOOKING_URL?: string;
  /**
   * Origin for agent-service. Defaults to "" (SAME-ORIGIN) so requests are relative and the Vite
   * dev proxy (or the prod gateway) forwards them to :8082 — keeping the confirmation token on a
   * same-origin fetch. Set only to point the client at a non-proxied agent origin.
   */
  readonly VITE_AGENT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
