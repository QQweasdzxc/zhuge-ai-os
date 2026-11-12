import type {WorklogEntry} from './worklog-service.mjs';
export type TaskflowIssueRef={id:string;workspaceId:string;title:string;href:string;kind:string};
export function validDay(value:unknown):boolean;
export function taskflowRef(value:unknown):TaskflowIssueRef|null;
export function dateHoursFromCloud(row:any):WorklogEntry|null;
export function dateHoursEcp(entry:WorklogEntry,profile:{owner:string;department:string}):Record<string,unknown>;
export function dateHoursEvent(entry:WorklogEntry,identity:{userId:string;eventId:string}):any;
export function planDateHoursImport(options:any):any;
