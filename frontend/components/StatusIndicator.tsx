'use client';
import type { AssistantStatus } from '@/lib/types';

const color: Record<AssistantStatus, string> = {
  idle: 'bg-gray-600',
  listening: 'bg-green-500 animate-pulse',
  processing: 'bg-yellow-500 animate-spin',
  speaking: 'bg-blue-500 animate-pulse',
  error: 'bg-red-600',
};

export function StatusIndicator({ status }: { status: AssistantStatus }) {
  return (
    <div className="flex items-center gap-2" data-testid={`status-${status}`}>
      <span className={`w-3 h-3 rounded-full ${color[status]}`} />
      <span className="text-sm uppercase tracking-widest text-gray-300">{status}</span>
    </div>
  );
}
