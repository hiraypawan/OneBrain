'use client';
import Script from 'next/script';
import {usePathname} from 'next/navigation';
export function ProviderScript(){const path=usePathname();return (path==='/control'||path==='/vault'||path==='/operations'||path.startsWith('/auth/')||path.startsWith('/settings'))?null:<Script src="https://js.puter.com/v2/" strategy="lazyOnload"/>;}
