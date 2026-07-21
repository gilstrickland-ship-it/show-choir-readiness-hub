# Email deliverability runbook

**Audience:** the person who deploys and hosts this platform (semi-technical operator), *not* the director. DNS records and the Resend dashboard cannot be code, so this checklist is the bridge between "the app is deployed" and "families reliably receive email."

Work top to bottom. Do not send the first all-family announcement until every step through **6** is green.

Everything the app needs is three environment variables plus DNS you own. The app degrades gracefully with none of them set (sends record `skipped_no_key` and a banner shows the state), so you can deploy first and wire email second.

---

## 0. Prerequisites

- A domain you control DNS for. This should match `BRAND_DOMAIN` (or the domain in `BRAND_EMAIL_FROM_ADDRESS`). The **From** address the app sends as is `no-reply@BRAND_DOMAIN` unless you override it with `BRAND_EMAIL_FROM_ADDRESS`.
- A [Resend](https://resend.com) account.
- Access to set environment variables on your deployment (e.g. Vercel project settings).

> The single most common foot-gun: leaving `BRAND_DOMAIN` at the placeholder `octv.example`. Mail from a domain you have not verified will not be delivered. Set a real domain first. The in-app Email health card (Settings → Program) flags this exact mismatch.

---

## 1. Verify your sending domain in Resend

1. Resend dashboard → **Domains** → **Add Domain**.
2. Enter the domain you send from (the domain in your From address — e.g. `boosters.example.org`). Use a subdomain dedicated to app mail if you want to keep reputation separate from your main domain (e.g. `mail.boosters.example.org`).
3. Resend issues a set of DNS records. Add them at your DNS provider exactly as shown. There are three kinds:

   - **SPF** — a `TXT` record on the sending domain authorizing Resend's servers (`v=spf1 include:...resend... ~all`, as Resend prints it). If you already have an SPF record, merge the `include:` — do not create a second SPF record.
   - **DKIM** — one or more `CNAME` (or `TXT`) records that publish Resend's signing keys. Add all of them verbatim.
   - **Return-Path / MX** (if Resend lists one for the sending subdomain) — add it so bounces route back to Resend.

4. Back in Resend, click **Verify**. DNS can take minutes to hours to propagate; the domain flips to **Verified** when the records resolve. Do not proceed until it is verified.

---

## 2. Add a DMARC record

DMARC tells receiving mail servers what to do with mail that fails SPF/DKIM, and gives you reporting.

1. Add a `TXT` record at `_dmarc.<your-domain>`:

   ```
   v=DMARC1; p=none; rua=mailto:dmarc-reports@<your-domain>
   ```

2. Start at **`p=none`** (monitor only — nothing is quarantined; you just collect reports). Leave it here through the warm-up period below.
3. After a week or two of clean sends with no SPF/DKIM failures in the reports, tighten to **`p=quarantine`**:

   ```
   v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@<your-domain>
   ```

   Only move to `p=quarantine` after warm-up. Tightening too early can send legitimate mail to spam while DNS/authentication is still settling.

---

## 3. Set the application environment variables

Set these on your deployment and redeploy:

| Variable | Purpose | Required for |
| --- | --- | --- |
| `RESEND_API_KEY` | Server-side send key (Resend → API Keys). | Sending any email at all. |
| `RESEND_WEBHOOK_SECRET` | Svix signing secret from the Resend webhook you create in step 4. | Verified-signed bounce / complaint / unsubscribe events. |
| `BRAND_DOMAIN` | Your real domain — drives the From address and every link in email. | Delivery + working links. |
| `BRAND_EMAIL_FROM_ADDRESS` | *(optional)* Full From address if it differs from `no-reply@BRAND_DOMAIN`. | Custom From. |

Never commit these values. The app reads presence only — no env value is ever displayed in the UI.

---

## 4. Wire the Resend webhooks

The app exposes two webhook endpoints. Both live under your deployed origin:

- **Delivery events (bounces, complaints, unsubscribes):** `https://<your-app-domain>/api/webhooks/resend`
- **Inbound (packet forwarding):** `https://<your-app-domain>/api/webhooks/resend-inbound`

Steps:

1. Resend dashboard → **Webhooks** → **Add Endpoint**.
2. Endpoint URL: `https://<your-app-domain>/api/webhooks/resend`.
3. Subscribe to the delivery event types: `email.bounced`, `email.complained`, and `email.delivery_delayed` (and any unsubscribe/complaint events Resend offers). These flip `guardians.email_status` to `bounced` / `unsubscribed` so bad addresses are skipped on the next send.
4. Copy the endpoint's **Signing Secret** into `RESEND_WEBHOOK_SECRET` and redeploy. With the secret set, the endpoint verifies the svix signature and rejects unsigned calls; without it, events are soft-accepted (fine for dev, not for pilot).
5. **Inbound (optional, only if using emailed packet ingest):** add a second endpoint at `.../api/webhooks/resend-inbound` and point your inbound/parse route at `packets+<program-slug>@<your-domain>` per the inbound config. The same signing secret verifies it.

---

## 5. Warm up the sending domain

A brand-new domain has no sending reputation. Ramp gradually so mailbox providers learn the domain is legitimate:

1. **First sends to yourselves.** Send a test announcement to a handful of staff addresses (director + a couple of officers) before any family list. Confirm it lands in the inbox, not spam.
2. **Then a small real batch.** A single ensemble or a small committee, not the whole program.
3. **Then the full family list.** Only after the small batches deliver cleanly.

Do not blast the entire parent population as the very first send off a cold domain — that is the fastest way to earn a spam-folder reputation you then have to dig out of.

---

## 6. Verify end-to-end

Confirm the full loop before you rely on it:

1. **Send reaches an inbox.** From the app, send an announcement to your own address. Confirm it arrives, the From name/address is correct, and links resolve to your deployment (not the placeholder domain).
2. **Bounce flips status.** Send to a guaranteed-bounce address (`bounced@resend.dev` is Resend's sink for testing, or any address at a domain that hard-bounces). Within a moment the webhook should fire and that guardian's `email_status` should flip to `bounced`. It then appears on **People → Email deliverability** and is skipped on future sends.
3. **Unsubscribe flips status.** Use the one-click unsubscribe footer link on a guardian message; confirm that guardian flips to `unsubscribed` and drops out of subsequent announcement/digest sends.
4. **Check the in-app health card.** Settings → Program → Email health should now show: Sending configured ✓, Webhook signing ✓, From-address domain matches ✓, and a guardian inbox-health count. Any `–` there points straight back to the step above that is still open.

---

## Quick reference

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Nothing sends; banner says email not configured | `RESEND_API_KEY` unset | Set the key (step 3), redeploy. |
| Mail goes to spam | Cold domain / no warm-up / `p=quarantine` set too early | Warm up (step 5); keep DMARC at `p=none` until clean. |
| Bounces never update guardian status | Webhook not wired or secret missing | Add the endpoint + `RESEND_WEBHOOK_SECRET` (step 4). |
| Health card flags From-domain mismatch | `BRAND_DOMAIN` is still `octv.example` or a domain you have not verified | Set a real, Resend-verified domain (steps 0–1). |
| Links in email point at the wrong host | `BRAND_DOMAIN` / app URL misconfigured | Point them at your real deployment origin, redeploy. |
