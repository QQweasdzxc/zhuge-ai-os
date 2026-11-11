export const suspensionSource:string;
export type SuspensionReference={source:string;sourceUpdatedAt:string;checkedAt:string;stale:boolean;noNotices:boolean;rows:{area:string;notice:string}[];scope:string};
export function parseSuspensions(html:string,options?:{now?:number}):SuspensionReference;
