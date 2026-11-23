export const WORKLOG_TITLE_LIMIT=49;
export function worklogTitle(value=''){return Array.from(String(value)).slice(0,WORKLOG_TITLE_LIMIT).join('')}
