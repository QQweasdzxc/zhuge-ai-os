import type {TaskflowIssueRef} from './date-hours.mjs';
export type WorklogEntry={dateOnly?:boolean;taskflowIssueRef?:TaskflowIssueRef;id:string;cloudId?:string;date:string;at:string;hours:number;title:string;note:string;ecpTask:string;entryType:string;status:string;source:string;updatedAt?:string|null;taskUuid?:string;taskTitleSnapshot?:string;suggestionName?:string;suggestionAdjusted?:boolean};
export type WorklogSnapshot={userId:string;year:number;range:[string,string];entries:WorklogEntry[];profile:{workHours:string;lunch:string;role:string;ecpOwner:string;ecpDepartment:string;[key:string]:unknown}|null;workProfile:Record<string,unknown>|null;models:Record<string,unknown>[];ecpTasks:string[];loadedAt:string};
export class WorklogError extends Error{code:string;saved?:WorklogEntry[]}
export function dateKey(date?:Date):string;
export function calendarBounds(year:number):[string,string];
export function monthBounds(year:number,month:number):[string,string];
export class WorklogService{
 constructor(config:{request:(path:string,options?:RequestInit)=>Promise<unknown>;userId:string;priorityEngine?:unknown;resourceFetch?:typeof fetch});
 snapshot:WorklogSnapshot|null;busy:boolean;learningWarnings:string[];
 load(year:number,range?:[string,string]):Promise<WorklogSnapshot>;
 loadCalendarStatistics(range:[string,string]):Promise<Array<{date:string;minutes:number;count:number}>>;
 loadStatistics(year:number,options?:{force?:boolean}):Promise<unknown>;
 suggestions(date:string):Array<{id:string;title:string;defaultDurationMinutes:number;at:string;ecpTask:string;sourceLabel:string;reason:string;confidence:number}>;
 rules(date?:string,extra?:Record<string,unknown>):{resolveWorklogTime:(options:Record<string,unknown>)=>{at:string;dateKey:string;reason:string};[key:string]:any};
 resolveSuggestedTime(date:string,hours:number,reserved?:Partial<WorklogEntry>[]):string|null;
 saveBatch(items:WorklogEntry[],date:string,options?:{onPersisted?:()=>void}):Promise<WorklogEntry[]>;
 recordMetric(item:{title:string;date:string;hours?:number;at?:string;suggestionName?:string},event:'suggested'|'added'|'edited'|'deleted'):Promise<void>;
 addEcpTask(value:string):Promise<string>;
 remove(entry:WorklogEntry,options?:{deleteLinkedGoogle?:boolean}):Promise<unknown>;
 exportMonth(month:string):Promise<{count:number;filename:string;dateOnlyCount?:number}>;
}
export function supabaseRequest(config:{baseUrl:string;anonKey:string;expectedUserId:string;getSession:()=>Promise<{access_token:string;user:{id:string}}>;fetchImpl?:typeof fetch}):(path:string,options?:RequestInit)=>Promise<unknown>;
