import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import App from "../src/App";

test("renders the FreightPilot heading", () => {
  render(<App />);
  expect(
    screen.getByRole("heading", { name: /freightpilot/i }),
  ).toBeDefined();
});
