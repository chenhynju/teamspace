# Payment sandbox configuration — 2026-10-19

- Credentials retrieved from the authenticated official dashboards; existing test credentials reused. Raw values are stored only in ignored `.test-runs/payments-sandbox.env`.
- Stripe account `acct_1US7EhEQmZqkfz2e`: official API authentication succeeded. Four TeamSpace recurring prices created (PRO/ENTERPRISE × monthly/yearly, CNY).
- Stripe test webhook: `we_1US7ibEQmZqkfz2eUg4m3KkX`.
- PayPal Sandbox: official OAuth returned HTTP 200. Four TeamSpace recurring plans created (PRO/ENTERPRISE × monthly/yearly, USD).
- PayPal Sandbox webhook: `60N07026TP336443B`.
- Both setup scripts completed successfully and saved price/plan mappings and webhook verification settings.
- Local isolated API started with this file, BILLING_MODE=stripe, PayPal sandbox, synthetic PostgreSQL database and Redis. Prisma connected and Nest reported successfully started on port 3411.
- Temporary webhook base: `https://apparent-sitemap-win-carefully.trycloudflare.com`. Only the two POST webhook paths are proxied. This URL is temporary and requires the local tunnel/ingress/API to remain running.
- Latest source CI: run 39195611957, commit c45d416, SUCCESS.
- Checkout completion, actual provider webhook delivery, and entitlement activation are NOT YET VERIFIED. Authentication and setup success are not payment completion.
- No production feature deployment or production credential/schema changes in this configuration step.

## Follow-up after user approval

- PayPal application checkout returned 201 and an official `www.sandbox.paypal.com` approval URL, using a newly provisioned synthetic organization. This proves checkout creation, not paid completion.
- Stripe application checkout reached the real provider but failed because the sandbox account defaults to Managed Payments and products have no eligible tax code. Request trace: `hLWtBnmF3aGVVN5j`.
- Fixed Stripe checkout to explicitly use standard Billing (`managed_payments.enabled=false`) instead of inheriting the merchant-of-record default. Added a targeted regression test.
- TypeScript compilation passed. Payment unit tests: 17/17 passed.
- Restarting the isolated API with the fix was not executed: automatic approval review reported model capacity failure. Earlier review attempts also timed out. The previous API process was stopped before compilation; it must be restarted to resume verification.
- Real Stripe checkout after the fix, paid completion for both channels, webhook delivery, and entitlement updates remain NOT VERIFIED. No production release was performed.

## Later continuation — supersedes the blocked status above

Tool execution recovered. Both hosted sandbox payments completed, genuine signed provider events granted PRO, duplicate PayPal redelivery did not duplicate records, and cancellation returned both organizations to FREE. See [current delivery evidence](DELIVERY.md), active/canceled database snapshots, and browser screenshots. Production release remains outside this sandbox acceptance.
