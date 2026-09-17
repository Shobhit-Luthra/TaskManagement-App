import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useBoardShortcuts } from "./use-board-shortcuts";

function Harness({
  handlers,
}: {
  handlers: {
    onFocusSearch: () => void;
    onToggleFilters: () => void;
    onNewTask: () => void;
    onShowHelp: () => void;
  };
}) {
  useBoardShortcuts(handlers);
  return (
    <>
      <button type="button">Target</button>
      <input aria-label="Typing target" />
    </>
  );
}

describe("useBoardShortcuts", () => {
  it("maps board keys while focus is not in a typing target", async () => {
    const handlers = {
      onFocusSearch: vi.fn(),
      onToggleFilters: vi.fn(),
      onNewTask: vi.fn(),
      onShowHelp: vi.fn(),
    };
    render(<Harness handlers={handlers} />);
    await userEvent.click(document.querySelector("button")!);
    await userEvent.keyboard("/fN?");
    expect(handlers.onFocusSearch).toHaveBeenCalledOnce();
    expect(handlers.onToggleFilters).toHaveBeenCalledOnce();
    expect(handlers.onNewTask).toHaveBeenCalledOnce();
    expect(handlers.onShowHelp).toHaveBeenCalledOnce();
  });
  it("does not fire when typing or holding a modifier", async () => {
    const handlers = {
      onFocusSearch: vi.fn(),
      onToggleFilters: vi.fn(),
      onNewTask: vi.fn(),
      onShowHelp: vi.fn(),
    };
    render(<Harness handlers={handlers} />);
    await userEvent.click(document.querySelector("input")!);
    await userEvent.keyboard("/");
    await userEvent.keyboard("{Control>}/{/Control}");
    expect(handlers.onFocusSearch).not.toHaveBeenCalled();
  });
});
