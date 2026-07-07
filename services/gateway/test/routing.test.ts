import { describe, expect, it, beforeEach } from "vitest";
import { Router } from "../src/routing/router.js";
import { resetPersona, unbound, unroutable } from "../src/voice/persona.js";

describe("Router.matchRegex", () => {
  const router = new Router();

  it("resolves tight rundown phrasings deterministically", () => {
    for (const input of ["give me the rundown", "morning brief", "brief me"]) {
      const hit = router.matchRegex(input);
      expect(hit?.actionId).toBe("rundown");
      expect(hit?.source).toBe("regex");
      expect(hit?.confidence).toBe(1);
    }
  });

  it("routes inbox triage asks", () => {
    for (const input of ["triage my inbox", "check my email", "unread emails"]) {
      expect(router.matchRegex(input)?.actionId).toBe("inbox-triage");
    }
  });

  it("captures the ticket id into parameters for ship-ticket", () => {
    const hit = router.matchRegex("ship SCA-431");
    expect(hit?.actionId).toBe("ship-ticket");
    expect(hit?.parameters).toEqual({ ticketId: "SCA-431" });

    const withWord = router.matchRegex("ship ticket ABC-12");
    expect(withWord?.parameters).toEqual({ ticketId: "ABC-12" });
  });

  it("does not deterministically ship without a ticket id", () => {
    expect(router.matchRegex("ship it")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(router.matchRegex("what's the weather on mars")).toBeNull();
  });
});

describe("persona", () => {
  beforeEach(() => resetPersona());

  it("names the unroutable input and suggests capabilities", () => {
    const line = unroutable("play some jazz");
    expect(line).toContain('"play some jazz"');
    expect(line.toLowerCase()).toContain("try");
  });

  it("varies the lead phrasing across consecutive calls", () => {
    const a = unroutable("x");
    const b = unroutable("x");
    expect(a).not.toBe(b);
  });

  it("explains an unbound action honestly", () => {
    expect(unbound("rundown")).toContain("rundown");
  });
});
