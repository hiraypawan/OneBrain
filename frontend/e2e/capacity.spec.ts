import {test,expect} from '@playwright/test';
import {seedServerSession,seedActionHistory} from './server-fixture';
test.beforeEach(async({page})=>{await page.route('https://js.puter.com/**',r=>r.abort());});
test('guest capture does not issue a platform identity request',async({page})=>{
 const requests:string[]=[];page.on('request',r=>{if(r.url().includes('/api/platform'))requests.push(r.url());});
 await page.goto('/');await page.getByRole('button',{name:'Try a note',exact:true}).click();await page.getByRole('button',{name:'Review capture',exact:true}).click();await expect(page.getByRole('dialog',{name:'Review your capture'})).toBeVisible();
 expect(requests).toEqual([]);
});
test('Connected work opens with only bootstrap and records; other datasets are lazy',async({page})=>{
 await seedServerSession(page);
 const made=await page.request.post('/api/platform/spaces',{data:{name:'Lazy loading fixture'}});expect(made.status()).toBe(201);
 const requests:string[]=[];page.on('request',r=>{if(r.url().includes('/api/platform/'))requests.push(new URL(r.url()).pathname);});
 await page.goto('/control?panel=shared');await expect(page.getByRole('heading',{name:'Lazy loading fixture',exact:true})).toBeVisible();await expect(page.getByText('Loading this section…')).toHaveCount(0);
 expect(requests.length).toBe(2);expect(requests[0]).toBe('/api/platform/bootstrap');expect(requests[1]).toMatch(/\/records$/);
 await page.getByRole('button',{name:'Actions & schedules',exact:true}).click();await expect(page.getByText('Loading this section…')).toHaveCount(0);
 expect(requests.at(-1)).toMatch(/\/jobs$/);expect(requests.some(p=>p.endsWith('/members')||p.endsWith('/connections')||p.endsWith('/inbox'))).toBe(false);
});
test('paged records remain reachable and an older relationship can be selected without rendering the full catalog',async({page})=>{
 await seedServerSession(page);await page.setViewportSize({width:390,height:844});
 const made=await page.request.post('/api/platform/spaces',{data:{name:'Pagination fixture'}}), {id}=await made.json();
 for(let batch=0;batch<2;batch++){
  const imported=await page.request.post(`/api/platform/spaces/${id}/import`,{data:{importId:`page-${batch}`,records:Array.from({length:60},(_,i)=>({id:`r-${batch}-${i}`,kind:'note',title:`Catalog ${batch}-${String(i).padStart(2,'0')}`,data:{}}))}});expect(imported.status()).toBe(201);
 }
 await page.goto('/control?panel=shared');await expect(page.locator('.ops-record')).toHaveCount(100);await expect(page.getByText(/Search and totals below cover loaded records only/)).toBeVisible();
 await page.getByRole('button',{name:'Load more records'}).click();await expect(page.locator('.ops-record')).toHaveCount(120);await expect(page.getByRole('button',{name:'Load more records'})).toHaveCount(0);
 await page.getByRole('button',{name:'New record',exact:true}).click();const dialog=page.getByRole('dialog',{name:'New shared record'});await expect(dialog).toBeVisible();
 await dialog.getByLabel('Find records to link').fill('Catalog 0-00');await dialog.getByRole('checkbox',{name:'Catalog 0-00',exact:true}).first().check();
 await dialog.getByLabel('Find records to link').fill('Catalog 1-59');await expect(dialog.getByRole('checkbox',{name:'Catalog 0-00',exact:true}).first()).toBeChecked();
 await dialog.getByLabel('Title',{exact:true}).fill('Old catalog relationship');await dialog.getByRole('button',{name:'Save shared record',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('navigation does not speculatively fetch unopened control pages',async({page})=>{
 const speculative:string[]=[];
 page.on('request',r=>{if(new URL(r.url()).searchParams.has('_rsc'))speculative.push(r.url());});
 await page.goto('/control');const entries=page.locator('.control-entry');await expect(entries.first()).toBeVisible();
 await entries.last().scrollIntoViewIfNeeded();await entries.first().hover();await page.waitForLoadState('networkidle');
 expect(speculative).toEqual([]);
 await entries.filter({hasText:'Connected work'}).click();await expect(page.getByRole('heading',{name:'Connected work',exact:true})).toBeVisible();
});
test('action pages and older receipts load only on demand',async({page})=>{
 const {userId}=await seedServerSession(page);
 const response=await page.request.post('/api/platform/spaces',{data:{name:'History fixture'}});expect(response.status()).toBe(201);const {id}=await response.json();seedActionHistory(id,userId);
 const historyRequests:string[]=[];page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/receipts'))historyRequests.push(r.url());});
 await page.goto('/control?panel=shared');await page.getByRole('button',{name:'Actions & schedules',exact:true}).click();
 await expect(page.locator('.ops-job')).toHaveCount(25);await expect(page.locator('.ops-receipt')).toHaveCount(1);expect(historyRequests).toEqual([]);
 await page.getByRole('button',{name:'Load older actions',exact:true}).click();await expect(page.locator('.ops-job')).toHaveCount(26);await expect(page.getByRole('button',{name:'Load older actions',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Load older receipts for History job 25',exact:true}).click();await expect(page.locator('.ops-receipt')).toHaveCount(3);expect(historyRequests).toHaveLength(1);
});
test('temporary bootstrap failure offers retry rather than a new Google login',async({page})=>{
 await seedServerSession(page);
 await page.route('**/api/platform/bootstrap',r=>r.fulfill({status:503,json:{error:'Temporary capacity error'}}),{times:1});
 await page.goto('/control?panel=shared');await expect(page.getByRole('heading',{name:'Shared connection unavailable'})).toBeVisible();await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Retry shared connection'}).click();await expect(page.getByLabel('New workspace',{exact:true})).toBeVisible();
});
