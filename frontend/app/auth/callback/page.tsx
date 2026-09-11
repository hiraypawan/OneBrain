import {redirect} from 'next/navigation';
// Retired token-in-query landing route. Never import a token from a URL.
export default function LegacyCallback(){redirect('/auth/login');}
