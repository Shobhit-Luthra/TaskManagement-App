import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommentBody } from "./markdown";

describe("CommentBody", () => {
  it.each([
    "before <script>alert(1)</script> after",
    '<iframe src="https://evil.example"></iframe>',
    "[click](javascript:alert(1))",
    '<img src="x" onerror="alert(1)">',
    '<svg onload="alert(1)"><script>alert(2)</script></svg>',
    "[click](data:text/html,<script>alert(1)</script>)",
  ])("renders unsafe content inert: %s", (body) => {
    const { container } = render(
      <CommentBody body={body} allowedMentionIds={new Set()} resolveDisplayName={() => null} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.innerHTML).not.toMatch(/on\w+\s*=/i);
    for (const link of [...container.querySelectorAll("a")]) {
      expect((link.getAttribute("href") ?? "").toLowerCase()).not.toMatch(/^(javascript|data):/);
    }
  });

  it("renders permitted formatting and a resolved mention chip", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const { container, getByText } = render(
      <CommentBody
        body={`**bold** @[old](${id})`}
        allowedMentionIds={new Set([id])}
        resolveDisplayName={() => "Ada"}
      />,
    );
    expect(container.querySelector("strong")).not.toBeNull();
    expect(getByText("@Ada").getAttribute("data-mention-user-id")).toBe(id);
  });

  it("demotes a departed member mention to plain text", () => {
    const id = "22222222-2222-2222-2222-222222222222";
    const { getByText, queryByRole } = render(
      <CommentBody
        body={`@[Gone](${id})`}
        allowedMentionIds={new Set()}
        resolveDisplayName={() => "Gone"}
      />,
    );
    expect(getByText("@Gone")).toBeTruthy();
    expect(queryByRole("link")).toBeNull();
  });
});
