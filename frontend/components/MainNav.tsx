'use client';
import {usePathname} from 'next/navigation';
import {AppHeader} from './AppHeader';
export function MainNav(){const path=usePathname();if(path==='/'||path==='/active')return null;return <AppHeader active="space"/>;}
