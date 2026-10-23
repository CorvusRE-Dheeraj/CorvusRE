import { describe, expect, it } from "vitest";
import { readableAddress, tidyAddress } from "./tidy-address";

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

describe("readableAddress", () => {
  it("title-cases county ALL CAPS and splits street / city", () => {
    expect(readableAddress("2931 PARKER RD, ST PAUL, TX 75098")).toEqual({
      street: "2931 Parker Rd",
      place: "St Paul, TX 75098",
    });
    expect(readableAddress("10955 CUSTER RD, FRISCO, TX 75035")).toEqual({
      street: "10955 Custer Rd",
      place: "Frisco, TX 75035",
    });
  });
  it("keeps directions, road prefixes and ordinals right", () => {
    expect(readableAddress("409 W 17TH ST, HOUSTON").street).toBe("409 W 17th St");
    expect(readableAddress("1200 FM 423 , , TX 75034")).toEqual({
      street: "1200 FM 423",
      place: "TX 75034",
    });
  });
  it("leaves mixed-case addresses alone", () => {
    expect(readableAddress("7205 Golden Ln, Silsbee, TX 77656")).toEqual({
      street: "7205 Golden Ln",
      place: "Silsbee, TX 77656",
    });
  });
});
