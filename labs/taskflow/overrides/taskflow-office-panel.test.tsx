import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OFFICE_PANEL_KEY, OFFICE_URL, TaskFlowOfficePanel } from "./taskflow-office-panel";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const toggle = () => fireEvent.click(screen.getByRole("button", { name: "辦公室" }));
const frame = () => document.querySelector("iframe");

describe("TaskFlow office panel", () => {
  it("starts closed, loads the correct iframe on open, and removes it on close", () => {
    render(<TaskFlowOfficePanel />);
    expect(frame()).toBeNull();
    toggle();
    expect(frame()?.getAttribute("src")).toBe(OFFICE_URL);
    expect(localStorage.getItem(OFFICE_PANEL_KEY)).toBe("true");
    toggle();
    expect(frame()).toBeNull();
    expect(localStorage.getItem(OFFICE_PANEL_KEY)).toBe("false");
  });

  it("restores both open and closed state after remount", () => {
    const first = render(<TaskFlowOfficePanel />);
    toggle();
    first.unmount();
    const second = render(<TaskFlowOfficePanel />);
    expect(frame()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "關閉辦公室" }));
    expect(frame()).toBeNull();
    expect(localStorage.getItem(OFFICE_PANEL_KEY)).toBe("false");
    second.unmount();
    render(<TaskFlowOfficePanel />);
    expect(frame()).toBeNull();
  });

  it("retains the active iframe across resizing and parent rerenders", () => {
    const view = render(<TaskFlowOfficePanel />);
    toggle();
    const active = frame();
    fireEvent.click(screen.getByRole("button", { name: "放大辦公室" }));
    expect(screen.getByRole("region").style.width).toBe("720px");
    expect(frame()).toBe(active);
    fireEvent.click(screen.getByRole("button", { name: "放大辦公室" }));
    expect(screen.getByRole("region").style.width).toBe("480px");
    view.rerender(<TaskFlowOfficePanel />);
    expect(frame()).toBe(active);
  });

  it("does not block TaskFlow controls outside the overlay", () => {
    const navigate = vi.fn();
    render(<><button onClick={navigate}>看板</button><TaskFlowOfficePanel /></>);
    toggle();
    fireEvent.click(screen.getByRole("button", { name: "看板" }));
    expect(navigate).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "辦公室" }).parentElement?.className)
      .toContain("pointer-events-none");
  });

  it("survives unavailable storage and treats invalid saved values as closed", () => {
    localStorage.setItem(OFFICE_PANEL_KEY, "invalid");
    const view = render(<TaskFlowOfficePanel />);
    expect(frame()).toBeNull();
    view.unmount();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<TaskFlowOfficePanel />);
    toggle();
    expect(frame()).not.toBeNull();
    toggle();
    expect(frame()).toBeNull();
  });
});
