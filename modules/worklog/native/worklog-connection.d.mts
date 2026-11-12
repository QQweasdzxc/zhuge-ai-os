export class WorklogConnection {
 constructor(config:{supabaseUrl:string;anonKey:string;userId:string;storage:Storage;location:{origin:string;href:string;assign:(url:string)=>void;replaceHistory?:(path:string)=>void};enabled?:boolean;calendarEnabled?:boolean;crypto?:Crypto;fetchImpl?:typeof fetch;now?:()=>number;locks?:Pick<LockManager,'request'>});
 start(returnPath:string,options?:{calendar?:boolean}):Promise<void>;
 finish():Promise<string>;
 getSession():Promise<{access_token:string;refresh_token:string;expires_at:number;user:{id:string}}>;
 disconnect():void;
}
