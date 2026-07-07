import { describe, expect, it } from "vitest";
import { isLocalHostHeader, isLocalOrigin } from "../src/bus/origin-guard.js";

describe("isLocalOrigin", () => {
  it("allows localhost origins on any port and scheme", () => {
    expect(isLocalOrigin("http://localhost:5173")).toBe(true);
    expect(isLocalOrigin("http://127.0.0.1:7777")).toBe(true);
    expect(isLocalOrigin("https://localhost")).toBe(true);
  });
  it("allows absent origin (non-browser clients, same-origin fetches)", () => {
    expect(isLocalOrigin(undefined)).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isLocalOrigin("http://evil.example")).toBe(false);
    expect(isLocalOrigin("http://localhost.evil.example")).toBe(false);
    expect(isLocalOrigin("null")).toBe(false);
  });
});

describe("isLocalHostHeader", () => {
  it("allows localhost hosts with or without port", () => {
    expect(isLocalHostHeader("localhost:7777")).toBe(true);
    expect(isLocalHostHeader("127.0.0.1")).toBe(true);
    expect(isLocalHostHeader("[::1]:7777")).toBe(true);
  });
  it("rejects rebound hosts", () => {
    expect(isLocalHostHeader("evil.example:7777")).toBe(false);
    expect(isLocalHostHeader(undefined)).toBe(false);
  });
});
