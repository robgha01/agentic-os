import { describe, expect, it } from "vitest";
import { renderTemplate } from "../src/skills/skill-runtime.js";

describe("renderTemplate", () => {
  it("fills {{param}} placeholders", () => {
    expect(renderTemplate("ship {{ticketId}} now", { ticketId: "SCA-431" })).toBe("ship SCA-431 now");
  });
  it("renders missing/null params as empty", () => {
    expect(renderTemplate("a {{x}} b {{y}}", { y: null })).toBe("a  b ");
  });
  it("stringifies non-string params", () => {
    expect(renderTemplate("n={{n}}", { n: 3 })).toBe("n=3");
  });
});
