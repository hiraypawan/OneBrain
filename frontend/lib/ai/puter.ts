// Puter browser AI integration. Calls are never made merely because an SDK
// session happens to exist: the user must explicitly enable Puter in settings.
export interface PuterMessage {
  role: string;
  content: string;
}

export interface PuterModelOption {
  id: string;
  name?: string;
  provider?: string;
  context?: number;
  max_tokens?: number;
  cost?: unknown;
}

export interface PuterChatOptions {
  enabled?: boolean;
  model?: string;
  provider?: string;
  timeoutMs?: number;
  maxTokens?: number;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  onChunk?: (text: string) => void;
  shouldContinue?: () => boolean;
}

function extractText(res: any): string {
  const content = res?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((b: any) => (typeof b === 'string' ? b : b?.text || '')).join('').trim();
  }
  if (typeof res === 'string') return res.trim();
  return '';
}

function extractChunkText(chunk: any): string {
  if (typeof chunk === 'string') return chunk;
  if (typeof chunk?.text === 'string') return chunk.text;
  const delta = chunk?.choices?.[0]?.delta?.content;
  if (typeof delta === 'string') return delta;
  if (Array.isArray(delta)) return delta.map((part: any) => part?.text || '').join('');
  return '';
}

export function puterSessionReady(target: any = typeof window === 'undefined' ? undefined : window): boolean {
  const puter = target?.puter;
  if (!puter?.ai?.chat) return false;
  try {
    if (typeof puter.auth?.isSignedIn === 'function') return !!puter.auth.isSignedIn();
  } catch {
    return false;
  }
  return !!puter.authToken;
}

/** Explicit consent is a separate condition from having a cached Puter session. */
export function puterReady(
  target: any = typeof window === 'undefined' ? undefined : window,
  enabled = false,
): boolean {
  return enabled && puterSessionReady(target);
}

function normalizeModelList(value: unknown, requireProvider = false): PuterModelOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry: any) => {
    const id = typeof entry?.id === 'string' ? entry.id.trim().slice(0, 160) : '';
    const rawProvider = typeof entry?.provider === 'string' ? entry.provider.trim().slice(0, 80) : '';
    const provider = /^[a-z0-9._:-]{1,80}$/i.test(rawProvider) ? rawProvider : '';
    if (!id || (requireProvider && !provider) || seen.has(`${provider}::${id}`)) return [];
    seen.add(`${provider}::${id}`);
    return [{
      id,
      ...(typeof entry.name === 'string' ? { name: entry.name.slice(0, 160) } : {}),
      ...(provider ? { provider } : {}),
      ...(Number.isFinite(entry.context) ? { context: Number(entry.context) } : {}),
      ...(Number.isFinite(entry.max_tokens) ? { max_tokens: Number(entry.max_tokens) } : {}),
      ...(typeof entry.cost === 'string' || (typeof entry.cost === 'number' && Number.isFinite(entry.cost)) || (entry.cost && typeof entry.cost === 'object') ? { cost: entry.cost } : {}),
    }];
  }).sort((a, b) => (a.provider || '').localeCompare(b.provider || '') || (a.name || a.id).localeCompare(b.name || a.id));
}

export async function listPuterModels(
  target: any = typeof window === 'undefined' ? undefined : window,
): Promise<PuterModelOption[]> {
  const list = target?.puter?.ai?.listModels;
  if (typeof list !== 'function') throw new Error('Puter model discovery is unavailable.');
  return normalizeModelList(await list.call(target.puter.ai), true);
}

export async function listPuterImageModels(
  target: any = typeof window === 'undefined' ? undefined : window,
): Promise<PuterModelOption[]> {
  const call = target?.puter?.drivers?.call;
  if (typeof call !== 'function') throw new Error('Puter image model discovery is unavailable.');
  const response = await call.call(target.puter.drivers, 'puter-image-generation', 'models', {});
  return normalizeModelList(Array.isArray(response) ? response : response?.result);
}

