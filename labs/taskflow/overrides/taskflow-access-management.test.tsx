import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {TaskFlowAccessManagement} from './taskflow-access-management';
vi.mock('./settings-layout',()=>({SettingsTab:({children}:{children:React.ReactNode})=><div>{children}</div>}));
vi.mock('@multica/core/auth',()=>({useAuthStore:(fn:any)=>fn({user:{id:'owner'}})}));
vi.mock('@multica/core/paths',()=>({useCurrentWorkspace:()=> ({slug:'test'})}));
vi.mock('../../common/taskflow-worklog/worklog-connection.mjs',()=>({WorklogConnection:class{}}));
describe('Native global access cards',()=>{
 it('reads without writes and only sends a confirmed owner decision',async()=>{
 const row={applicant_user_id:'member',display_name:'合成會員',enabled:false,effective_allowed:false};const service={list:vi.fn(async()=>[row]),setEnabled:vi.fn(async()=>[{...row,enabled:true,effective_allowed:true}])};
 render(<TaskFlowAccessManagement testService={service}/>);const toggle=await screen.findByRole('switch',{name:'合成會員 全站使用'});expect(service.setEnabled).not.toHaveBeenCalled();expect(document.querySelector('iframe')).toBeNull();vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);fireEvent.click(toggle);expect(service.setEnabled).not.toHaveBeenCalled();fireEvent.click(toggle);await waitFor(()=>expect(toggle).toHaveAttribute('aria-checked','true'));expect(service.setEnabled).toHaveBeenCalledTimes(1);expect(service.setEnabled).toHaveBeenCalledWith(row,true,expect.any(String));
 });
});
