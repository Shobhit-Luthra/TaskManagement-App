import { describe, expect, it } from "vitest";
import { parseMentions, tokenizeMentions } from "./mentions";

const ID_A = "11111111-1111-1111-1111-111111111111";
const ID_B = "22222222-2222-2222-2222-222222222222";

describe("parseMentions", () => {
  it("extracts mentions in first-seen order without duplicates", () => {
    expect(parseMentions(`@[Ada](${ID_A}) @[Bo](${ID_B}) @[Ada](${ID_A})`)).toEqual([ID_A, ID_B]);
  });

  it("does not mistake regular markdown links or malformed text for mentions", () => {
    expect(parseMentions(`See [docs](https://example.com/${ID_A}) and @nope`)).toEqual([]);
  });

  it("splits body content into safe text and dedicated mention tokens", () => {
    expect(tokenizeMentions(`Hi @[Ada](${ID_A})!`)).toEqual([
      { type: "text", value: "Hi " },
      { type: "mention", userId: ID_A, label: "Ada" },
      { type: "text", value: "!" },
    ]);
  });
});
