import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MentionAutocomplete } from "./mention-autocomplete";

const peers = [
  { userId: "u-a", displayName: "Ada Lovelace" },
  { userId: "u-b", displayName: "Bo Chen" },
];

describe("MentionAutocomplete", () => {
  it("offers matching peers and inserts the canonical stored mention", async () => {
    const onChange = vi.fn();
    render(
      <MentionAutocomplete
        peers={peers}
        textareaId="composer"
        value="hello @ad"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("option", { name: "Ada Lovelace" }));
    expect(onChange).toHaveBeenCalledWith("hello @[Ada Lovelace](u-a) ");
  });

  it("does not open suggestions without an @ trigger", () => {
    render(
      <MentionAutocomplete peers={peers} textareaId="composer" value="hello" onChange={vi.fn()} />,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
