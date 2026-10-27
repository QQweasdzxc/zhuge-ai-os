import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useActiveIssueView } from "@multica/core/issue-views/use-active-view";
import { useActiveIssueViewStore } from "@multica/core/issue-views/active-view-store";
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@multica/core/api", () => ({ api: { listIssueViews: mocks.list } }));
const human={id:"human-view",scope_variant:"agents",query:{},display:{}};
const ai={id:"ai-view",scope_variant:"agents",query:{taskflow_surface:"ai-agents"},display:{}};
const unrelated={id:"other-ai",scope_variant:"members",query:{taskflow_surface:"ai-members"},display:{}};
describe("AI saved-view isolation", () => {
 beforeEach(() => {useActiveIssueViewStore.setState({active:{}});mocks.list.mockResolvedValue([human,ai,unrelated]);});
 function wrapper({children}:{children:React.ReactNode}) {return <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{children}</QueryClientProvider>;}
 it("keeps native Agent-tab views on native page and AI-tagged views on AI page",async()=>{
  const native=renderHook(()=>useActiveIssueView("ws",{scope_type:"workspace"}),{wrapper});
  const agents=renderHook(()=>useActiveIssueView("ws",{scope_type:"workspace"},"agents"),{wrapper});
  await waitFor(()=>expect(agents.result.current.viewsReady).toBe(true));
  expect(native.result.current.views.map(x=>x.id)).toEqual(["human-view"]);
  expect(agents.result.current.views.map(x=>x.id)).toEqual(["ai-view"]);
  act(()=>agents.result.current.setActive("ai-view"));
  expect(agents.result.current.activeView?.id).toBe("ai-view");
  expect(native.result.current.activeViewId).toBeNull();
  act(()=>native.result.current.setActive("human-view"));
  expect(native.result.current.activeView?.id).toBe("human-view");
  expect(agents.result.current.activeView?.id).toBe("ai-view");
 });
 it("rejects a native view ID placed in the AI namespace",async()=>{
  const agents=renderHook(()=>useActiveIssueView("ws",{scope_type:"workspace"},"agents"),{wrapper});
  await waitFor(()=>expect(agents.result.current.viewsReady).toBe(true));
  act(()=>agents.result.current.setActive("human-view"));
  expect(agents.result.current.activeView).toBeNull();expect(agents.result.current.missing).toBe(true);
 });
});
