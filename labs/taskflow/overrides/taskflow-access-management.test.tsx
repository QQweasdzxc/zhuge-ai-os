import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskFlowAccessManagement } from "./taskflow-access-management";
vi.mock("./settings-layout", () => ({ SettingsTab: ({children}: {children: React.ReactNode}) => <div>{children}</div> }));
describe("TF access management launch button", () => {
  it("opens the fixed Pages URL securely without loading a frame or RPC", () => {
    render(<TaskFlowAccessManagement />);
    const link = screen.getByRole("link", { name: "開啟全站存取管理" });
    expect(link).toHaveAttribute("href", "https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/access-management/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/需全站管理者登入/)).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
