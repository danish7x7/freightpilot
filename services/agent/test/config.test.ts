import { describe, expect, test } from "vitest";
import { loadServiceConfig } from "../src/config.js";

describe("loadServiceConfig", () => {
  const VALID = {
    RATES_SERVICE_URL: "http://rates-service:8080",
    BOOKING_SERVICE_URL: "http://booking-service:8081",
    AGENT_DATABASE_URL: "postgres://agent:agent_dev@agent-db:5432/agent",
  } as NodeJS.ProcessEnv;

  test("parses the compose-injected service URLs + database URL", () => {
    expect(loadServiceConfig(VALID)).toEqual({
      ratesServiceUrl: "http://rates-service:8080",
      bookingServiceUrl: "http://booking-service:8081",
      agentDatabaseUrl: "postgres://agent:agent_dev@agent-db:5432/agent",
    });
  });

  test("throws a readable error when a service URL is missing", () => {
    expect(() =>
      loadServiceConfig({
        RATES_SERVICE_URL: "http://rates-service:8080",
        AGENT_DATABASE_URL: "postgres://agent:agent_dev@agent-db:5432/agent",
      } as NodeJS.ProcessEnv),
    ).toThrow(/BOOKING_SERVICE_URL/);
  });

  test("throws when the database URL is missing", () => {
    expect(() =>
      loadServiceConfig({
        RATES_SERVICE_URL: "http://rates-service:8080",
        BOOKING_SERVICE_URL: "http://booking-service:8081",
      } as NodeJS.ProcessEnv),
    ).toThrow(/AGENT_DATABASE_URL/);
  });

  test("throws when a URL is malformed", () => {
    expect(() =>
      loadServiceConfig({ ...VALID, RATES_SERVICE_URL: "not-a-url" }),
    ).toThrow(/RATES_SERVICE_URL/);
  });
});
