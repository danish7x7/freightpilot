# ADR-0010: Publish the agent-service OpenAPI contract — supersedes ADR-0009 Flag 7

- **Status:** accepted
- **Date:** 2026-07-22
- **Phase/Layer:** Phase 2 / D14 (client chat UI + confirmation-gate wiring, §L5)
- **Deviates from master plan:** no — it RETURNS to the plan. `contracts/agent.openapi.yaml` is listed in the §5 source tree (`MASTER_PLAN.md`) and named in `contracts/README.md` as a coming Phase-2 spec. ADR-0009 Flag 7 was the deviation; this ADR ends it.

## Context
ADR-0009 Flag 7 ruled the confirmation-gate endpoints "UI-internal" and published **no** OpenAPI/spectral contract for agent-service, unlike rates/booking. The stated reasoning: the endpoints are "consumed by the same-origin L5 chat UI, not external clients." That consumer did not exist yet. D14 is that consumer arriving — a chat panel in the separately-built, separately-deployed `@freightpilot/client` package that reaches agent-service over HTTP. Both halves of Flag 7's premise now fail inspection: the client is **not same-origin** (it calls services cross-origin via absolute `VITE_*_URL`; the nginx gateway that would make it same-origin is deferred, `docker-compose.yml`), and it is **not internal** (a different package/deploy unit consuming the API over the wire). Triggered by the D14 design review (architecture-guardian PASS WITH CONDITIONS, Condition 1) and the §5 contracts-first rule.

## Options considered
1. **Uphold Flag 7 — hand-roll `CardState`/`RedeemResult`/error-code types in the client.** Pro: no new spec. Con: the client would **fork** the server's shapes with nothing to catch drift — the exact failure §5's "generated client, do not fork" + spectral/oasdiff gate exists to prevent. Every existing client api file already pulls its types from generated contracts for this reason. Rejected.
2. **Publish `contracts/agent.openapi.yaml`, generate the client, join the §5 gate (chosen).** Pro: one source of truth; CI catches drift; completes a spec the plan tree and `contracts/README.md` already advertised. Con: a new spec to maintain — accepted; it is the same discipline the other two services already carry.

## Decision
Publish `contracts/agent.openapi.yaml` covering the **full public surface the client consumes** — `POST /api/v1/turns` (the four-arm turn response) plus the two confirmation-gate endpoints (`GET`/`POST /api/v1/confirmations/{token}`) — and wire it into the same tooling as rates/booking: spectral lint (`pnpm lint` globs `*.openapi.yaml`), the oasdiff breaking-change gate (CI loops `contracts/*.openapi.yaml`; a brand-new spec with no base version is skipped), and client generation (`client gen:api` → `client/src/api/agent.gen.ts`, drift-checked by `git diff --exit-code src/api`). This **supersedes ADR-0009 Flag 7**; ADR-0009 remains the historical record of why Flag 7 was reasonable while agent-service had no consumer.

Deciding rationale: a contract's job is to stop a consumer's types drifting from the server's. The moment a separately-built client consumes the gate over HTTP, that job exists — regardless of runtime origin — so §5 binds agent-service exactly as it binds rates/booking. Documenting the token-bearing `proposal` arm leaks nothing: a spec describes shape, not secret values, and the token is still returned only in the response body and never re-emitted by `GET` (ADR-0009 Cond. F preserved).

## Consequences
- **Easier:** the client generates its agent types (`agent.gen.ts`) and cannot fork gate/turn shapes; any server/spec drift fails CI like rates/booking. The spec is executable documentation of the four-arm turn contract and the two-channel redeem result (200/202 body vs 4xx/5xx envelope).
- **Harder / ruled out:** agent-service now owns a third spec to keep in sync with its hand-written response shapes (it is the server, so it does not generate a client from its own spec — the shapes in `gate/gateService.ts` and the turn handler must match `agent.openapi.yaml` by review + the route integration tests, not by codegen).
- **Revisit when:** the L5 prompt PR lands `POST /api/v1/turns`' live-LLM behaviour (D14 wired the seam with no system prompt — see the D14 journal); if the turn contract grows (streaming, richer tool arms) the spec and its oasdiff gate move with it. When the nginx gateway lands and the client becomes genuinely same-origin, the contract stays — the "external consumer" argument was never the only reason; drift-prevention is.

