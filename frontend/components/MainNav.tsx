'use client';
import {usePathname} from 'next/navigation';
import {AppHeader} from './AppHeader';
// Today renders its own header (it also owns the pocket/voice screens); every
// other surface gets the same five-tab shell from the root layout.
export function MainNav(){const path=usePathname();if(path==='/'||path==='/active')return null;return <AppHeader/>;}
