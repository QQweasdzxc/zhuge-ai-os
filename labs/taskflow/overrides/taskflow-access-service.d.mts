export type AccessRow={applicant_user_id:string;display_name?:string;email?:string;enabled:boolean;effective_allowed:boolean;is_creator?:boolean;status?:string;latest_event_no?:number};
export type AccessService={list:()=>Promise<AccessRow[]>;setEnabled:(row:AccessRow,enabled:boolean,key:string)=>Promise<AccessRow[]>};
export function createAccessService(options:{userId:string;getSession:()=>Promise<any>;baseUrl:string;anonKey:string;fetchImpl?:typeof fetch}):AccessService;
