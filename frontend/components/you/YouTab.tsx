'use client';
// The You tab: who you are to OneBrain, what it may keep, how it talks, and the
// numbers it tracks you against. Deliberately a summary with exits — the panels
// behind each row own the editing, so there is exactly one place that saves a
// preference and this page can never drift from it.

import Link from 'next/link';
import { useAssistantStore } from '@/store/assistant';
import { useFeaturesStore } from '@/store/features';
import { plainMoney } from '@/lib/track';
import { PLANS } from '@/lib/plans';

const planLabel = (id: string) => PLANS.find((p) => p.id === id)?.name || 'Free';

const LANGUAGE_LABEL: Record<string, string> = {
  hinglish: 'Hinglish',
  'hi-IN': 'Hindi',
  marathi: 'Marathi',
  'en-IN': 'English (India)',
  'en-US': 'English (US)',
  'es-ES': 'Spanish',
};

function Card({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="you-card">
      <h2>{title}</h2>
      {children}
      <Link prefetch={false} href={href}>
        {linkLabel} →
      </Link>
    </section>
  );
}

export function YouTab() {
  const settings = useAssistantStore((s) => s.settings);
  const user = useAssistantStore((s) => s.user);
  const authenticated = useAssistantStore((s) => s.isAuthenticated);
  const apiKey = useAssistantStore((s) => s.apiKey);
  const plan = useFeaturesStore((s) => s.plan);
  const planSource = useFeaturesStore((s) => s.planSource);
  const planVerified = useFeaturesStore((s) => s.planVerified);
  const goals = useFeaturesStore((s) => s.trackGoals);

  return (
    <div className="you-wrap">
      <header className="control-heading">
        <span className="overline">ACCOUNT · PLAN · PREFERENCES</span>
        <h1>You</h1>
        <p>
          Who OneBrain is answering, what it is allowed to remember, and which
          numbers it holds you to. Everything here is a preference, not a
          record — your saved things live in Your space.
        </p>
      </header>

      <div className="you-grid">
        <Card title="Account" href="/control?panel=account" linkLabel="Sessions and sign-out">
          {authenticated ? (
            <p>
              Signed in as <strong>{user?.email}</strong>. Google identity is
              verified against the server on each session.
            </p>
          ) : (
            <p>
              OneBrain works without an account: notes, tasks, logs and voice
              stay in this browser. Signing in adds shared work and an
              account-wide plan.
            </p>
          )}
          <Link prefetch={false} href="/auth/login">
            {authenticated ? 'Manage sign-in' : 'Sign in with Google'} →
          </Link>
        </Card>

        <Card title="Plan" href="/control?panel=plan" linkLabel="Usage and limits">
          <dl>
            <div>
              <dt>Plan</dt>
              <dd>{planLabel(plan)}</dd>
            </div>
            <div>
              <dt>Decided by</dt>
              <dd>
                {planSource === 'server'
                  ? 'your account'
                  : planSource === 'device-beta'
                    ? 'this browser (beta key)'
                    : 'nothing redeemed'}
              </dd>
            </div>
            <div>
              <dt>Verified</dt>
              <dd>{planVerified ? 'this session' : 'unverified'}</dd>
            </div>
          </dl>
          <p>No payment, invoice or renewal exists anywhere in OneBrain.</p>
        </Card>

        <Card title="How it talks" href="/control?panel=voice" linkLabel="Voice and conversation">
          <dl>
            <div>
              <dt>Language</dt>
              <dd>{LANGUAGE_LABEL[settings.language] || settings.language}</dd>
            </div>
            <div>
              <dt>Answers</dt>
              <dd>{settings.verbosity}</dd>
            </div>
            <div>
              <dt>Spoken replies</dt>
              <dd>{settings.silentMode ? 'off (Silent Mode)' : 'on'}</dd>
            </div>
            <div>
              <dt>Proactive questions</dt>
              <dd>{settings.proactive?.enabled ? 'allowed' : 'never'}</dd>
            </div>
            <div>
              <dt>Appearance</dt>
              <dd>
                {settings.theme === 'light' ? 'light (beta)' : 'dark'}{' '}
                <Link prefetch={false} href="/control?panel=advanced">
                  change
                </Link>
              </dd>
            </div>
          </dl>
          <Link prefetch={false} href="/voice">
            Open the full-screen Voice tab →
          </Link>
        </Card>

        <Card title="What it may keep" href="/control?panel=privacy" linkLabel="Memory and privacy">
          <dl>
            <div>
              <dt>Save memory</dt>
              <dd>{settings.memoryEnabled ? 'on this browser' : 'off (session only)'}</dd>
            </div>
            <div>
              <dt>Forget chats older than</dt>
              <dd>{settings.autoDeleteDays ? `${settings.autoDeleteDays} days` : 'never'}</dd>
            </div>
            <div>
              <dt>Only my voice</dt>
              <dd>{settings.ownerOnly ? 'enrolled voice only' : 'any voice'}</dd>
            </div>
          </dl>
          <p>
            Encrypted vault entries, shared server records and device-local
            notes are three separate boundaries — none of them syncs by
            accident.
          </p>
        </Card>

        <Card title="Your numbers" href="/track?lens=expenses&range=month" linkLabel="Open Track">
          <dl>
            <div>
              <dt>Daily kcal goal</dt>
              <dd>≈{goals.kcalGoal}</dd>
            </div>
            <div>
              <dt>Sleep goal</dt>
              <dd>{goals.sleepGoal}h</dd>
            </div>
            <div>
              <dt>Water goal</dt>
              <dd>{goals.waterGoal} glasses</dd>
            </div>
            <div>
              <dt>Monthly spend limit</dt>
              <dd>{goals.budget ? plainMoney(goals.budget, goals.budgetCurrency) : 'not set'}</dd>
            </div>
          </dl>
          <p>
            Goals are set inside Track, next to the bars they measure — food
            figures stay rough estimates and nothing here is medical advice.
          </p>
          <Link prefetch={false} href="/control?panel=fitness">
            Raw log and manual entry →
          </Link>
        </Card>

        <Card title="AI engine" href="/control?panel=advanced" linkLabel="Advanced settings">
          <p>
            {apiKey
              ? 'Your own Gemini key is saved in this browser, so answers do not depend on shared quota.'
              : 'No Gemini key is saved. OneBrain falls back to a keyless community model and then to offline answers — quality drops, nothing is invented.'}
          </p>
          <dl>
            <div>
              <dt>Key</dt>
              <dd>{apiKey ? 'saved locally' : 'not set'}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Your data" href="/control?panel=data-export" linkLabel="Export or delete">
          <p>
            Take a JSON copy of everything on this device, or delete the local
            database. Diagnostics shows what this browser actually supports.
          </p>
          <Link prefetch={false} href="/control?panel=debug">
            Diagnostics →
          </Link>
        </Card>
      </div>
    </div>
  );
}
