// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListLoadMoreFooter } from "./list-load-more-footer";

vi.mock("../../i18n", () => ({
  useT: () => ({
    t: (select: (value: any) => string) => select({
      table: {
        load_failed: "Could not load",
        load_failed_retry: "Retry initial load",
        load_more_failed_retry: "Load more failed — Retry",
        loading_branch: "Loading",
        no_more: "No more",
      },
    }),
  }),
}));

afterEach(cleanup);

describe("TaskFlow initial vs continuation load errors", () => {
  it("labels an empty first-page failure as an initial load error and retries", () => {
    const onRetry = vi.fn();
    render(
      <ListLoadMoreFooter
        hasMore={false}
        isLoading={false}
        total={0}
        isError
        isInitialError
        errorStatus={503}
        errorRequestId="ab12CD34"
        onRetry={onRetry}
        onLoadMore={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-error-kind", "initial");
    expect(alert).toHaveAttribute("data-http-status", "503");
    expect(alert).toHaveAttribute("data-request-id", "ab12CD34");
    expect(alert).toHaveTextContent("Could not load");
    fireEvent.click(screen.getByRole("button", { name: "Retry initial load" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("preserves continuation wording and does not leak an unsafe request id", () => {
    render(
      <ListLoadMoreFooter
        hasMore
        isLoading={false}
        total={100}
        isError
        isTailError
        errorRequestId="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature"
        onRetry={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-error-kind", "tail");
    expect(alert).not.toHaveAttribute("data-request-id");
    expect(alert).toHaveTextContent("Load more failed — Retry");
    expect(alert).not.toHaveTextContent("Could not load");
  });
});
