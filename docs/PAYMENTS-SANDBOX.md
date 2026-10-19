# Stripe 与 PayPal 沙盒配置

目标是使用真实供应商测试环境完成“订阅创建 → 测试付款 → Webhook 验证 → 本地权益 → 取消/恢复”。单元测试中的供应商替身不计作此验收。

## 获取凭据

Stripe：登录 https://dashboard.stripe.com/ ，创建独立 Sandbox，再在 API keys 获取 `sk_test_...`。Workbench/Webhooks 中每个端点的 `whsec_...` 是另一项凭据，不是 API key。托管 Checkout 的当前集成不需要把 secret key 放到浏览器。

PayPal：登录 https://developer.paypal.com/dashboard/ ，选择 Sandbox → Apps & Credentials → Create App，创建 TeamSpace REST 应用，保存 Client ID、Secret。Testing Tools → Sandbox Accounts 中准备 Business 收款账户与 Personal 测试买方。订阅使用 Billing Subscriptions API，不使用作品集的一次性 Orders capture 流程。

官方依据：
- https://docs.stripe.com/keys
- https://stripe.com/global
- https://developer.paypal.com/api/get-started/
- https://developer.paypal.com/subscriptions/integrate
- https://developer.paypal.com/api/rest/webhooks/rest/

正式商户资格另验收；测试账户不证明正式收款可用。Stripe 当前正式商户地区列表未包含中国大陆，包含香港，使用真实主体信息核实资格。

## 本地凭据文件

`.test-runs/payments-sandbox.env` 已被 Git 忽略。先填写：

```dotenv
STRIPE_SECRET_KEY=sk_test_replace
PAYPAL_CLIENT_ID=replace_sandbox_app_client_id
PAYPAL_CLIENT_SECRET=replace_sandbox_app_secret
PAYPAL_ENV=sandbox
```

不要将正式 PayPal Live 配置当成 Sandbox 配置；Client ID/Secret 是按环境区分的。

## 初始化专属资源

先准备一个可从供应商访问的 HTTPS Webhook 基地址，写入同一文件：

```dotenv
PUBLIC_WEBHOOK_BASE_URL=https://your-sandbox-webhook-host
```

本地临时隧道只应转发 `scripts/webhook-ingress.cjs` 的 3422 端口。它只放行 POST `/api/v1/billing/stripe/webhook` 和 `/api/v1/billing/paypal/webhook`，不公开管理 API。当前线上应用尚未发布新接口时，不要将端点误设为生产地址。

在 `apps/api` 运行：

```sh
node scripts/setup-stripe-test.cjs ../../.test-runs/payments-sandbox.env
node scripts/setup-paypal-sandbox.cjs ../../.test-runs/payments-sandbox.env
```

脚本拒绝 Stripe live key / PayPal live 环境，不打印 secret。Stripe 建 CNY 周期价格，PayPal 建 USD 周期价格，二者是独立价格表而非自动汇率换算；前端按渠道显示币种。当前套餐数值沿用合成套餐，正式定价另确认。

初始化输出会更新 `STRIPE_WEBHOOK_SECRET`、`STRIPE_PRICE_MAP`、`PAYPAL_WEBHOOK_ID`、`PAYPAL_PLAN_MAP`，保留已有的其他渠道配置。

## 验收清单

1. 配置端点必须显示对应环境 ready，未配置渠道不能伪装为供应商支付成功。
2. 组织管理员通过 Checkout/PayPal 授权链接创建订阅，确认页面返回不直接授予权益。
3. Stripe 用官方测试卡；PayPal 用 Sandbox Personal 买方完成测试交易。
4. 验证供应商真实 Webhook 到达、验签通过、记录事件及订阅，并更新对应组织权益。
5. 重送事件不重复发权益；旧事件按供应商当前状态对账；错误签名拒绝。
6. 待确认的结账意图不允许切换另一个渠道重复创建。结果未知时使用同一供应商幂等键恢复。
7. Stripe 用 Portal 管理；PayPal 当前明确支持“立即取消并收回权益”，不自动退款。跨渠道变更需先取消现有订阅。
8. 取消/失败同步为 FREE，恢复成功后重新授予。记录真实环境证据，不能用 HTTP 200 代替付款和权益断言。

凭据、Webhook secrets、买方登录信息不进入证据或 Git。真实资金和正式上线不包含在沙盒付款授权中。
