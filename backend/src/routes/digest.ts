import { Router } from 'express';
import { all } from '../db';
import { authenticate } from '../middleware/auth';

// Heuristic digest: no AI key needed. Topics from word frequency, active
// hours from timestamps, routine notes from repeated patterns.
const STOP = new Set(
  ('the,a,an,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,is,are,was,were,' +
    'be,been,being,have,has,had,do,does,did,will,would,can,could,should,may,might,' +
    'i,you,he,she,it,we,they,me,him,her,us,them,my,your,his,its,our,their,this,that,' +
    'these,those,what,when,where,which,who,whom,how,why,not,no,yes,so,as,just,like,' +
    'hai,mein,me,ne,ko,se,ka,ki,ke,aur,hai,toh,kya,kaise,kya,ho,raha,rahi,hain,tha,' +
    'the,please,tell,give,know,want,need,help,pls,ok,okay,thanks,thank,hello,hi,hey')
    .split(',')
);

const router = Router();
router.use(authenticate);

router.get('/', (req, res) => {
  const userId = (req as any).user.id as string;
  const msgs = all<any>('SELECT role, content, created_at FROM messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 5000', userId);

  const freq = new Map<string, number>();
  const hours = new Array(24).fill(0);
  const days = new Set<string>();
  let userCount = 0;
  let timeAsks = 0;
  const timeHours: number[] = [];

  for (const m of msgs) {
    const d = new Date(m.created_at);
    hours[d.getHours()]++;
    days.add(d.toDateString());
    if (m.role !== 'user') continue;
    userCount++;
    const text = String(m.content || '');
    if (/time|samay|baje|clock/i.test(text)) {
      timeAsks++;
      timeHours.push(d.getHours());
    }
    for (const w of text.toLowerCase().split(/[^a-z\u0900-\u097f]+/)) {
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

  res.json({
    totalMessages: msgs.length,
    userMessages: userCount,
    activeDays: days.size,
    topics,
    activeHours,
    routineNotes: notes,
  });
});

export default router;
