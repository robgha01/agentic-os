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

  it("captures the research topic (past an optional connector) into parameters", () => {
    expect(router.matchRegex("last 30 days on sport")).toMatchObject({
      actionId: "last-30-days",
      parameters: { topic: "sport" },
    });
    expect(router.matchRegex("last 30 days of sport")?.parameters).toEqual({ topic: "sport" });
    expect(router.matchRegex("deep research electric vehicles")?.parameters).toEqual({
      topic: "electric vehicles",
    });
    // a connector-shaped word that's actually part of the topic isn't eaten
    expect(router.matchRegex("last 30 days onboarding")?.parameters).toEqual({ topic: "onboarding" });
  });

  it("does not deterministically run research without a topic", () => {
    expect(router.matchRegex("last 30 days")).toBeNull();
    expect(router.matchRegex("deep research")).toBeNull();
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
