'use client';
import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, Button, Badge, Input, Field, InlineError } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

export default function BillingPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [overview, setOverview] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [stripeConfig, setStripeConfig] = useState<any>(null);
  const [paypalConfig, setPaypalConfig] = useState<any>(null);
  const [provider, setProvider] = useState<'stripe'|'paypal'>('stripe');
  const [stripeBusy, setStripeBusy] = useState(false);

  // webhook 模拟器
  const [eventId, setEventId] = useState('evt-demo-001');
  const [amount, setAmount] = useState(50000);
  const [simLog, setSimLog] = useState<string[]>([]);
  const [simBusy, setSimBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [o, p] = await Promise.all([
      api.get('/billing/overview'),
      api.get('/billing/plans'),
    ]);
    const [stripe, paypal] = await Promise.all([api.get('/billing/stripe/configuration'), api.get('/billing/paypal/configuration')]);
    setStripeConfig(stripe.data); setPaypalConfig(paypal.data); if (!stripe.data.enabled && paypal.data.enabled) setProvider('paypal');
    setOverview(o.data);
    setPlans(p.data);
    if (hasPerm('billing:manage')) {
      api.get('/billing/events').then((r) => setEvents(r.data)).catch(() => setEvents([]));
    }
  }, [hasPerm]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const subscribe = async (code: string) => {
    setError(null);
    if ((provider === 'stripe' ? stripeConfig?.enabled : paypalConfig?.enabled)) {
      setStripeBusy(true);
      try { const r = await api.post(`/billing/${provider}/checkout`, { planCode: code, interval: 'monthly' }); window.location.assign(r.data.url); }
      catch (e: any) { setError(e.response?.data?.message ?? '无法打开收银台'); }
      finally { setStripeBusy(false); }
      return;
    }
    if (!stripeConfig?.sandboxEnabled) { setError('支付尚未配置，请联系管理员'); return; }
    if (!confirm(`确认在沙盒环境切换到「${code}」套餐？不会产生真实支付。`)) return;
    try {
      await api.post('/billing/subscribe', { planCode: code, interval: 'monthly' });
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.message ?? '变更失败');
    }
  };

  /** AT05：同一事件发送两次，第二次应判重且权益不重复增加 */
  const simulateDuplicate = async () => {
    setSimBusy(true);
    setSimLog([]);
    const orgId = overview.organization.id;
    const before = overview.entitlement.aiCreditsTotal;
    const body = {
      provider: 'stripe-sandbox',
      eventId,
      type: 'entitlement.grant_ai_credits',
      organizationId: orgId,
      payload: { amount: Number(amount) },
    };
    try {
      const r1 = await api.post('/billing/sandbox/grant', { eventId, amount: Number(amount) });
      const mid = (await api.get('/billing/overview')).data.entitlement.aiCreditsTotal;
      const r2 = await api.post('/billing/sandbox/grant', { eventId, amount: Number(amount) });
      const after = (await api.get('/billing/overview')).data.entitlement.aiCreditsTotal;

      setSimLog([
        `发送前 AI 总额度：${before}`,
        `第 1 次事件：${JSON.stringify(r1.data)} → 额度变为 ${mid}（+${amount}）`,
        `第 2 次事件：${JSON.stringify(r2.data)} → 额度保持 ${after}`,
        mid === after ? '✅ 重复事件被幂等拦截，权益未重复增加' : '❌ 幂等失败',
      ]);
      await refresh();
    } catch (e: any) {
      setSimLog([`模拟失败：${e.response?.data?.message ?? e.message}`]);
    } finally {
      setSimBusy(false);
    }
  };

  const ent = overview?.entitlement;
  const seatsUsed = overview?.activeSeats ?? 0;

  return (
    <div className="p-6">
      <PageHeader
        title="套餐与权益"
        description={(provider === 'stripe' ? stripeConfig?.enabled : paypalConfig?.enabled) ? `${provider === 'stripe' ? 'Stripe' : 'PayPal'} ${(provider === 'stripe' ? stripeConfig.mode : paypalConfig.mode) === 'live' ? '正式支付' : '测试环境'} · 权益以订阅对账为准` : '套餐沙盒 · 不产生真实扣款'}
      />

      <InlineError message={error} />
      <div className="flex gap-3 mb-4" aria-label="支付渠道">
        <Button variant={provider === 'stripe' ? 'primary' : 'secondary'} onClick={() => setProvider('stripe')}>Stripe {stripeConfig?.enabled ? '' : '（未配置）'}</Button>
        <Button variant={provider === 'paypal' ? 'primary' : 'secondary'} onClick={() => setProvider('paypal')}>PayPal {paypalConfig?.enabled ? '' : '（未配置）'}</Button>
      </div>
      {provider === 'paypal' && paypalConfig?.enabled && <Card className="p-4 mb-4 flex gap-3 flex-wrap"><span>PayPal 授权后，权益以服务器对账结果为准。</span><Button disabled={stripeBusy} onClick={async () => { setStripeBusy(true); try { await api.post('/billing/paypal/reconcile'); await refresh(); } catch (e: any) { setError(e.response?.data?.message ?? '对账失败'); } finally { setStripeBusy(false); } }}>同步 PayPal 订阅</Button><Button variant="danger" disabled={stripeBusy} onClick={async () => { if (!confirm('立即取消 PayPal 订阅并收回付费权益？此操作不会自动退款。')) return; setStripeBusy(true); try { await api.post('/billing/paypal/cancel'); await refresh(); } catch (e: any) { setError(e.response?.data?.message ?? '取消失败'); } finally { setStripeBusy(false); } }}>立即取消 PayPal 订阅</Button></Card>}

      {provider === 'stripe' && stripeConfig?.enabled && <Card className="p-4 mb-4 flex gap-3 items-center"><span>返回本站不会直接开通权益，请等待账单同步。</span><Button disabled={stripeBusy} onClick={async () => { setError(null); setStripeBusy(true); try { const r = await api.post('/billing/stripe/portal'); window.location.assign(r.data.url); } catch (e: any) { setError(e.response?.data?.message ?? '打开账单失败'); } finally { setStripeBusy(false); } }}>管理 Stripe 账单</Button><Button variant="secondary" disabled={stripeBusy} onClick={async () => { setStripeBusy(true); try { await api.post('/billing/stripe/reconcile'); await refresh(); } catch (e: any) { setError(e.response?.data?.message ?? '对账失败，请稍后重试'); } finally { setStripeBusy(false); } }}>同步订阅状态</Button></Card>}


      {/* 当前权益 */}
      {overview ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Stat label="当前套餐" value={overview.organization.plan?.name ?? '-'} />
          <Stat
            label="席位使用"
            value={`${seatsUsed} / ${ent.seatsIncluded}`}
            warn={seatsUsed >= ent.seatsIncluded}
          />
          <Stat
            label="AI 额度"
            value={`${(ent.aiCreditsUsed / 10000).toFixed(1)} / ${(ent.aiCreditsTotal / 10000).toFixed(0)} 万 tokens`}
          />
          <Stat label="项目上限 / 存储" value={`${ent.maxProjects} 个 / ${ent.storageGb} GB`} />
        </div>
      ) : null}

      {/* 套餐选择 */}
      {hasPerm('billing:change') ? (
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          {plans.map((p) => {
            const current = overview?.organization.plan?.code === p.code;
            return (
              <Card key={p.code} className="p-5">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-800">{p.name}</h3>
                  {current ? <Badge tone="green">当前套餐</Badge> : null}
                </div>
                <div className="mt-3">
                  <span className="text-2xl font-semibold text-slate-800">
                    {new Intl.NumberFormat('zh-CN', { style: 'currency', currency: (provider === 'stripe' ? stripeConfig?.currency : paypalConfig?.currency) ?? 'CNY' }).format(Number(p.priceMonthly))}
                  </span>
                  <span className="text-sm text-slate-400"> /月 · {new Intl.NumberFormat('zh-CN', { style: 'currency', currency: (provider === 'stripe' ? stripeConfig?.currency : paypalConfig?.currency) ?? 'CNY' }).format(Number(p.priceYearly))}/年</span>
                </div>
                <ul className="mt-4 space-y-1.5 text-xs text-slate-600">
                  <li>{p.seatsIncluded} 个席位</li>
                  <li>{(p.aiCredits / 10000).toFixed(0)} 万 AI tokens/月</li>
                  <li>{p.maxProjects} 个项目 · {p.storageGb} GB 存储</li>
                </ul>
                <Button
                  className="w-full mt-5"
                  variant={current ? 'secondary' : 'primary'}
                  disabled={current || stripeBusy}
                  onClick={() => subscribe(p.code)}
                >
                  {current ? '使用中' : (provider === 'stripe' ? stripeConfig?.enabled : paypalConfig?.enabled) ? `前往 ${provider === 'stripe' ? 'Stripe' : 'PayPal'} 订阅` : '沙盒切换'}
                </Button>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* webhook 幂等模拟 */}
      {hasPerm('billing:change') && stripeConfig?.sandboxEnabled ? (
        <Card className="p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">Webhook 幂等模拟器（AT05）</h2>
          <p className="text-xs text-slate-400 mb-4">
            同一 provider + eventId 的事件发送两次，验证重复事件不重复增加权益。
          </p>
          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <Field label="事件 ID（相同即重复）">
              <Input value={eventId} onChange={(e) => setEventId(e.target.value)} />
            </Field>
            <Field label="授予 AI 额度（tokens）">
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </Field>
            <div className="flex items-end">
              <Button onClick={simulateDuplicate} disabled={simBusy} className="w-full">
                {simBusy ? '模拟中…' : '发送同一事件两次'}
              </Button>
            </div>
          </div>
          {simLog.length > 0 ? (
            <pre className="bg-slate-900 text-slate-100 text-xs rounded-lg p-4 whitespace-pre-wrap">
              {simLog.join('\n')}
            </pre>
          ) : null}
        </Card>
      ) : null}

      {/* 计费事件 */}
      {hasPerm('billing:manage') && stripeConfig?.sandboxEnabled ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">计费事件（最近 50 条）</h2>
          {events.length === 0 ? (
            <p className="text-xs text-slate-400">暂无事件</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2 pr-3">Event ID</th>
                  <th className="py-2 pr-3">类型</th>
                  <th className="py-2">时间</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 pr-3 text-slate-600">{e.provider}</td>
                    <td className="py-2 pr-3 text-slate-600">{e.eventId}</td>
                    <td className="py-2 pr-3 text-slate-600">{e.type}</td>
                    <td className="py-2 text-slate-400">{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <Card className="p-4">
      <div className={`text-lg font-semibold ${warn ? 'text-red-600' : 'text-slate-800'}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </Card>
  );
}
