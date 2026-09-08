import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";

export function render(ui: ReactElement, options?: RenderOptions) {
  return rtlRender(ui, options);
}

export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
