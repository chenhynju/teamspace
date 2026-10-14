import { NextResponse } from 'next/server';

// 存活探针：供 ECS / Nginx / uptime 监控探活，无需鉴权
export async function GET() {
  return NextResponse.json({ status: 'ok', ts: Date.now() });
}

export const dynamic = 'force-dynamic';
