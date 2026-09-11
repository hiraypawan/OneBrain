import { NextRequest,NextResponse } from 'next/server';
export const dynamic='force-dynamic';
const cache=new Map<string,{until:number;value:any}>();let inflight=0;
export async function GET(request:NextRequest){
 const params=request.nextUrl.searchParams,kind=params.get('kind');let url:string,key:string;
 if(kind==='weather'){
  const lat=Number(params.get('lat')),lon=Number(params.get('lon'));
  if(params.get('lat')===null||params.get('lon')===null||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return NextResponse.json({error:'Supply valid latitude and longitude.'},{status:400});
  key=`weather:${lat.toFixed(2)}:${lon.toFixed(2)}`;url=`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`;
 }else if(kind==='currency'){
  const from=params.get('from')||'EUR',to=params.get('to')||'INR';if(!/^[A-Z]{3}$/.test(from)||!/^[A-Z]{3}$/.test(to)||from===to)return NextResponse.json({error:'Choose two different ISO currency codes.'},{status:400});
  key=`fx:${from}:${to}`;url=`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`;
 }else return NextResponse.json({error:'Choose weather or currency.'},{status:400});
 const saved=cache.get(key);if(saved&&saved.until>Date.now())return NextResponse.json({...saved.value,cached:true});
 if(inflight>=8)return NextResponse.json({error:'Source lookup queue is busy. Try again later.'},{status:429});
 inflight++;
 try{
  const response=await fetch(url,{headers:{'User-Agent':'OneBrain/1.0 (https://github.com/hiraypawan/OneBrain)'},signal:AbortSignal.timeout(10000),redirect:'manual',cache:'no-store'});
  if(!response.ok){await response.body?.cancel();throw new Error('Source unavailable');}const raw=await response.json();
  let value:any;
  if(kind==='currency'){
   const rate=raw.rates?.[params.get('to')||'INR'];if(!Number.isFinite(rate)||rate<=0)throw new Error('Rate unavailable');
   value={kind,from:params.get('from')||'EUR',to:params.get('to')||'INR',rate,rateDate:raw.date,source:'Frankfurter / institutional reference rates',sourceUrl:'https://frankfurter.dev',fetchedAt:new Date().toISOString(),notice:'Dated reference rate, not a live executable or bank rate.'};
  }else{
   const forecast=raw.properties?.timeseries?.[0],details=forecast?.data?.instant?.details;if(!forecast||!details)throw new Error('Forecast unavailable');
   value={kind,forecastAt:forecast.time,updatedAt:raw.properties.meta.updated_at,details,units:raw.properties.meta.units,source:'MET Norway',sourceUrl:'https://www.met.no/en/free-meteorological-data',license:'CC BY 4.0',fetchedAt:new Date().toISOString(),notice:'Forecast, not an observed weather reading. Coordinates are rounded and sent only on this explicit lookup.'};
  }
  if(cache.size>=128)cache.delete(cache.keys().next().value!);cache.set(key,{value,until:Date.now()+10*60000});return NextResponse.json(value);
 }catch{return NextResponse.json({error:'The source could not be checked. No weather or exchange rate has been invented.'},{status:502});}finally{inflight--;}
}
