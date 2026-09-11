import Link from 'next/link';
export default function PasswordHelp(){return <section className="py-10"><h1>OneBrain uses Google sign-in</h1><p>There is no OneBrain account password to reset. Recover access through your Google account. Your encrypted vault password is separate and cannot be recovered.</p><Link href="/auth/login">Continue with Google</Link></section>;}
