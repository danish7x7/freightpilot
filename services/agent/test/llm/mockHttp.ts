import { afterEach, beforeEach } from "vitest";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher, type Dispatcher } from "undici";
import type { WireFixture } from "../fixtures/load.js";

/**
 * HTTP-boundary replay harness. Intercepts the Node global `fetch` (undici) so the
 * REAL provider normalization + error classifier + router run against recorded wire
 * fixtures — nothing is mocked at the LlmProvider seam. `disableNetConnect()` makes
 * any un-intercepted request throw, guaranteeing ZERO live calls in CI.
 *
 * Call once at the top of a test file; it registers the vitest before/after hooks.
 */
export function useMockHttp() {
  let mockAgent: MockAgent;
  let original: Dispatcher;

  beforeEach(() => {
    original = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(async () => {
    setGlobalDispatcher(original);
    await mockAgent.close();
  });

  return {
    /** Queue one raw wire response for a POST to `origin + path`. */
    intercept(origin: string, path: string, fixture: WireFixture): void {
      mockAgent
        .get(origin)
        .intercept({ path, method: "POST" })
        .reply(fixture.status, fixture.body as object);
    },
    /** The live MockAgent — for asserting which interceptors were (not) consumed. */
    get agent(): MockAgent {
      return mockAgent;
    },
  };
}
