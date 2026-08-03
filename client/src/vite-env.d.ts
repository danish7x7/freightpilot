/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin for rates-service. Defaults to "" (SAME-ORIGIN) so requests are relative and the Vite
   * dev proxy forwards them to :8080 (no prod gateway exists yet; nginx is L7/§9) — see ../proxy.config.ts.
   * Setting this BYPASSES the proxy and re-introduces a cross-origin request, which rates-service
   * has no CORS surface for; X-Request-Id then triggers a preflight it answers 403. Set it only for
   * a deployment that genuinely fronts the services at a different origin than the client.
   */
  readonly VITE_RATES_URL?: string;
  /**
   * Origin for booking-service. Defaults to "" (SAME-ORIGIN) so requests are relative and the Vite
   * dev proxy forwards them to :8081 (no prod gateway exists yet; nginx is L7/§9) — see ../proxy.config.ts.
   * Same bypass warning as VITE_RATES_URL: booking-service has no CORS surface either.
   */
  readonly VITE_BOOKING_URL?: string;
  /**
   * Origin for agent-service. Defaults to "" (SAME-ORIGIN) so requests are relative and the Vite
   * dev proxy forwards them to :8082 (no prod gateway exists yet; nginx is L7/§9) — keeping the confirmation token on a
   * same-origin fetch. Set only to point the client at a non-proxied agent origin.
   */
  readonly VITE_AGENT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
