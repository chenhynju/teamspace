# Foundation delivery evidence — 2026-10-19

All payment operations below used real provider sandbox/test APIs and synthetic organizations. No live charge or new production release was performed.

## Real provider acceptance

| Check | Result |
| --- | --- |
| Stripe and PayPal credentials | Existing official-dashboard test credentials saved in ignored local environment file; both official authentications succeeded |
| Dedicated catalog and webhooks | Four recurring prices/plans per channel, separate TeamSpace webhook endpoints |
| Stripe hosted Checkout | Browser test card payment completed; official Checkout reports `complete` / `paid`, subscription `sub_1USA8dEQmZqkfz2eQPJQao9k` |
| Stripe webhook activation | Genuine subscription event delivered through public webhook ingress, verified by official SDK; local organization and entitlement became PRO without manual reconcile |
| Stripe cancellation | Official test subscription cancellation generated signed events; organization returned to FREE |
| Stripe management | Application endpoint created an official `billing.stripe.com` portal session |
| Cross-channel duplicate purchase | Stripe-paid organization attempting PayPal checkout rejected with 409 `SUBSCRIPTION_EXISTS` |
| PayPal hosted approval | Existing Sandbox personal buyer completed subscription in browser; official subscription `I-0GFYEMNHDYFJ` ACTIVE, first USD 99 payment recorded, zero outstanding |
| PayPal webhook activation/recovery | Official resend of actual ACTIVATED and PAYMENT.SALE.COMPLETED events accepted; verified events persisted and local entitlement became PRO |
| PayPal duplicate delivery | Same real events resent again; persisted event count remained two and entitlement remained PRO |
| PayPal cancellation | Authenticated application cancellation endpoint returned CANCELED/FREE; official cancellation event also persisted |

Snapshots: `real-payments-active.json` (both PRO), `real-payments-state.json` (both FREE after cancellation), and payment screenshots. These contain synthetic identifiers, not credentials. Stripe original delivery initially failed because the temporary ingress could not reach the API; it was restarted with appropriate local networking and actual provider events proved recovery. This temporary endpoint is not production hosting.

## Fixes discovered during real acceptance

- Stripe sandbox account defaults to Managed Payments. Standard subscription checkout now explicitly disables that merchant-of-record option. A targeted regression test covers the request behavior.
- Tenant content remounts when the current organization changes, clearing page state instead of displaying the previous tenant's data.
- Billing waits for configuration before rendering environment labels, handles initial loading errors with retry, and does not offer a nonexistent FREE checkout in provider mode.
- API TypeScript and 17 payment unit tests passed. Web TypeScript and lint passed; lint retains one existing image optimization warning in IM.

## Product and operations evidence

- Browser created a flat collaboration unit, rejected removal of its last effective manager, and added another member (`browser-groups.png`).
- Browser created/activated the synthetic customer portal project, assigned a task and completed it, uploaded `browser-delivery.txt`, and downloaded it after API process restarts.
- Browser downloaded file SHA-256 matches upload source: `41649537ab4bad2172b690f27f4bac5adca839fb1d0d8b3f38f96e1e6b439c1a`.
- Browser created a seven-day explicit file share; visitor page displayed a text/plain download link. This does not substitute for negative share authorization tests in CI.
- Isolated database plus named upload volume backup/restore drill previously passed: fresh network-isolated PostgreSQL restore, row-count comparison and restored file hashes; no production data restored or overwritten.
- `ci-39192454624/` is a green historical foundation CI artifact. The sibling first local AT01–AT08 report includes a timeout and is not the authoritative full-pass claim. Latest source CI before these follow-up fixes was green at c45d416 / run 39195611957.

## Remaining boundaries

- This is sandbox acceptance. Production secrets, fixed webhook URL, production additive migration, rollout and rollback checks remain separate release work.
- Temporary Cloudflare URL requires the local API, webhook ingress and tunnel to stay running. Durable hosting is required before using this configuration as a deployment baseline.
- Real decline/past-due/payment recovery and full customer-portal subscription-change journeys have not been completed; corresponding domain state cases have automated tests.
- Enterprise SAML/SCIM/MFA, independent identity-provider service, and a separately published multi-product SDK are not implemented.
- Recurring off-host backups, alert delivery, load/availability targets and production recovery require operational rollout beyond this isolated drill.
