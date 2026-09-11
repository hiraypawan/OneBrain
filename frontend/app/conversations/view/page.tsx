import {redirect} from 'next/navigation';
export default async function Page({searchParams}:{searchParams:Promise<{id?:string}>}){const p=await searchParams;redirect('/control?panel=conversation&id='+encodeURIComponent(typeof p.id==='string'?p.id:''));}