---

## Amendment A — 2026-08-03: the client is now same-origin for rates and booking too, via the Vite proxy — a Context premise falls, the decision does not

**Status of the original decision: UPHELD.** Nothing here reverses. The contract stays published, the
codegen stays, the spectral and oasdiff gates are untouched. What changes is one **factual premise in
the Context above**, which is now partly false and would otherwise be trusted by a later reader.

### The premise that moved

The Context (line 9) argues Flag 7's premise failed on two counts, one being that "the client is
**not same-origin** (it calls services cross-origin via absolute `VITE_*_URL`; the nginx gateway that
would make it same-origin is deferred, `docker-compose.yml`)." As of 2026-08-03 that is **half
false**: the client is same-origin for all three services in dev and in `vite preview`, via the Vite
proxy, **without** the nginx gateway having landed.

This does **not** resurrect Flag 7. The deciding rationale already said the origin argument was never
load-bearing — "a contract's job is to stop a consumer's types drifting from the server's… regardless
of runtime origin" — and the Revisit-when pre-committed to exactly this case: "When the nginx gateway
lands and the client becomes genuinely same-origin, the contract stays." So the **Revisit-when has
partially triggered, earlier than expected and by a different mechanism than the one it named** (a
dev-server proxy, not the gateway), and the ADR survived it because it was argued on drift-prevention
rather than on origin. Worth stating plainly: this is a decision aging well.

### What changed, and the scope it widens

D14 Condition 7 proxied **only** the agent surface. The reason was specific and security-bearing: the
single-use confirmation token is a secret credential (ADR-0009 Cond. F), so it must ride a
same-origin fetch and never cross an origin boundary. rates and booking stayed cross-origin on
absolute `VITE_RATES_URL` / `VITE_BOOKING_URL` bases, and `client/vite.config.ts` carried a comment
reading "only the agent surface is proxied" — which read as a decision but was a scope statement from
an agent-only PR.

rates and booking are now proxied too. All browser-to-service traffic is same-origin in dev and in
`vite preview`. No service grows a CORS surface. The two agent rules are byte-identical to before;
the two new services simply join the same map.

### Why, with the evidence

The browser blocked `GET /api/v1/rates/search` from `http://localhost:5173`:

```
Access to fetch at 'http://localhost:8080/api/v1/rates/search?...' from origin
'http://localhost:5173' has been blocked by CORS policy: Response to preflight
request doesn't pass access control check: No 'Access-Control-Allow-Origin'
header is present on the requested resource.
```

The Network tab showed a preflight returning **403**. The preflight exists at all because the
`X-Request-Id` middleware in `client/src/api/rates.ts` makes the GET **non-simple**. A CORS fix would
therefore have required `Access-Control-Allow-Origin` **and** `Access-Control-Allow-Headers:
X-Request-Id` on **both** rates-service and booking-service. Same-origin removes the preflight rather
than configuring around it, and it keeps `X-Request-Id` reaching each service unchanged (§5: in,
echoed out, logged). Verified independently by security-reviewer: rates-service has no
`spring-boot-starter-security` and no `addCorsMappings`, so the 403 is Spring MVC's
`DefaultCorsProcessor.rejectRequest` firing on a preflight with no CORS configuration at all.

### The rejected alternative

Per-service CORS config on rates and booking. Rejected because it builds a **permanent**
cross-origin surface for a topology `MASTER_PLAN` does not have: the plan targets single-origin
behind a gateway (§9), and `docker-compose.yml` records nginx as deferred, not cancelled. Adding CORS
would normalize in the stack precisely the thing D14 Condition 7 went out of its way to avoid for the
token. architecture-guardian reviewed and rejected this alternative explicitly.

### The `/api/v1/quotes` collision this forced

`/api/v1/quotes` is **split across two services in the contracts**: rates owns
`/api/v1/quotes/calculate`; booking owns `/api/v1/quotes` and `/api/v1/quotes/{id}/hold`. Vite treats
a proxy key not starting with `^` as `url.startsWith(key)`, so a plain `/api/v1/quotes` prefix would
swallow `/calculate` and routing would be decided by **object-key insertion order**. The keys for
rates and booking are therefore **mutually exclusive regexes**, not prefixes; the agent keys stay
plain prefixes because nothing collides with them.

