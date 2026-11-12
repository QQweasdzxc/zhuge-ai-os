export type DueTask={id:string;title:string;date:string;kind:'start'|'due'|'both';identifier:string;completed:boolean;status:string};
export function taskDateMarkers(rows:any[],options:{workspaceId:string;from:string;to:string}):DueTask[];
export function loadTaskDueDates(listIssues:(params:any)=>Promise<any>,options:{workspaceId:string;from:string;to:string}):Promise<DueTask[]>;
