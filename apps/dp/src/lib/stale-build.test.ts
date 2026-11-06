// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { canReloadFresh, isPageLeaving, isStaleBuildError } from "./stale-build";

describe("isStaleBuildError", () => {
  it("recognises a missing code file from an older deploy", () => {
    for (const msg of [
      "error loading dynamically imported module: https://corvusre.com/corvusdp/assets/x.js",
      "Failed to fetch dynamically imported module: https://corvusre.com/corvusdp/assets/x.js",
      "Importing a module script failed.",
    ])
      expect(isStaleBuildError(new TypeError(msg))).toBe(true);
  });
  it("leaves real errors alone", () => {
    expect(isStaleBuildError(new Error("Cannot read properties of undefined"))).toBe(false);
  });
});

describe("canReloadFresh", () => {
  afterEach(() => sessionStorage.clear());
  it("allows one fresh reload, then waits two minutes", () => {
    expect(canReloadFresh()).toBe(true);
    sessionStorage.setItem("corvusdp.freshReloadAt", String(Date.now()));
    expect(canReloadFresh()).toBe(false);
    sessionStorage.setItem("corvusdp.freshReloadAt", String(Date.now() - 3 * 60 * 1000));
    expect(canReloadFresh()).toBe(true);
  });
});

describe("isPageLeaving", () => {
  it("is set while the page navigates away and cleared when it is restored", () => {
    expect(isPageLeaving()).toBe(false);
    window.dispatchEvent(new Event("pagehide"));
    expect(isPageLeaving()).toBe(true);
    window.dispatchEvent(new Event("pageshow"));
    expect(isPageLeaving()).toBe(false);
  });
});
