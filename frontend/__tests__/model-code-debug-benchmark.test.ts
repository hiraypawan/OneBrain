import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as chat } from '../app/api/chat/route';

/**
 * Small live quality smoke-test for code-debugging. This is deliberately
 * opt-in: normal CI never sends prompts to an external model or needs a key.
 * Run with ONEBRAIN_RUN_MODEL_DEBUG_BENCHMARK=1 and
 * ONEBRAIN_DEBUG_BENCHMARK_GEMINI_KEY set in the local test environment.
 */
const apiKey = process.env.ONEBRAIN_DEBUG_BENCHMARK_GEMINI_KEY || '';
const enabled = process.env.ONEBRAIN_RUN_MODEL_DEBUG_BENCHMARK === '1' && !!apiKey;

const cases = [
  {
    name: 'finds the last-array-element off-by-one and proposes a boundary test',
    message: [
      'Debug this JavaScript. Explain the defect, return a minimal correction, and give one test.',
      'function indexOfFirstPositive(xs) {',
      '  for (let i = 0; i < xs.length - 1; i++) {',
      '    if (xs[i] > 0) return i;',
      '  }',
      '  return -1;',
      '}',
      'For [0, 1], this incorrectly returns -1.',
    ].join('\n'),
    rubric: [
      /off.?by.?one|last (?:array )?(?:element|item)|final (?:array )?(?:element|item)/i,
      /i\s*<\s*xs\.length|xs\.length\s*\)/i,
      /\[0,\s*1\]|boundary test|test.*last/i,
    ],
  },
  {
    name: 'identifies the unresolved fetch promise and awaits JSON parsing',
    message: [
      'Debug this JavaScript and give the smallest safe fix plus one failure or empty-list case to test.',
      'async function firstUserName() {',
      "  const users = fetch('/users').then((r) => r.json());",
      '  return users[0].name;',
      '}',
      'It throws TypeError in the browser.',
    ].join('\n'),
    rubric: [
      /promise|fetch.*await|await.*fetch/i,
      /await.*json|json\(\).*await/i,
      /empty|undefined|null|optional chaining|\?\./i,
    ],
  },
];

describe.skipIf(!enabled)('live model code-debugging quality smoke-test', () => {
  it.each(cases)('$name', async ({ message, rubric }) => {
    const response = await chat(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: [],
        userKey: apiKey,
        provider: 'gemini',
        language: 'en-IN',
        verbosity: 'medium',
      }),
    }));
    expect(response.status).toBe(200);
    const result = await response.json() as { answer?: unknown; provider?: unknown };
    expect(result.provider).toBe('gemini');
    expect(typeof result.answer).toBe('string');
    const answer = result.answer as string;
    for (const criterion of rubric) expect(answer).toMatch(criterion);
  }, 90_000);
});
