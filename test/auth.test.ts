import { describe, expect, it } from "vitest";
import {
  ATTEMPT_WINDOW_SECONDS, MAX_ATTEMPTS, SESSION_SECONDS, createSessionValue, evaluateAttempts, passcodeMatches, verifySessionValue,
} from "../src/server/auth";

const NOW = 1_800_000_000;

describe("passcode check", () => {
  it("accepts the right passcode only", async () => {
    expect(await passcodeMatches("correct horse", "correct horse")).toBe(true);
    expect(await passcodeMatches("correct hors", "correct horse")).toBe(false);
    expect(await passcodeMatches("", "correct horse")).toBe(false);
  });
  it("never accepts anything when no passcode is set", async () => {
    expect(await passcodeMatches("", "")).toBe(false);
  });
});

describe("signed session cookie", () => {
  it("is valid for 30 days", async () => {
    const value = await createSessionValue("secret-pass", NOW);
    expect(await verifySessionValue(value, "secret-pass", NOW)).toBe(true);
    expect(await verifySessionValue(value, "secret-pass", NOW + SESSION_SECONDS - 1)).toBe(true);
    expect(await verifySessionValue(value, "secret-pass", NOW + SESSION_SECONDS + 1)).toBe(false);
  });
  it("is rejected if tampered with", async () => {
    const value = await createSessionValue("secret-pass", NOW);
    const [v, exp, sig] = value.split(".");
    const longer = `${v}.${Number(exp) + 999999}.${sig}`; // try to extend the expiry
    expect(await verifySessionValue(longer, "secret-pass", NOW)).toBe(false);
    expect(await verifySessionValue(`${v}.${exp}.AAAA`, "secret-pass", NOW)).toBe(false);
    expect(await verifySessionValue("garbage", "secret-pass", NOW)).toBe(false);
    expect(await verifySessionValue(undefined, "secret-pass", NOW)).toBe(false);
  });
  it("stops working when the passcode changes", async () => {
    const value = await createSessionValue("old-pass", NOW);
    expect(await verifySessionValue(value, "new-pass", NOW)).toBe(false);
  });
  it("does not contain the passcode", async () => {
    expect(await createSessionValue("secret-pass", NOW)).not.toContain("secret-pass");
  });
});

describe("wrong-passcode rate limit", () => {
  it("allows a first try and tries under the limit", () => {
    expect(evaluateAttempts(null, MAX_ATTEMPTS, NOW).allowed).toBe(true);
    expect(evaluateAttempts({ count: MAX_ATTEMPTS - 1, window_start: NOW - 10 }, MAX_ATTEMPTS, NOW).allowed).toBe(true);
  });
  it("locks after too many wrong tries and says how long to wait", () => {
    const res = evaluateAttempts({ count: MAX_ATTEMPTS, window_start: NOW - 60 }, MAX_ATTEMPTS, NOW);
    expect(res.allowed).toBe(false);
    expect(res.retryAfter).toBe(ATTEMPT_WINDOW_SECONDS - 60);
  });
  it("unlocks when the 15 minutes are over", () => {
    expect(evaluateAttempts({ count: 99, window_start: NOW - ATTEMPT_WINDOW_SECONDS }, MAX_ATTEMPTS, NOW).allowed).toBe(true);
  });
});
