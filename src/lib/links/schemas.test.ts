import { describe, expect, it } from "vitest";
import { createTaskLinkSchema, linkHostname } from "./schemas";

describe("createTaskLinkSchema", () => {
  it("accepts http and https links and trims the title", () => {
    expect(
      createTaskLinkSchema.parse({ url: " https://example.com/a ", title: "  Spec " }),
    ).toEqual({ url: "https://example.com/a", title: "Spec" });
    expect(createTaskLinkSchema.parse({ url: "HTTP://example.com" }).url).toBe(
      "HTTP://example.com",
    );
  });

  it("rejects other schemes, bare hosts and whitespace", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://example.com",
      "example.com/doc",
      "https://example.com/a b",
    ]) {
      expect(createTaskLinkSchema.safeParse({ url }).success, url).toBe(false);
    }
  });

  it("limits URL and title length", () => {
    expect(
      createTaskLinkSchema.safeParse({ url: `https://example.com/${"a".repeat(2048)}` }).success,
    ).toBe(false);
    expect(
      createTaskLinkSchema.safeParse({ url: "https://example.com", title: "t".repeat(201) })
        .success,
    ).toBe(false);
  });
});

describe("linkHostname", () => {
  it("returns the hostname, or the raw value if it cannot be parsed", () => {
    expect(linkHostname("https://docs.example.com/a?b=1")).toBe("docs.example.com");
    expect(linkHostname("not a url")).toBe("not a url");
  });
});
