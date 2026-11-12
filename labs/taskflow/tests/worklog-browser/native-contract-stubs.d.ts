declare module '@multica/core/auth' {export function useAuthStore<T>(selector:(state:{user:{id:string}|null;status:'authenticated'|'unauthenticated'|'recovering'|'loading'})=>T):T;}
declare module '@multica/core/paths' {export function useWorkspaceSlug():string|null;}
declare const process:{env:Record<string,string|undefined>};

declare module '@multica/core/hooks' {export function useWorkspaceId():string;}
declare module '@multica/core/api' {export const api:{listIssues:(params:any)=>Promise<any>};}
