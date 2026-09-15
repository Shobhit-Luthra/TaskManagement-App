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

  it("escapes html in inviterDisplayName and acceptUrl", () => {
    const result = invitationEmail({
      projectName: "My Project",
      inviterDisplayName: '<script>alert("xss")</script>',
      role: "member",
      acceptUrl: 'https://kanbo.example/invite?token="bad"',
    });
    expect(result.html).not.toContain("<script");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).not.toContain('token="bad"');
    expect(result.html).toContain("token=&quot;bad&quot;");
  });
});
