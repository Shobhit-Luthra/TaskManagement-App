import { describe, expect, it } from "vitest";
import { invitationEmail } from "./invitation";

describe("invitationEmail", () => {
  it("renders subject, text and html with the accept link", () => {
    const result = invitationEmail({
      projectName: "Launch Plan",
      inviterDisplayName: "Ada",
      role: "member",
      acceptUrl: "https://kanbo.example/invite/abc123",
    });
    expect(result.subject).toBe("Ada invited you to Launch Plan on Kanbo");
    expect(result.text).toContain("https://kanbo.example/invite/abc123");
    expect(result.text).toContain("member");
    expect(result.html).toContain("https://kanbo.example/invite/abc123");
    expect(result.html).not.toContain("<script");
  });
});
