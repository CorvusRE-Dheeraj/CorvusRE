// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { canReloadFresh, errorMessage, isStaleBuildError, newErrorRef } from "./client-errors";

describe("isStaleBuildError", () => {
  it("recognizes a missing route file after a deploy, in each browser's wording", () => {
    for (const msg of [
      "Failed to fetch dynamically imported module: https://corvusre.com/corvuspt/assets/intake-CpLMXe0s.js",
      "Importing a module script failed.",
      "error loading dynamically imported module",
    ]) {
      expect(isStaleBuildError(new TypeError(msg))).toBe(true);
    }
  });

  it("leaves ordinary errors alone", () => {
    expect(
      isStaleBuildError(new Error("Cannot read properties of undefined (reading 'cad')")),
    ).toBe(false);
  });
});

describe("canReloadFresh", () => {
  afterEach(() => sessionStorage.clear());

  it("allows one fresh reload, then not again for a while", () => {
    expect(canReloadFresh()).toBe(true);
    sessionStorage.setItem("corvuspt.freshReloadAt", String(Date.now()));
    expect(canReloadFresh()).toBe(false);
    sessionStorage.setItem("corvuspt.freshReloadAt", String(Date.now() - 3 * 60 * 1000));
    expect(canReloadFresh()).toBe(true);
  });
});

describe("error reference and message", () => {
  it("makes short, readable references", () => {
    expect(newErrorRef()).toMatch(/^E-[A-HJ-NP-Z2-9]{6}$/);
  });

  it("describes non-Error values", () => {
    expect(errorMessage(new TypeError("boom"))).toBe("TypeError: boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage({ code: 1 })).toBe('{"code":1}');
  });
});
