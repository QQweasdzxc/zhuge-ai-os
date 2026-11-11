export type WorklogEntry={id:string;cloudId?:string;date:string;at:string;hours:number;title:string;note:string;ecpTask:string;entryType:string;status:string;source:string;updatedAt?:string|null;taskUuid?:string;taskTitleSnapshot?:string};
export type WorklogSnapshot={userId:string;year:number;entries:WorklogEntry[];profile:{workHours:string;lunch:string;role:string;ecpOwner:string;ecpDepartment:string;[key:string]:unknown}|null;workProfile:Record<string,unknown>|null;models:Record<string,unknown>[];ecpTasks:string[];loadedAt:string};
export class WorklogError extends Error{code:string;saved?:WorklogEntry[]}
export function dateKey(date?:Date):string;
export function calendarBounds(year:number):[string,string];
export class WorklogService{
 constructor(config:{request:(path:string,options?:RequestInit)=>Promise<unknown>;userId:string;priorityEngine?:unknown;resourceFetch?:typeof fetch});
 snapshot:WorklogSnapshot|null;busy:boolean;learningWarnings:string[];
 load(year:number):Promise<WorklogSnapshot>;
 suggestions(date:string):Array<{id:string;title:string;defaultDurationMinutes:number;at:string;ecpTask:string;sourceLabel:string;reason:string}>;
 rules(date?:string,extra?:Record<string,unknown>):{resolveWorklogTime:(options:Record<string,unknown>)=>{at:string;dateKey:string;reason:string};[key:string]:any};
 resolveSuggestedTime(date:string,hours:number,reserved?:Partial<WorklogEntry>[]):string|null;
 saveBatch(items:WorklogEntry[],date:string):Promise<WorklogEntry[]>;
 remove(entry:WorklogEntry):Promise<unknown>;
 exportMonth(month:string):Promise<{count:number;filename:string}>;
}
export function supabaseRequest(config:{baseUrl:string;anonKey:string;expectedUserId:string;getSession:()=>Promise<{access_token:string;user:{id:string}}>;fetchImpl?:typeof fetch}):(path:string,options?:RequestInit)=>Promise<unknown>;
