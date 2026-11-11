#!/usr/bin/env python3
"""Mount TQ6 worklog in a copied native tree. Does not change frozen vendor."""
import argparse,json,shutil
from pathlib import Path

def apply(root:Path,source:Path,resources:Path):
    if root.resolve().name=='multica' and root.resolve().parent.name=='third_party':
        raise ValueError('refusing frozen vendor; use copied tree')
    sidebar=root/'packages/views/layout/app-sidebar.tsx'
    text=sidebar.read_text()
    marker='TASKFLOW_WORKLOG_ENTRY_V1'
    if marker not in text:
        anchor='                {/* TASKFLOW_OFFICE_ENTRY_V1:'
        start=text.find(anchor)
        if start<0:raise SystemExit('Office entry must be installed before worklog')
        end=text.index('                </SidebarMenuItem>',start)+len('                </SidebarMenuItem>')
        item='''
                {/* TASKFLOW_WORKLOG_ENTRY_V1: immediately below office */}
                {workspace && <SidebarMenuItem key="worklog">
                  <SidebarMenuButton
                    isActive={pathname === `/${workspace.slug}/worklog`}
                    render={<AppLink href={`/${workspace.slug}/worklog`} />}
                    className={NAV_ITEM_CLASS_NAME}
                  >
                    <Clock3 />
                    <span>工時與月報</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>}'''
        if '  Clock3,' not in text:text=text.replace('import { Layers,','import { Layers,\n  Clock3,',1)
        # Import may shift offsets, find the office tail again after the import.
        start=text.index(anchor);end=text.index('                </SidebarMenuItem>',start)+len('                </SidebarMenuItem>')
        text=text[:end]+item+text[end:]
        sidebar.write_text(text)
    common=root/'packages/views/common/taskflow-worklog'
    common.mkdir(parents=True,exist_ok=True)
    for name in ('legacy-rules.mjs','priority-engine.mjs','holiday-reference.mjs','holiday-reference.d.mts','worklog-service.mjs','worklog-service.d.mts','worklog-connection.mjs','worklog-connection.d.mts','taskflow-worklog.tsx','taskflow-worklog-page.tsx','worklog.css'):
        shutil.copy2(source/name,common/name)
    package=root/'packages/views/package.json';data=json.loads(package.read_text())
    data['exports']['./common/taskflow-worklog']='./common/taskflow-worklog/taskflow-worklog-page.tsx'
    data['exports']['./common/taskflow-worklog/holiday-reference']='./common/taskflow-worklog/holiday-reference.mjs'
    package.write_text(json.dumps(data,indent=2)+'\n')
    route=root/'apps/web/app/[workspaceSlug]/(dashboard)/worklog';route.mkdir(parents=True,exist_ok=True)
    (route/'page.tsx').write_text('import {TaskFlowWorklogPage} from "@multica/views/common/taskflow-worklog";\nexport default TaskFlowWorklogPage;\n')
    callback=root/'apps/web/app/auth/worklog';callback.mkdir(parents=True,exist_ok=True)
    (callback/'page.tsx').write_text('import {TaskFlowWorklogConnect} from "@multica/views/common/taskflow-worklog";\nexport default TaskFlowWorklogConnect;\n')
    api=root/'apps/web/app/api/worklog/suspensions';api.mkdir(parents=True,exist_ok=True)
    shutil.copy2(source/'holiday-reference-route.ts',api/'route.ts')
    assets=root/'apps/web/public/worklog-assets'
    shutil.copytree(resources,assets,dirs_exist_ok=True)
    shutil.copytree(source/'holiday-data',assets/'holidays',dirs_exist_ok=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--source',type=Path,required=True);p.add_argument('--resources',type=Path,required=True);a=p.parse_args();apply(a.root,a.source,a.resources)
    print('apply-taskflow-worklog: OK (connection disabled unless explicitly configured)')
