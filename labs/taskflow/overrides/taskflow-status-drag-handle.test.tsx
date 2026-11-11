// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskFlowStatusDragHandle } from "./taskflow-status-drag-handle";
const state=vi.hoisted(()=>({save:vi.fn().mockResolvedValue(undefined)}));
vi.mock("@multica/core/hooks",()=>({useWorkspaceId:()=>"w"}));
vi.mock("@multica/core/issue-statuses/hooks",()=>({useIssueStatuses:()=>({activeStatuses:[{key:"backlog"},{key:"todo"},{key:"review"}]})}));
vi.mock("@multica/core/issue-statuses/taskflow-project-status-scope",()=>({useTaskFlowProjectStatusSettings:()=>({isLoading:false,projectId:"a",setStatusOrder:state.save})}));
vi.mock("../utils/status-label",()=>({useStatusLabel:()=>(key:string)=>key}));
vi.mock("../../i18n",()=>({useT:()=>({t:(_:unknown,p?:{name:string})=>p?.name??"failed"})}));
describe("Project header pointer sorting",()=>{
 beforeEach(()=>{state.save.mockClear();if(!window.PointerEvent)window.PointerEvent=MouseEvent as typeof PointerEvent;});
 it("saves a deliberate pointer drop on another status header",()=>{
 render(<><div data-taskflow-status-header="backlog"><TaskFlowStatusDragHandle status="backlog"/></div><div data-taskflow-status-header="review" data-testid="target"/></>);
 document.elementFromPoint=vi.fn(()=>screen.getByTestId("target"));
 const handle=screen.getByRole("button",{name:"backlog"});
 fireEvent.pointerDown(handle,{button:0,clientX:10,clientY:10,pointerId:1});
 fireEvent.pointerUp(handle,{clientX:250,clientY:10,pointerId:1});
 expect(state.save).toHaveBeenCalledWith(["todo","review","backlog"]);
 });
 it("does not save on click, cancelled drag, or drop outside a header",()=>{
 render(<TaskFlowStatusDragHandle status="todo"/>);
 document.elementFromPoint=vi.fn(()=>null);
 const handle=screen.getByRole("button",{name:"todo"});
 fireEvent.pointerDown(handle,{button:0,clientX:10,clientY:10,pointerId:1});fireEvent.pointerUp(handle,{clientX:10,clientY:10,pointerId:1});
 fireEvent.pointerDown(handle,{button:0,clientX:10,clientY:10,pointerId:1});fireEvent.pointerCancel(handle);fireEvent.pointerUp(handle,{clientX:250,clientY:10,pointerId:1});
 expect(state.save).not.toHaveBeenCalled();
 });
});
