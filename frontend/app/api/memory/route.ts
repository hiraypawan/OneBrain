import { NextResponse } from 'next/server';
// Memory API stub — swap with backend Postgres calls via NEXT_PUBLIC_API_URL
export async function GET() {
  return NextResponse.json({ memories: [] });
}
export async function POST() {
  return NextResponse.json({ ok: true });
}
