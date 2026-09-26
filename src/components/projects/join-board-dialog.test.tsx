import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JoinBoardDialog } from "./join-board-dialog";

const fetchMock = vi.fn();

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("JoinBoardDialog", () => {
  it("keeps only digits and enables submit at six", async () => {
    render(<JoinBoardDialog open onOpenChange={vi.fn()} />);
    const input = screen.getByLabelText(/code/i);
    const submit = screen.getByRole("button", { name: /request to join/i });
    await userEvent.type(input, "12a34");
    expect(input).toHaveValue("1234");
    expect(submit).toBeDisabled();
    await userEvent.type(input, "5678");
    expect(input).toHaveValue("123456");
    expect(submit).toBeEnabled();
  });

  it("accepts a pasted code with separators", async () => {
    render(<JoinBoardDialog open onOpenChange={vi.fn()} />);
    const input = screen.getByLabelText(/code/i);
    await userEvent.click(input);
    await userEvent.paste("123 456");
    expect(input).toHaveValue("123456");
  });

  it("confirms the request with the board name", async () => {
    const onRequested = vi.fn();
    respond(202, { data: { requestId: "r1", projectName: "Apollo", status: "pending" } });
    render(<JoinBoardDialog open onOpenChange={vi.fn()} onRequested={onRequested} />);
    await userEvent.type(screen.getByLabelText(/code/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /request to join/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("Request sent to Apollo");
    expect(onRequested).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/join",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "123456" }) }),
    );
  });

  it.each([
    [404, "That code isn't valid or has expired."],
    [429, "Too many attempts. Try again later."],
    [409, "You're already a member of this board."],
  ])("shows the right message for %i", async (status, message) => {
    respond(status, { error: { code: "X", message: "You're already a member of this board." } });
    render(<JoinBoardDialog open onOpenChange={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/code/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /request to join/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });
});
