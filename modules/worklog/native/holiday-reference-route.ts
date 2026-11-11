import {NextResponse} from 'next/server';
import {parseSuspensions,suspensionSource} from '@multica/views/common/taskflow-worklog/holiday-reference';
export const runtime='nodejs';
export async function GET(){
 try{const response=await fetch(suspensionSource,{next:{revalidate:3600},signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('upstream');const html=await response.text();const result=parseSuspensions(html);return NextResponse.json(result,{headers:{'Cache-Control':'public, max-age=300'}})}
 catch{return NextResponse.json({source:suspensionSource,unavailable:true,message:'目前無法確認最新停班資料，請以官方公告為準。'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
