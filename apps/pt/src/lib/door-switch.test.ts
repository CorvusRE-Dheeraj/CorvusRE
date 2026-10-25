import { beforeEach, describe, expect, it } from "vitest";
import { getActiveDoor, mustSignInAgain, setActiveDoor } from "./door-switch";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe("switching between CorvusPT and CorvusDP", () => {
  it("a browser signed in before this existed adopts the door it opens (nobody thrown out)", () => {
    expect(mustSignInAgain("corvuspt")).toBe(false);
    expect(getActiveDoor()).toBe("corvuspt");
  });
  it("opening the other door asks to sign in again", () => {
    setActiveDoor("corvuspt");
    expect(mustSignInAgain("corvusdp")).toBe(true);
    expect(mustSignInAgain("corvuspt")).toBe(false);
  });
  it("after signing in for the other door, that door is the active one", () => {
    setActiveDoor("corvusdp");
    expect(mustSignInAgain("corvusdp")).toBe(false);
    expect(mustSignInAgain("corvuspt")).toBe(true);
  });
});
