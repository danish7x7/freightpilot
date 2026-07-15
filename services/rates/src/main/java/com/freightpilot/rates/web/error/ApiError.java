package com.freightpilot.rates.web.error;

import java.util.List;

/** Uniform error envelope {@code {code, message, details[]}} (§5), used everywhere. */
public record ApiError(String code, String message, List<String> details) {

    public static ApiError of(String code, String message) {
        return new ApiError(code, message, List.of());
    }

    public static ApiError of(String code, String message, List<String> details) {
        return new ApiError(code, message, details);
    }
}
