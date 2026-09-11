import {redirect} from 'next/navigation';
export default async function Page({searchParams}:{searchParams:Promise<{error?:string}>}){const p=await searchParams;redirect('/control?panel=account'+(p.error?'&error=google':''));}
