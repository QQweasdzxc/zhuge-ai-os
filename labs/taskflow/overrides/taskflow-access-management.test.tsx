import React from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTaskFlowAccessManagement } from "./taskflow-access-management";

function Harness({ userId = "u1" }: { userId?: string }) {
  const access = useTaskFlowAccessManagement(userId, true);
  return <>{access.visible && <a>全站存取管理入口</a>}{access.frame}</>;
}
function status(value: string, origin = "https://qqweasdzxc.github.io", validSource = true) {
  const frame = screen.getByTitle("全站存取管理") as HTMLIFrameElement;
  act(() => window.dispatchEvent(new MessageEvent("message", {
    origin, source: validSource ? frame.contentWindow : window,
    data: { type: "trqn-access-status", status: value },
  })));
}
describe("Pages creator status controls the TF entry", () => {
  it("hides unknown and non-creator; displays creator and login; ignores forged messages", () => {
    render(<Harness />);
    expect(screen.queryByText("全站存取管理入口")).toBeNull();
    status("creator", "https://evil.example");
    status("creator", undefined, false);
    expect(screen.queryByText("全站存取管理入口")).toBeNull();
    status("creator");
    expect(screen.getByText("全站存取管理入口")).toBeInTheDocument();
    status("denied");
    expect(screen.queryByText("全站存取管理入口")).toBeNull();
    status("login");
    expect(screen.getByText("全站存取管理入口")).toBeInTheDocument();
  });
  it("clears the previous user's status when TF identity changes", () => {
    const { rerender } = render(<Harness />);
    status("creator");
    rerender(<Harness userId="u2" />);
    expect(screen.queryByText("全站存取管理入口")).toBeNull();
  });
});
