# TeamSpace fixed-host release — 2026-10-19

This report supersedes the earlier “not deployed / temporary tunnel” boundary for the checks below. Payments remain Stripe TEST and PayPal SANDBOX. No live payment credentials or real-money transactions were used.

## Released runtime

- Web: https://app.purelamp.uk ; API: https://api.purelamp.uk/api/v1 . Browser login and the existing Acme dashboard were verified after release.
- Deployed source: `16ab7166101ecc2569830fa41e9d6e464d6d4007`, already green in CI run `39220775059`.
- API image: `sha256:b8e9bb2cbce68e85daaff909095f06c3f17cefb16a57e494c5133acc1ff3d783`.
- Web image: `sha256:f496a3c072d5a6971d59d751eaace144fdfbce545926e63dcc472db6adddd8b4`.
- `/opt/teamspace/docker-compose.server.yml` retains loopback-only ports, service memory limits, log rotation and existing database/Redis volumes. All four containers became healthy; public API readiness reports database/Redis up.
- Additive migration `deploy/migrations/20261019-foundation.sql` applied successfully, including flat collaboration resources, tenant-bound foreign keys, RLS policies and application-role grants. No production seed or database reset was run.
- Billing configuration merged into the existing server `.env.production` without replacing unrelated settings. Secret values were not printed or committed.

## Fixed webhook acceptance

- Stripe: https://api.purelamp.uk/api/v1/billing/stripe/webhook
- PayPal: https://api.purelamp.uk/api/v1/billing/paypal/webhook
- Existing TeamSpace sandbox endpoints were updated using the official provider APIs; IDs and read-back URLs are recorded in `fixed-webhooks.json`.
- Public unsigned POSTs return 401. Genuine provider events were verified and persisted after deployment.
- Local temporary Cloudflare tunnel and local webhook ingress were stopped after verification. Fixed endpoints run on the server and no longer depend on the local computer.

| Online-host test | Evidence |
| --- | --- |
| Stripe application Checkout creation | 201 with official checkout.stripe.com URL |
| Stripe fixed-host payment/event smoke | The mapped synthetic test customer paid a real sandbox API-created subscription invoice for CNY 99. Signed events reached the fixed endpoint and granted PRO. The uncompleted Checkout session was expired before the API fixture; hosted browser Checkout was tested separately in the earlier acceptance. |
| PayPal hosted browser payment | Existing Sandbox Personal buyer approved subscription `I-LCWP6LGKRXER`; official first USD 99 payment recorded, zero outstanding, ACTIVE. Fixed signed events granted PRO without manual reconcile. |
| Cancellation | Stripe and PayPal test subscriptions canceled; fixed events persisted and both test organizations returned to FREE. |

`production-payments-active.json` and `production-payments-canceled.json` record the before/after states. `production-paypal-paid.png` shows the online test organization after payment, before its cleanup cancellation. These are synthetic acceptance records.

## Actual sandbox renewal failure and recovery

`stripe-dunning.json` records an official Stripe Test Clock simulation against the isolated test database:

1. A paid subscription and genuine events grant PRO.
2. Advance to renewal with Stripe's declining test payment method. Provider becomes `past_due`; genuine `invoice.payment_failed` / subscription events revoke both organization plan and entitlement to FREE.
3. Attach a successful test method and pay the original outstanding invoice. Provider returns `active`; genuine paid/update events restore both plan and entitlement to PRO.
4. Synthetic subscription canceled after the test.

This is real sandbox provider state with simulated time, not a hand-authored webhook or live-money trial. The fixture's customer-to-organization mapping was provisioned explicitly for Test Clock setup; normal mapping was covered by hosted Checkout. Official reference: https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage . A real PayPal renewal-decline recovery cycle was not run; the prior automated PayPal state tests remain separate evidence.

## Production persistence and recovery

- Before replacement, stop the legacy API and consistently back up its database plus `/app/apps/api/.uploads`; restart automatically. The backup restored into a fresh network-isolated PostgreSQL container and file checksums matched.
- A second consistent cutover backup captured the latest files before migration. Existing file bytes were copied to named volume `teamspace_uploads`, chowned to the application user, and verified before replacement.
- Runtime `UPLOAD_ROOT=/data/uploads`; the new image reads and writes this mounted volume.
- Through the authenticated application, create a synthetic workspace/project and upload `release-persistence.txt`. After forcibly recreating the API container, authenticated download still matches SHA-256 `b0f2f429284b8b4df1a9801438b5f70256eeed0907de6ff89a53f1d6ddb2d5cf`.
- The application DB role is neither superuser nor BYPASSRLS. A different tenant's owner requesting the synthetic project returns 403 before and after recreation. See `production-file-recreate.json`.
- Post-release consistent backup: `/opt/teamspace-releases/foundation-20261019/post-release-backups/teamspace-20261019T100335Z.tar.gz`. Isolated restore `teamspace-restore-20261019101056` passed database row-count comparison and both restored file hashes; the evidence container was stopped.

## Rollback assets and boundaries

Server-private `/opt/teamspace-releases/foundation-20261019/` retains old environment/compose snapshots, pre-migration/cutover backups, build/migration logs and restore evidence. Old images remain tagged `teamspace-api:rollback-foundation-20261019` and `teamspace-web:rollback-foundation-20261019`.

Runtime rollback keeps the additive schema and persistent files: restore the saved environment, tag the rollback images as the compose runtime images, and mount the same upload volume at the legacy API path `/app/apps/api/.uploads` as well. Never restore an old database over newer tenant writes as a routine rollback. Rollback artifacts were prepared; an actual production rollback was not exercised.

This is a deployed app with test-mode payments, not an approval for live collection. Recurring encrypted off-host backup, alert delivery and production load/availability targets remain operations work. SAML/SCIM/MFA and a separately published reusable SDK remain future product work.

## Commit integrity

Unexpected external working-tree rollbacks were observed during preparation. Their diff was preserved in ignored `.test-runs/shared-worktree-20261019.patch`. An accidentally included four-file rollback commit `acf67c9` was reversed by append-only commit `a69e962` after user authorization; its tree is identical to `16ab716`, and CI run `39231945664` passed. No history was rewritten, and unrelated uncommitted work was neither published nor discarded. Production was built only from the clean server checkout at `16ab716`.
