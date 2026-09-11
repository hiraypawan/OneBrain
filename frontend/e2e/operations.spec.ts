import {test,expect,type Page} from '@playwright/test';
import {seedServerSession} from './server-fixture';
async function signUp(page:Page){
 await seedServerSession(page);await page.goto('/operations');
 await page.getByLabel('New workspace',{exact:true}).fill('Browser test studio');await page.getByRole('button',{name:'Create workspace',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Browser test studio',exact:true})).toBeVisible();
}
test.beforeEach(async({page})=>{await page.route('https://js.puter.com/**',r=>r.abort());});
test('authenticated fixture, shared record persistence, financial edit and HTTP-only session',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await signUp(page);
 const cookies=await context.cookies('http://127.0.0.1:3000/api/platform/me');expect(cookies.find(c=>c.name==='onebrain-platform-session')?.httpOnly).toBe(true);
 expect(await page.evaluate(()=>document.cookie)).not.toContain('onebrain-platform-session');
 await page.getByRole('button',{name:'New record',exact:true}).click();const modal=page.getByRole('dialog',{name:'New shared record'});
 await modal.getByRole('combobox',{name:'Record type',exact:true}).selectOption('expense');await modal.getByLabel('Title',{exact:true}).fill('Travel to client');
 await modal.getByText('Budget, milestones, aliases & financial fields',{exact:true}).click();await modal.getByLabel('Additional record fields').fill(JSON.stringify({amount:120,currency:'INR',category:'travel'}));
 await modal.getByRole('button',{name:'Save shared record',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText(/INR · expenses 120.00/)).toBeVisible();
 await page.reload();await page.locator('.ops-record').filter({hasText:'Travel to client'}).click();const detail=page.getByRole('dialog',{name:'Shared record context'});
 await detail.getByText('Budget, milestones, aliases & financial fields',{exact:true}).click();await detail.getByLabel('Additional record fields').fill(JSON.stringify({amount:150,currency:'INR',category:'travel'}));await detail.getByRole('button',{name:'Save shared record',exact:true}).click();
 await expect(page.getByText(/INR · expenses 150.00/)).toBeVisible();expect(errors).toEqual([]);
});
test('draft approval queues, executes and exposes a durable in-app receipt',async({page})=>{
 await signUp(page);await page.getByRole('button',{name:'Actions & schedules',exact:true}).click();await page.getByRole('button',{name:'Draft action',exact:true}).click();
 const draft=page.getByRole('dialog',{name:'Draft an action'});await draft.getByLabel('Routine name',{exact:true}).fill('Browser follow-up');
 await draft.getByRole('textbox',{name:'Exact action fields · reviewed before execution',exact:true}).fill(JSON.stringify({title:'Check client proposal',body:'Prepare context before calling.'}));
 await draft.getByRole('button',{name:'Save action draft',exact:true}).click();await expect(page.locator('.ops-job')).toContainText('draft');
 await page.getByRole('button',{name:'Run due jobs',exact:true}).click();await expect(page.locator('.ops-job')).toContainText('draft');
 await page.getByRole('button',{name:'Review & approve',exact:true}).click();const approval=page.getByRole('dialog',{name:'Approve this exact action'});
 await expect(approval.getByRole('button',{name:'Approve & queue'})).toBeDisabled();await expect(approval).toContainText('Check client proposal');await approval.getByRole('checkbox').check();await approval.getByRole('button',{name:'Approve & queue'}).click();
 await page.getByRole('button',{name:'Run due jobs',exact:true}).click();await expect(page.locator('.ops-receipt')).toContainText('verified');
 await page.reload();await page.getByRole('button',{name:/^Inbox/}).click();await expect(page.getByRole('heading',{name:'Check client proposal',exact:true})).toBeVisible();
});
test('imports require explicit upload approval and preserve linked record context',async({page})=>{
 await signUp(page);const file={version:1,items:[{id:'a',kind:'person',title:'Client Ada',body:'Contact reference',status:'active',links:[]},{id:'b',kind:'task',title:'Send Ada proposal',body:'A reviewed follow-up',status:'active',links:['a']}]};
 await page.getByLabel(/Review a workspace JSON import/).setInputFiles({name:'reviewed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
 const dialog=page.getByRole('dialog',{name:'Review server import'});await expect(dialog).toContainText('visible to its members');expect(await page.locator('.ops-record').count()).toBe(0);
 await dialog.getByRole('button',{name:'Approve upload & import'}).click();await expect(page.locator('.ops-record')).toHaveCount(2);
 await page.locator('.ops-record').filter({hasText:'Send Ada proposal'}).click();await expect(page.getByRole('dialog').getByRole('checkbox',{name:'Client Ada',exact:true}).first()).toBeChecked();
});
test('responsive Operations and source lookup error states do not invent results',async({page})=>{
 await page.setViewportSize({width:390,height:844});await signUp(page);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/utilities');await page.getByLabel('Expression',{exact:true}).fill('15% of 60000');await page.getByRole('button',{name:'Calculate locally',exact:true}).click();await expect(page.getByRole('status')).toContainText('9000');
 await page.route('**/api/utilities?**',r=>r.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'The source could not be checked. No rate was invented.'})}));
 await page.getByRole('button',{name:'Look up with source',exact:true}).click();await expect(page.getByText('The source could not be checked. No rate was invented.')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('vault encrypts, locks, restores from disk, and does not load the third-party AI SDK',async({page})=>{
 const external:string[]=[];page.on('request',r=>{if(r.url().startsWith('https://js.puter.com'))external.push(r.url());});await page.goto('/vault');
 await page.getByLabel('Master password',{exact:true}).fill('test-only-vault-password-123');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();
 await page.getByLabel('Entry title',{exact:true}).fill('Private test entry');await page.getByLabel('Private value',{exact:true}).fill('test-secret-not-for-server');await page.getByRole('button',{name:'Encrypt & save entry',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Private test entry',exact:true})).toBeVisible();await page.getByRole('button',{name:'Lock vault',exact:true}).first().click();await expect(page.getByText('test-secret-not-for-server',{exact:true})).toHaveCount(0);
 await page.reload();await page.getByLabel('Master password',{exact:true}).fill('wrong-test-password-123');await page.getByRole('button',{name:'Unlock vault',exact:true}).click();await expect(page.getByRole('status')).toContainText('Incorrect password');
 await page.getByLabel('Master password',{exact:true}).fill('test-only-vault-password-123');await page.getByRole('button',{name:'Unlock vault',exact:true}).click();await page.getByText('Reveal private value',{exact:true}).click();await expect(page.getByText('test-secret-not-for-server',{exact:true})).toBeVisible();expect(external).toEqual([]);
});
test('explicit shared voice review uploads only after save shared and persists on the server',async({page})=>{
 await signUp(page);await page.getByRole('button',{name:'Use for explicit shared voice drafts'}).click();await page.goto('/');
 await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('checkbox',{name:/^Silent Mode/}).check();await page.getByRole('button',{name:'Close dialog'}).click();
 await page.getByLabel('Capture type').selectOption('ask');await page.getByLabel('Capture a thought',{exact:true}).fill('shared task: Call shared client');await page.getByRole('button',{name:'Ask OneBrain',exact:true}).click();
 const review=page.getByRole('region',{name:'Review shared upload'});await expect(review).toContainText('Browser test studio');
 const before=await page.request.get('/api/platform/spaces');const space=(await before.json()).spaces[0].id;const records=await page.request.get(`/api/platform/spaces/${space}/records`);expect((await records.json()).records).toHaveLength(0);
 await review.getByRole('button',{name:'Save shared',exact:true}).click();await expect(review).toHaveCount(0);await expect(page.locator('.last-response')).toContainText('Saved one shared task');
 await page.goto('/operations');await expect(page.locator('.ops-record')).toContainText('Call shared client');
});
test('voice-created server reminders remain drafts until separately reviewed in Operations',async({page})=>{
 await signUp(page);await page.getByRole('button',{name:'Use for explicit shared voice drafts'}).click();await page.goto('/');
 await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('checkbox',{name:/^Silent Mode/}).check();await page.getByRole('button',{name:'Close dialog'}).click();
 await page.getByLabel('Capture type').selectOption('ask');await page.getByLabel('Capture a thought',{exact:true}).fill('server reminder: Review the shared proposal');await page.getByRole('button',{name:'Ask OneBrain',exact:true}).click();
 await page.getByRole('region',{name:'Review shared upload'}).getByRole('button',{name:'Save shared',exact:true}).click();await expect(page.locator('.last-response')).toContainText('not scheduled for execution');
 await page.goto('/operations');await page.getByRole('button',{name:'Actions & schedules',exact:true}).click();await expect(page.locator('.ops-job')).toContainText('draft');await expect(page.locator('.ops-job')).toContainText('Review the shared proposal');
});

test('only Google sign-in is offered and retired password routes cannot authenticate',async({page})=>{
 await page.goto('/auth/signup');await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeVisible();await expect(page.locator('input[type=password]')).toHaveCount(0);
 const response=await page.request.post('/api/platform/login',{data:{email:'old@example.test',password:'old-password'}});expect(response.status()).toBe(410);
 await page.goto('/api/auth/google/callback?state=forged&code=forged');await expect(page).toHaveURL(/auth\/login\?error=google/);await expect(page.getByRole('alert').filter({hasText:'Google sign-in was not completed'})).toBeVisible();
 const hidden=await page.request.post('/api/platform/auth/google/start',{data:{}});expect(hidden.status()).toBe(404);
 const csrf=await page.request.post('/api/auth/google/start',{headers:{origin:'https://attacker.example'},data:{}});expect(csrf.status()).toBe(403);
});