Note the asymmetry with the future gateway: nginx resolves the same collision by **longest-prefix
`location` matching** and will not need the regexes. The two mechanisms differ; the resulting
path-to-service table must not. The gateway PR should reuse that table rather than re-derive it.

### The guard

`client/test/proxyContract.test.ts` derives expected routing from the three contract files (`rates`
8080, `booking` 8081, `agent` 8082), substitutes sample values for `{param}` segments, and
reimplements Vite's matcher, so the proxy map cannot drift from the contracts. It asserts **exactly
one** rule matches each contract path (not "at least one" — two matches would mean insertion-order
routing), asserts the same with a query string appended, and asserts the reverse, that every rule
matches at least one contract path, so a rule for a deleted path fails the build.

Verified against four mutations, all of which turned it red:

- (a) the `^/api/v1/quotes/calculate` rule's target swapped to 8081 → 2 failures naming expected 8080 / actual 8081
- (b) that rule deleted entirely → 2 failures reporting 0 matches
- (c) `^/api/v1/quotes(\?|$)` replaced by the plain key `/api/v1/quotes` → 4 failures, showing the key swallowing `/calculate` and colliding with `/hold`
- (d) an orphan rule for `/api/v1/telemetry/summary`, a path in no contract → 1 failure

### Carried, not fixed

Both are open, and stated here so they are not later rediscovered as surprises.

- **The `vite` range floor.** `client/package.json` declares `^5.4.11`. The proxy's dev-time safety
  leans on `corsMiddleware` defaulting to loopback origins and on `hostCheckMiddleware`
  (anti-DNS-rebinding), which are 5.4.12+/5.4.19+ behaviour. The lockfile pins **5.4.21**, so nothing
  is exploitable today; this is about the declared range, not the installed tree. Not moved because
  changing the range without regenerating the lockfile breaks `pnpm install --frozen-lockfile` in CI,
  which is beyond a client-transport change.
- **Vite logs the full request path, including a confirmation token, on proxy error.** Its
  `proxy.on("error")` handler logs `originalRes.req.url`, so with agent-service down a
  `POST /api/v1/confirmations/<TOKEN>` puts the secret token in the dev server's terminal. **This is
  pre-existing from D14**, not introduced here — the two agent rules are byte-identical. Flag it as
  something a deployed gateway **INHERITS**: the token travels in a URL path segment, so nginx access
  logs will hold tokens too unless the gateway is configured to redact that path. That is a real
  consideration for the L7 gateway work and for anything that ships logs off-box — a token in an
  access log is a single-use credential at rest in a place with different retention and access rules
  than the database it was minted into.

### Still unrecorded

architecture-guardian recommended a **new** ADR establishing the project-wide constraint "no service
grows a CORS surface; all browser-to-service traffic is same-origin (Vite in dev, nginx in prod)".
That ADR was **not** written: the task that produced this change was scoped to `client/` and forbade
touching `docs/decisions/`. This amendment is narrower — it records what happened to ADR-0010's
premise only. The broader constraint remains unrecorded; a future session should not assume it is
written down somewhere.

### Consequences

- **Easier:** one transport story for the whole client — every browser-to-service call is same-origin
  in dev and preview, so no preflight, no CORS headers to keep in sync across a Java service and two
  Fastify services, and `X-Request-Id` reaches each service unchanged.
- **Unchanged:** the decision above. The contract, the codegen and the spectral/oasdiff gates are
  exactly as accepted on 2026-07-22; only the Context's origin premise is now half false, corrected
  here rather than edited in place.
- **Harder / ruled out:** the proxy map is now a routing table that must stay consistent with three
  contracts, and two of its keys are regexes rather than readable prefixes. That cost is paid down by
  `client/test/proxyContract.test.ts`, which fails the build on drift in either direction.
- **Revisit if/when:** the nginx gateway lands (it inherits the path-to-service table, resolves the
  `/api/v1/quotes` collision by longest-prefix `location` instead of regexes, and inherits the
  token-in-access-log exposure), the `vite` range floor is raised alongside a lockfile regeneration,
  or the project-wide "no CORS surface" constraint is finally written as its own ADR.
