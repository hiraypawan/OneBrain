import { describe, expect, it, vi } from 'vitest';
import { listPuterImageModels, listPuterModels } from '../lib/puter';

describe('Puter runtime model discovery', () => {
  it('normalizes the live chat catalog, removes duplicate/invalid IDs, and preserves provider metadata', async () => {
    const listModels = vi.fn(async () => [
      { id: 'z-model', name: 'Zeta', provider: 'openai', context: 32000, max_tokens: 1000, cost: { input: 0.1 } },
      { id: 'a-model', name: 'Alpha', provider: 'gemini', cost: 'varies' },
      { id: 'a-model', name: 'Same model at another provider', provider: 'openrouter' },
      { id: 'a-model', name: 'Duplicate without provider' },
      { id: '', name: 'Invalid' },
      null,
    ]);
    const result = await listPuterModels({ puter: { ai: { listModels } } });
    expect(listModels).toHaveBeenCalledOnce();
    expect(result.map((m) => `${m.provider}:${m.id}`)).toEqual(['gemini:a-model', 'openai:z-model', 'openrouter:a-model']);
    expect(result.find((m) => m.id === 'z-model')).toMatchObject({
      provider: 'openai', context: 32000, max_tokens: 1000, cost: { input: 0.1 },
    });
    expect(result.find((m) => m.id === 'a-model')?.cost).toBe('varies');
  });

  it('reads the wrapped image catalog and never invents a default model', async () => {
    const call = vi.fn(async (service: string, action: string, args: unknown) => {
      expect(service).toBe('puter-image-generation');
      expect(action).toBe('models');
      expect(args).toEqual({});
      return { result: [{ id: 'replicate:flux-schnell', provider: 'replicate', cost: { unit: 'image' } }] };
    });
    const result = await listPuterImageModels({ puter: { drivers: { call } } });
    expect(result).toEqual([{ id: 'replicate:flux-schnell', provider: 'replicate', cost: { unit: 'image' } }]);
  });

  it('surfaces catalog API failures instead of silently selecting a model', async () => {
    await expect(listPuterImageModels({})).rejects.toThrow(/discovery is unavailable/i);
    await expect(listPuterModels({})).rejects.toThrow(/discovery is unavailable/i);
  });
});
