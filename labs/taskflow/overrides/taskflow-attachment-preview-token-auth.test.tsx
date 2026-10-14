import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Attachment } from "@multica/core/types";

vi.mock("@multica/core/api", () => ({
  api: {
    getAttachment: vi.fn(),
    getAttachmentBlob: vi.fn(),
    getBaseUrl: vi.fn(),
    getToken: vi.fn(),
  },
}));

import { api } from "@multica/core/api";
import { useResignedInlineMedia } from "./hooks/use-inline-media-url";

const ATTACHMENT_ID = "11111111-1111-4111-8111-111111111111";
const PICKED_URL = `/api/attachments/${ATTACHMENT_ID}/download`;

function metadata(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: ATTACHMENT_ID,
    workspace_id: "22222222-2222-4222-8222-222222222222",
    issue_id: null,
    comment_id: null,
    chat_session_id: null,
    chat_message_id: null,
    uploader_type: "member",
    uploader_id: "33333333-3333-4333-8333-333333333333",
    filename: "report.pdf",
    url: "https://storage.invalid/report.pdf",
    download_url: PICKED_URL,
    markdown_url: PICKED_URL,
    content_type: "application/pdf",
    size_bytes: 571 * 1024,
    created_at: "2026-10-13T00:00:00Z",
    ...overrides,
  };
}

function renderMedia(blobFallback = true, pickedUrl = PICKED_URL) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => useResignedInlineMedia(ATTACHMENT_ID, pickedUrl, blobFallback),
    { wrapper },
  );
}

const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");

beforeEach(() => {
  vi.mocked(api.getAttachment).mockReset();
  vi.mocked(api.getAttachmentBlob).mockReset();
  vi.mocked(api.getBaseUrl).mockReturnValue("");
  vi.mocked(api.getToken).mockReturnValue("isolated-session-token");
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalCreateObjectURL) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL);
  } else {
    Reflect.deleteProperty(URL, "createObjectURL");
  }
});

describe("TaskFlow token-only attachment preview", () => {
  it("re-signs a same-origin stable URL and uses only the load-intent URL", async () => {
    const loadUrl = "https://media.invalid/report.pdf?sig=load";
    const forcedDownloadUrl = "https://media.invalid/report.pdf?sig=download";
    vi.mocked(api.getAttachment).mockResolvedValue(
      metadata({ download_url: loadUrl, attachment_download_url: forcedDownloadUrl }),
    );

    const { result } = renderMedia(false);

    await waitFor(() => expect(result.current.url).toBe(loadUrl));
    expect(api.getAttachment).toHaveBeenCalledWith(ATTACHMENT_ID);
    expect(result.current.unavailable).toBe(false);
    expect(result.current.url).not.toBe(forcedDownloadUrl);
    expect(api.getAttachmentBlob).not.toHaveBeenCalled();
  });

  it("uses the authenticated bounded Blob path for proxy-mode media", async () => {
    vi.mocked(api.getAttachment).mockResolvedValue(
      metadata({ download_url: PICKED_URL }),
    );
    vi.mocked(api.getAttachmentBlob).mockResolvedValue(
      new Blob(["isolated pdf bytes"], { type: "application/pdf" }),
    );
    const createObjectURL = vi.fn(() => "blob:taskflow-preview");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });

    const { result } = renderMedia(true);

    await waitFor(() => expect(result.current.url).toBe("blob:taskflow-preview"));
    expect(api.getAttachmentBlob).toHaveBeenCalledWith(ATTACHMENT_ID);
    expect(result.current.unavailable).toBe(false);
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it("keeps cross-origin protected media on the authenticated re-sign path", async () => {
    const signedUrl = "https://media.invalid/image.png?sig=load";
    vi.mocked(api.getToken).mockReturnValue(null);
    vi.mocked(api.getAttachment).mockResolvedValue(
      metadata({ filename: "image.png", download_url: signedUrl }),
    );

    const { result } = renderMedia(false, `https://api.invalid${PICKED_URL}`);

    await waitFor(() => expect(result.current.url).toBe(signedUrl));
    expect(api.getAttachment).toHaveBeenCalledWith(ATTACHMENT_ID);
    expect(api.getAttachmentBlob).not.toHaveBeenCalled();
  });

  it("marks failed authenticated upgrades unavailable instead of blessing the raw URL", async () => {
    vi.mocked(api.getAttachment).mockRejectedValue(new Error("401"));

    const { result } = renderMedia(false);

    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.url).toBe(PICKED_URL);
    expect(api.getAttachment).toHaveBeenCalledWith(ATTACHMENT_ID);
    expect(api.getAttachmentBlob).not.toHaveBeenCalled();
  });

  it("leaves same-origin cookie mode on its original native URL", () => {
    vi.mocked(api.getToken).mockReturnValue(null);

    const { result } = renderMedia(false);

    expect(result.current).toEqual({ url: PICKED_URL, pending: false, unavailable: false });
    expect(api.getAttachment).not.toHaveBeenCalled();
  });
});
