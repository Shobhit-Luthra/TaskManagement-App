import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/p/p1/board",
  useSearchParams: () => new URLSearchParams(),
}));

import { ProjectNav } from "./project-nav";

describe("ProjectNav", () => {
  it.each(["owner", "admin"])("shows Analytics and Settings to %s", (role) => {
    render(<ProjectNav projectId="p1" role={role} />);
    expect(screen.getByRole("link", { name: /analytics/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument();
  });

  it.each(["member", "viewer"])("hides Analytics and Settings from %s", (role) => {
    render(<ProjectNav projectId="p1" role={role} />);
    expect(screen.queryByRole("link", { name: /analytics/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /settings/i })).not.toBeInTheDocument();
  });
});
