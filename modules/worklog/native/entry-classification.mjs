// Classify NEW entries only. Stored event types are never re-inferred from a title.
// Explicit owner choices outrank text. Uncertain leave intent blocks a new write.
const leaves=['家庭照顧假','育嬰假','生理假','陪產假','產檢假','特休','病假','事假','公假','婚假','喪假','補休','產假','年假','休假','請假'];
const words=leaves.join('|');
export function classifyNewEntry(value=''){
 const text=String(value).normalize('NFKC').trim();
 if(/^工作\s*[:：]/.test(text))return {type:'work',reason:'explicit'};
 if(/^休假\s*[:：]/.test(text))return {type:'leave',reason:'explicit'};
 if(!leaves.some(x=>text.includes(x)))return {type:'work',reason:'no-leave-intent'};
 if(new RegExp(`(?:不|沒有|無需|取消|未)(?:要|需|再)?(?:${words})`).test(text))return {type:'work',reason:'negated'};
 const administrative=/(處理|協助|幫忙|審核|核准|統計|登記|核對|討論|同仁|同事|員工|主管|假單|申請單|報表|系統|規則|制度|辦法|公告|教育訓練)/.test(text);
 const personal=new RegExp(`(?:我|本人)(?:今天|明天|昨天|要|已|申請|請|休)*(?:${words})`).test(text);
 if(administrative)return personal?{type:'uncertain',reason:'mixed-intent'}:{type:'work',reason:'work-context'};
 const core=text.replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g,'').replace(/\d{1,2}月\d{1,2}日/g,'').replace(/\d{1,2}:\d{2}/g,'').replace(/(?:\d+(?:\.\d+)?|半|[一二兩三四五六七八九十]+)\s*(?:小時|天|日|h)/gi,'').replace(/今天|明天|昨天|本日|上午|下午|早上|晚上|全天|整天|半天|週[一二三四五六日天]|星期[一二三四五六日天]/g,'').replace(/[\s，,。.!！~～\-–—至到]/g,'');
 if(new RegExp(`^(?:我|本人)?(?:要|將|已|是|申請|安排|請|休)?(?:${words})$`).test(core))return {type:'leave',reason:'clear-personal-leave'};
 return {type:'uncertain',reason:'unclear-personal-intent'};
}
