import type { ProxyOptions } from "vite";

/**
 * The one dev-transport routing table: browser path -> owning service.
 *
 * SOURCE OF TRUTH IS `contracts/*.openapi.yaml` (guardian C8). This map is a DERIVED second copy
 * of a fact the contracts already state, so it is proven against them by `test/proxyContract.test.ts`
 * rather than maintained by hand. That test asserts every contract path matches EXACTLY ONE rule
 * here, and that every rule matches at least one contract path.
 *
 * WHY PROXY AT ALL, rather than adding CORS config to rates-service and booking-service.
 * The observed failure was a PREFLIGHT, not a simple cross-origin GET: the `X-Request-Id` middleware
 * in `src/api/rates.ts` makes the request non-simple, so the browser sent an OPTIONS preflight that
 * rates-service answered 403 with no `Access-Control-Allow-Origin`. Fixing that with CORS would mean
 * adding `Access-Control-Allow-Origin` AND `Access-Control-Allow-Headers: X-Request-Id` to BOTH
 * services, i.e. building a permanent security surface on two services to work around a dev-only
 * symptom. Same-origin removes the preflight entirely instead of configuring around it, and it keeps
 * `X-Request-Id` reaching each service unchanged (§5: in, echoed out, logged). This generalizes the
 * rule ADR-0010 / D14 Condition 7 established for the agent surface, where the same-origin property
 * is load-bearing for a different reason: the confirmation token is a secret credential and must not
 * cross an origin boundary.
 *
 * WHY SOME KEYS ARE REGEXES AND THE AGENT KEYS ARE NOT.
 * `/api/v1/quotes` is SPLIT across two services in the contracts:
 *   - rates-service owns `/api/v1/quotes/calculate`
 *   - booking-service owns `/api/v1/quotes` and `/api/v1/quotes/{id}/hold`
 * Vite treats a key that does not start with "^" as `url.startsWith(key)`, so a plain
 * `/api/v1/quotes` key would swallow `/api/v1/quotes/calculate` too, and which service won would be
 * decided by object-key insertion order. Routing that depends on property order is not a routing
 * table, it is a coincidence. The three `quotes` regexes below are mutually exclusive, so ordering
 * is irrelevant and the "exactly one rule matches" assertion in the test is satisfiable at all.
 *
 * The agent keys stay plain prefixes because nothing collides with them and D14 wrote them that way.
 *
 * nginx resolves the same collision by longest-prefix `location` matching (`/api/v1/quotes/calculate`
 * beats `/api/v1/quotes` naturally), which is why the deployed gateway will not need these regexes.
 * The two mechanisms differ; the resulting path -> service table must not. When the gateway lands
 * (L7 / §9), reuse this table rather than re-deriving it.
 *
 * ONE THING THE GATEWAY MUST ADD THAT THIS DOES NOT: path normalization. Vite matches raw `req.url`
 * and Node does not normalize, so `/api/v1/rates/%2e%2e%2f%2e%2e%2fx` matches the rates rule and is
 * forwarded as-is, and Tomcat then normalizes it to something else. That is proxy path confusion.
 * It is inert here (dev-only, and rates-service has no actuator or security starter behind it to
 * traverse to), but it stops being inert the moment this table fronts a service with an admin path.
 * Normalize and reject encoded separators at the gateway.
 *
 * TRAILING SLASHES fall through deliberately. `^/api/v1/rates/`, `^/api/v1/bookings(/|\?|$)` and the
 * two agent prefixes tolerate one; the three `quotes` rules do not, so `/api/v1/quotes/` and
 * `/api/v1/quotes/calculate/` match nothing and hit the SPA fallback. That asymmetry is accepted
 * rather than papered over: openapi-fetch emits the contract path literal, so no client call can
 * produce a trailing slash, and the contract test only asserts the paths the contracts declare.
 * If a hand-written fetch ever needs one, add `/?` to the three quotes rules (exclusivity survives).
 *
 * No `rewrite` anywhere: the proxied paths are byte-identical to the contract paths, which is what
 * keeps §2.2 rule 1 true (the UI and the agent hit the SAME documented public paths).
 */
export const proxyConfig: Record<string, ProxyOptions> = {
  // --- rates-service :8080 ---
  "^/api/v1/rates/": { target: "http://localhost:8080", changeOrigin: true },
  "^/api/v1/quotes/calculate(\\?|$)": { target: "http://localhost:8080", changeOrigin: true },

  // --- booking-service :8081 ---
  "^/api/v1/quotes(\\?|$)": { target: "http://localhost:8081", changeOrigin: true },
  "^/api/v1/quotes/[^/]+/hold(\\?|$)": { target: "http://localhost:8081", changeOrigin: true },
  "^/api/v1/bookings(/|\\?|$)": { target: "http://localhost:8081", changeOrigin: true },

  // --- agent-service :8082 (unchanged from D14 Condition 7) ---
  "/api/v1/turns": { target: "http://localhost:8082", changeOrigin: true },
  "/api/v1/confirmations": { target: "http://localhost:8082", changeOrigin: true },
};
