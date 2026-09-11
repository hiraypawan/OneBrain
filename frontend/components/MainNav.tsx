'use client';
import Link from 'next/link';
import {AccountLink} from './AccountLink';
import { usePathname } from 'next/navigation';
export function MainNav() {
  const path = usePathname();
  if (path === '/' || path === '/active') return null;
  return <nav className="secondary-nav" aria-label="Navigation"><Link href="/">∷ onebrain.</Link><Link href="/">Workspace</Link><Link href="/reminders">Reminders</Link><a href="/settings/account">Settings</a><AccountLink/></nav>;
}
