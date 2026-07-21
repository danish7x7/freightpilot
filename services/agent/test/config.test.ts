import { describe, expect, test } from "vitest";
import { loadServiceConfig } from "../src/config.js";

describe("loadServiceConfig", () => {
  test("parses the compose-injected service URLs", () => {
    const cfg = loadServiceConfig({
      RATES_SERVICE_URL: "http://rates-service:8080",
      BOOKING_SERVICE_URL: "http://booking-service:8081",
    } as NodeJS.ProcessEnv);

    expect(cfg).toEqual({
      ratesServiceUrl: "http://rates-service:8080",
      bookingServiceUrl: "http://booking-service:8081",
    });
  });

  test("throws a readable error when a URL is missing", () => {
    expect(() =>
      loadServiceConfig({ RATES_SERVICE_URL: "http://rates-service:8080" } as NodeJS.ProcessEnv),
    ).toThrow(/BOOKING_SERVICE_URL/);
  });

  test("throws when a URL is malformed", () => {
    expect(() =>
      loadServiceConfig({
        RATES_SERVICE_URL: "not-a-url",
        BOOKING_SERVICE_URL: "http://booking-service:8081",
      } as NodeJS.ProcessEnv),
    ).toThrow(/RATES_SERVICE_URL/);
  });
});
