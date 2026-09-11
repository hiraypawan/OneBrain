import {test,expect} from '@playwright/test';
import {seedServerSession} from './server-fixture';
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
