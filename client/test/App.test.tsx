import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import App from "../src/App";

test("renders the FreightPilot heading and the rate search form", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /freightpilot/i })).toBeDefined();
  // The search form is the entry point of the rates manual flow (no network on mount:
  // the search query stays disabled until a search is submitted).
  expect(screen.getByRole("button", { name: /search rates/i })).toBeDefined();
});
