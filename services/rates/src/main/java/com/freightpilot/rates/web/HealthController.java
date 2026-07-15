package com.freightpilot.rates.web;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Shallow liveness check. Deliberately does NOT touch a database — at L0 there
 * is no schema, and readiness/DB probes arrive with the data layer (L1).
 */
@RestController
public class HealthController {

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok", "service", "rates");
    }
}
