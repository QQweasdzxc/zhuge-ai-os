import json,re,hashlib,pathlib
from bs4 import BeautifulSoup
ROOT=pathlib.Path(__file__).parent
x=json.load(open(ROOT/'evidence/calendar/twse-calendar-2026-live.json'))
closed=[r[0] for r in x['data'] if not re.search('開始交易日|最後交易日',r[1])]
opened=[r[0] for r in x['data'] if re.search('開始交易日|最後交易日',r[1])]
t=json.load(open(ROOT/'evidence/calendar/tpex-calendar-2026-live.json'))
soup=BeautifulSoup(t['data']['html'],'html.parser');grid=[];span={}
for tr in soup.select('table')[-1].select('tr')[1:]:
 row=[];col=0
 for c in tr.select('td,th'):
  while col in span:
   value,remaining=span[col];row.append(value)
   if remaining==1:del span[col]
   else:span[col]=(value,remaining-1)
   col+=1
  val=c.get_text('',strip=True);row.append(val)
  if int(c.get('rowspan',1))>1:span[col]=(val,int(c['rowspan'])-1)
  col+=1
 while col in span:
  value,remaining=span[col];row.append(value)
  if remaining==1:del span[col]
  else:span[col]=(value,remaining-1)
  col+=1
 grid.append(row)
def dates(s):return [f'2026-{int(m):02}-{int(d):02}' for m,d in re.findall(r'(\d+)月(\d+)日',s)]
tc=[];to=[]
for row in grid:
 name,date,weekday,desc=row
 if '股票交易系統最後交易日' in name:to+=dates(date);tc+=dates(desc)
 elif '債券' in name:continue
 elif '開始交易日' in name:to+=dates(date)
 else:tc+=dates(date)
assert sorted(tc)==sorted(closed),(tc,closed)
assert sorted(to)==sorted(opened),(to,opened)
manifest={'year':2026,'scope':'TWSE and TPEx stock market only; not bond calendars','policy':'Exact official annual calendar content digest required; changed content and uncovered years fail closed. Weekend closure is used only inside this verified annual coverage. 18:00 Taipei is an application publication cutoff, not an exchange guarantee.','TWSE':{'sourceUrl':'https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json&date=20260101','digest':hashlib.sha256(json.dumps(x['data'],ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),'digestField':'data','closed':closed,'opened':opened},'TPEX':{'sourceUrl':'https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate','method':'POST','form':'date=2026&response=json','digest':hashlib.sha256(t['data']['html'].encode()).hexdigest(),'digestField':'data.html','closed':tc,'opened':to}}
(ROOT/'calendar-manifest-2026.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
(ROOT/'evidence/calendar/tpex-stock-calendar-normalized.json').write_text(json.dumps(grid,ensure_ascii=False,indent=2)+'\n')
print('verified each venue:',len(closed),'closed dates;',len(opened),'explicit opens')
