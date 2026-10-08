import { NextResponse } from 'next/server';
// Retired Next.js memory stub: server memory lives on the Workers platform
// (GET /api/memory, POST /api/memory/save via /api/platform). Returning an
// empty list here would silently pretend the user has no memories, so fail
// closed with 410 instead of lying.
const GONE = { error: 'This memory route is retired. Use the platform memory API.' };
export async function GET() {
  return NextResponse.json(GONE, { status: 410 });
}
export async function POST() {
  return NextResponse.json(GONE, { status: 410 });
}
export async function DELETE() {
  return NextResponse.json(GONE, { status: 410 });
}
