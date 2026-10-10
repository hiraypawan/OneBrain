'use client';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useAssistantStore } from '@/store/assistant';

export function ProviderScript() {
  const path = usePathname();
  const puterEnabled = useAssistantStore((s) => s.settings.puterEnabled === true);
  const excluded = path === '/control' || path === '/vault' || path === '/operations' || path === '/you' || path === '/track' || path.startsWith('/auth/') || path.startsWith('/settings');

  // Do not contact/load Puter just because the app was opened. The settings
  // and image panels load it for an explicit user action; other assistant
  // surfaces get the SDK only after chat opt-in is saved.
  if (excluded || !puterEnabled) return null;
  return <Script src="https://js.puter.com/v2/" strategy="afterInteractive" />;
}
