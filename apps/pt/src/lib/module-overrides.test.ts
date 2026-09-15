import { describe, it, expect } from "vitest";
import {
  isModuleNotApplicable,
  isItemNotApplicable,
  itemsNotApplicable,
  WHOLE_MODULE_KEY,
  type ModuleOverride,
} from "./module-overrides";

describe("isModuleNotApplicable", () => {
  it("is true only for a whole-module override on that module", () => {
    const overrides: ModuleOverride[] = [{ moduleId: "income", itemKey: WHOLE_MODULE_KEY }];
    expect(isModuleNotApplicable(overrides, "income")).toBe(true);
    expect(isModuleNotApplicable(overrides, "site")).toBe(false);
  });

  it("is false for a per-item override, even on the same module", () => {
    const overrides: ModuleOverride[] = [{ moduleId: "site", itemKey: "Easements" }];
    expect(isModuleNotApplicable(overrides, "site")).toBe(false);
  });

  it("is false with no overrides at all", () => {
    expect(isModuleNotApplicable([], "income")).toBe(false);
  });
});

describe("isItemNotApplicable", () => {
  it("matches an exact module/item pair", () => {
    const overrides: ModuleOverride[] = [
      { moduleId: "site", itemKey: "Easements" },
      { moduleId: "improvement", itemKey: "Roof" },
    ];
    expect(isItemNotApplicable(overrides, "site", "Easements")).toBe(true);
    expect(isItemNotApplicable(overrides, "site", "Drainage")).toBe(false);
    expect(isItemNotApplicable(overrides, "improvement", "Easements")).toBe(false);
  });
});

describe("itemsNotApplicable", () => {
  it("returns only per-item keys for the given module, never the whole-module entry", () => {
    const overrides: ModuleOverride[] = [
      { moduleId: "income", itemKey: WHOLE_MODULE_KEY },
      { moduleId: "site", itemKey: "Easements" },
      { moduleId: "site", itemKey: "Drainage" },
      { moduleId: "improvement", itemKey: "Roof" },
    ];
    expect(itemsNotApplicable(overrides, "site")).toEqual(["Easements", "Drainage"]);
    expect(itemsNotApplicable(overrides, "improvement")).toEqual(["Roof"]);
    expect(itemsNotApplicable(overrides, "income")).toEqual([]);
  });

  it("returns an empty array when nothing is marked", () => {
    expect(itemsNotApplicable([], "site")).toEqual([]);
  });
});
