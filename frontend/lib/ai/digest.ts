// Local digest: same shape as GET /api/digest, computed from on-device rows.
// Used when offline or when no backend account exists.
export interface Digest {
  totalMessages: number;
  userMessages: number;
  activeDays: number;
  topics: { topic: string; count: number }[];
  activeHours: { hour: number; count: number }[];
  routineNotes: string[];
  perDay: { day: string; count: number }[];
}

const STOP = new Set(
  ('the,a,an,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,is,are,was,were,' +
    'be,been,being,have,has,had,do,does,did,will,would,can,could,should,may,might,' +
    'i,you,he,she,it,we,they,me,him,her,us,them,my,your,his,its,our,their,this,that,' +
    'these,those,what,when,where,which,who,whom,how,why,not,no,yes,so,as,just,like,' +
    'hai,mein,me,ne,ko,se,ka,ki,ke,aur,toh,kya,kaise,ho,raha,rahi,hain,tha,' +
    'please,tell,give,know,want,need,help,pls,ok,okay,thanks,thank,hello,hi,hey').split(',')
);

export function digestMessages(
  msgs: { role: string; content: string; createdAt: number }[]
): Digest {
  const freq = new Map<string, number>();
  const hours = new Array(24).fill(0);
  const perDay = new Map<string, number>();
  const days = new Set<string>();
  let userCount = 0;
  let timeAsks = 0;
  const timeHours: number[] = [];

  for (const m of msgs || []) {
    const d = new Date(m.createdAt);
    hours[d.getHours()]++;
    days.add(d.toDateString());
    perDay.set(d.toDateString(), (perDay.get(d.toDateString()) || 0) + 1);
    if (m.role !== 'user') continue;
    userCount++;
    const text = String(m.content || '');
    if (/time|samay|baje|clock/i.test(text)) {
      timeAsks++;
      timeHours.push(d.getHours());
    }
    for (const w of text.toLowerCase().split(/[^\p{L}\p{M}]+/u)) {
      if (w.length > 3 && !STOP.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
    }
  }

  const topics = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([topic, count]) => ({ topic, count }));
  const activeHours = hours
    .map((count, hour) => ({ hour, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  const notes: string[] = [];
  if (timeAsks >= 3) {
    const avg = Math.round(timeHours.reduce((a, b) => a + b, 0) / timeHours.length);
    notes.push(`Asks the time often (around ${avg}:00).`);
  }
  if (activeHours[0]?.count > 0) notes.push(`Most active around ${activeHours[0].hour}:00.`);
  if (userCount > 0 && days.size > 0) notes.push(`${userCount} questions over ${days.size} day(s).`);

  return {
    totalMessages: (msgs || []).length,
    userMessages: userCount,
    activeDays: days.size,
    topics,
    activeHours,
    routineNotes: notes,
    perDay: [...perDay.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => +new Date(a.day) - +new Date(b.day))
      .slice(-14),
  };
}
