import { describe, expect, it } from "vitest";
import { tidyAddress } from "./tidy-address";

describe("tidyAddress", () => {
  it("removes empty city gaps", () => {
    expect(tidyAddress("1515 S LOOP 288 , , TX, 76208")).toBe("1515 S LOOP 288, TX, 76208");
  });
  it("leaves a normal address alone", () => {
    expect(tidyAddress("900 WILLOWWOOD ST, DENTON, TX, 76205")).toBe(
      "900 WILLOWWOOD ST, DENTON, TX, 76205",
    );
  });
});