export async function askPuter(
  history: PuterMessage[],
  system: string,
  options: PuterChatOptions = {},
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelMonitor: ReturnType<typeof setTimeout> | undefined;
  let streamPollTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelStream: (() => void) | undefined;
  let stopped = false;
  try {
    if (typeof window === 'undefined' || !puterReady(window, options.enabled)) return null;
    if (options.shouldContinue && !options.shouldContinue()) return null;
    const puter = (window as any).puter;
    const model = typeof options.model === 'string' ? options.model.trim().slice(0, 160) : '';
    const provider = typeof options.provider === 'string' ? options.provider.trim().slice(0, 80) : '';
    // A saved model ID without its catalog provider could route to a different
    // vendor. Fail closed and let the user choose a current model/provider pair.
    if (model && !provider) return null;
    const callOptions: Record<string, unknown> = {
      max_tokens: Math.min(4000, Math.max(100, options.maxTokens || 700)),
      normalize: true,
      ...(options.onChunk ? { stream: true } : {}),
      ...(model ? { model } : {}),
      ...(provider ? { provider } : {}),
      ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
    };
    const task = (async () => {
      const res = await puter.ai.chat(
        [{ role: 'system', content: system }, ...(history || []).slice(-21)],
        callOptions,
      );
      if (res && typeof res[Symbol.asyncIterator] === 'function') {
        const iterator = res[Symbol.asyncIterator]();
        cancelStream = () => {
          stopped = true;
          try { void iterator.return?.(); } catch { /* best-effort SDK cancellation */ }
        };
        if (stopped) cancelStream();
        let output = '';
        let pending = iterator.next();
        while (!stopped) {
          const result = await Promise.race([
            pending.then(
              (value: IteratorResult<unknown>) => ({ kind: 'next' as const, value }),
              (error: unknown) => ({ kind: 'error' as const, error }),
            ),
            new Promise<{ kind: 'poll' }>((resolve) => {
              streamPollTimer = setTimeout(() => resolve({ kind: 'poll' }), 50);
            }),
          ]);
          if (result.kind === 'poll') {
            streamPollTimer = undefined;
            if (options.shouldContinue && !options.shouldContinue()) {
              cancelStream();
              return null;
            }
            continue;
          }
          if (streamPollTimer) clearTimeout(streamPollTimer);
          streamPollTimer = undefined;
          if (result.kind === 'error') throw result.error;
          if (result.value.done) break;
          const chunk = result.value.value as any;
          if (chunk?.type === 'error') throw new Error(String(chunk.message || 'Puter stream failed'));
          const text = extractChunkText(chunk);
          if (text) {
            output += text;
            options.onChunk?.(output);
          }
          if (options.shouldContinue && !options.shouldContinue()) {
            cancelStream();
            return null;
          }
          pending = iterator.next();
        }
        return stopped ? null : output.trim() || null;
      }
      const text = extractText(res);
      if (text && !stopped && (!options.shouldContinue || options.shouldContinue())) options.onChunk?.(text);
      return stopped || (options.shouldContinue && !options.shouldContinue()) ? null : text || null;
    })();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        stopped = true;
        cancelStream?.();
        reject(new Error('puter-timeout'));
      }, Math.min(120_000, Math.max(1, options.timeoutMs ?? 20_000)));
    });
    const cancelled = options.shouldContinue
      ? new Promise<null>((resolve) => {
          const check = () => {
            if (!options.shouldContinue!()) {
              stopped = true;
              cancelStream?.();
              resolve(null);
            } else {
              cancelMonitor = setTimeout(check, 50);
            }
          };
          check();
        })
      : null;
    return await Promise.race(cancelled ? [task, timeout, cancelled] : [task, timeout]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    if (cancelMonitor) clearTimeout(cancelMonitor);
    if (streamPollTimer) clearTimeout(streamPollTimer);
  }
}
