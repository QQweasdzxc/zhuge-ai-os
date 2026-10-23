// Isolated Browser QA fixture. API responses are intercepted by Playwright.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiClient, setApiInstance } from "@multica/core/api";
import { WorkspaceSlugProvider } from "@multica/core/paths";
import { NavigationProvider } from "../navigation";
import { TaskFlowDispatchCenter, TaskFlowNativeAITasks } from "../common/taskflow-dispatch-center";
import "../../../apps/web/app/globals.css";

const api = new ApiClient(window.location.origin);
api.setToken("isolated-browser-fixture-token");
setApiInstance(api);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const tasksRoute = new URLSearchParams(window.location.search).get("view") === "ai-tasks";
function App() {
  const [slug, setSlug] = useState("alpha");
  const [pathname, setPathname] = useState(tasksRoute ? "/alpha/ai-tasks" : "/alpha/ai-dispatch");
  return <QueryClientProvider client={client}><WorkspaceSlugProvider slug={slug}><NavigationProvider value={{ pathname, searchParams: new URLSearchParams(), hash: "", push: setPathname, replace: setPathname, back() {}, getShareableUrl: path => window.location.origin + path }}>
    <div className="p-2 text-xs">隔離原生元件測試 · API Fixture <button onClick={() => { setSlug("beta"); setPathname(tasksRoute ? "/beta/ai-tasks" : "/beta/ai-dispatch"); }}>切換 Beta</button><output aria-label="原生導覽路徑">{pathname}</output></div>
    {tasksRoute ? <TaskFlowNativeAITasks key={slug} /> : <TaskFlowDispatchCenter key={slug} />}
  </NavigationProvider></WorkspaceSlugProvider></QueryClientProvider>;
}
createRoot(document.getElementById("root")!).render(<App />);
