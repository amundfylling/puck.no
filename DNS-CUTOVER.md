# DNS cutover: Wix → Cloudflare Pages

This is the domain-specific cutover plan for `puck.no`, audited on 2026-08-11.
The domain is registered at Simply.com, but the internet currently gets DNS
from Wix (`ns6.wixdns.net` and `ns7.wixdns.net`).

## Important finding

Do **not** import `/Users/amundfylling/Downloads/puck.no.zone` directly into
Cloudflare. It is an inactive Simply zone, not the current authoritative Wix
zone. Importing it would:

- point `puck.no`, `www` and `*` to the old Simply IP `93.191.156.144`;
- replace the live `_dmarc` CNAME with a different TXT record;
- activate mail, DKIM, Brevo, Mailchimp, redirect and wildcard records that
  currently return no DNS answer.

The safe dashboard import is `puck.no.cloudflare-stage.txt`. It contains only
records confirmed on the live Wix nameserver and marks every A/CNAME as DNS
only. The staged web records continue to serve Wix, so moving nameservers and
moving the website are two separate, reversible operations.

## What is live today

| Purpose | Current authoritative records |
| --- | --- |
| Website | three Wix A records at `@`; `www` → `cdn1.wixdns.net` |
| Incoming mail | MX priority 0 → `puck-no.mail.protection.outlook.com` |
| Microsoft verification | `MS=ms38023782` |
| Outgoing-mail SPF | `v=spf1 include:spf.protection.outlook.com -all` |
| DMARC | `_dmarc` → `_dmarc.wixemails.com` (currently resolves to `p=none`) |
| Wix DKIM | `s1._domainkey` and `s2._domainkey` CNAME records |
| Other sites | `jarligatabell` and `wiki` → `amundfylling.github.io` |
| DNSSEC | no DS record is currently published |

Do not “improve” or combine the SPF/DMARC records during launch. Any mail-policy
change should be a separate task after the migration is stable.

## 1. Complete before changing nameservers

### Publish and test the application

- [ ] Put all intended local changes through a pull request and merge them to
      `main`; wait for the production Pages deployment to finish.
- [ ] Confirm `https://puck-no.pages.dev/` returns the expected current site.
- [ ] Run the full acceptance test in `LAUNCH.md` section A9, including both
      languages, media, redirects, RSS and a mobile view.
- [ ] Apply all pending D1 migrations, confirm existing registrations are
      present, and test one registration end-to-end. Remove the test row.
- [ ] Confirm `/api/health` returns HTTP 200.
- [ ] In a private window, confirm `/admin/` and `/api/admin/*` both show
      Cloudflare Access rather than exposing the admin portal or CSV.
- [ ] Confirm the current production deployment can be rolled back in the
      Pages dashboard.

### Prepare every hostname-dependent service

- [ ] Turnstile: add `www.puck.no` and `puck.no` to the widget hostnames while
      retaining `puck-no.pages.dev` during migration.
- [ ] `sveltia-cms-auth`: set `ALLOWED_DOMAINS` to
      `puck-no.pages.dev,www.puck.no,puck.no`.
- [ ] GitHub OAuth app: set Homepage URL to `https://www.puck.no`; leave the
      Worker callback URL unchanged.
- [ ] Cloudflare Access: prepare coverage for both `/admin/*` and
      `/api/admin/*` on `www.puck.no` and `puck.no`. If Cloudflare requires the
      zone to be Active first, do this immediately after step 3 below, while
      the staged DNS records still serve Wix.
- [ ] Keep the existing Pages environment variables/secrets and D1 binding.
      Retry the production deployment after changing build-time variables.

### Stage Cloudflare DNS without changing any live service

1. Cloudflare dashboard → **Onboard a domain** → `puck.no` → Free plan.
2. DNS → **Records** → **Import and Export** → import
   `puck.no.cloudflare-stage.txt`. Cloudflare's macOS file picker only enables
   the `.txt` version; the `.zone` copy contains the same records.
3. Leave **Proxy imported DNS records** off. The file also explicitly marks
   all A/CNAME records DNS only.
4. Confirm the Cloudflare zone contains exactly these twelve staged records:
   three A, six CNAME, one MX and two TXT records. Cloudflare's own NS/SOA do
   not count.
5. Confirm MX, both root TXT records, `_dmarc`, both `_domainkey` records,
   `jarligatabell` and `wiki` exactly match the file. Do not add the wildcard
   or dormant Simply records.
6. Copy Cloudflare's two assigned nameservers. Do not guess them.
7. Note the rollback nameservers: `ns6.wixdns.net` and `ns7.wixdns.net`.

## 2. Change authoritative nameservers only

The current public DS lookup is empty. Check again immediately before the
change. If Simply shows DNSSEC enabled or a DS record exists, disable/remove it
before changing nameservers; a stale DS can make the whole domain unreachable.

At Simply.com:

1. Control Panel → select `puck.no` → **DNS** → **Sæt navneservere**.
2. Remove the Wix nameservers and enter only the two nameservers assigned by
   Cloudflare.
3. Save and wait until Cloudflare marks the zone **Active**. Resolver caches
   can retain the old nameservers for up to 24 hours.

At this point the site should still be Wix because the staged Cloudflare A and
CNAME records intentionally reproduce Wix. Email and the GitHub subdomains
should also be unchanged.

Verify from a terminal:

```bash
dig +short NS puck.no @1.1.1.1
dig +short MX puck.no @1.1.1.1
dig +short TXT puck.no @1.1.1.1
dig +short CNAME _dmarc.puck.no @1.1.1.1
dig +short CNAME s1._domainkey.puck.no @1.1.1.1
dig +short CNAME s2._domainkey.puck.no @1.1.1.1
dig +short CNAME jarligatabell.puck.no @1.1.1.1
dig +short CNAME wiki.puck.no @1.1.1.1
```

Also send an external test message to `amund.fylling@puck.no`, reply to it,
and verify both directions before touching the web records.

## 3. Cut only the website over to Pages

Do this after Cloudflare is Active, mail has passed the test, and Access covers
the custom hostnames.

1. Workers & Pages → `puck-no` → **Custom domains** → add `www.puck.no`.
   Allow the wizard to replace only the old `www` Wix CNAME.
2. Add `puck.no`. Allow the wizard to replace only the three old root Wix A
   records. Do not delete or edit MX, TXT, `_dmarc`, `jarligatabell` or `wiki`.
3. Wait for both custom domains and their certificates to show Active.
4. SSL/TLS → Overview → use **Full (strict)**.
5. Rules → Redirect Rules → create one 301 redirect from the exact hostname
   `puck.no` to `https://www.puck.no`, preserving path and query string.
6. Confirm there is no opposite `www` → apex rule, which would create a loop.

## 4. Verify after the website cutover

- [ ] `https://www.puck.no/` is the Pages site and has a valid certificate.
- [ ] `https://puck.no/test?check=1` redirects once to the same path/query on
      `www`.
- [ ] `/services-1` redirects to `/spill-bordhockey/`.
- [ ] `/api/health` returns 200.
- [ ] Registration and the public participant list work.
- [ ] `/admin/` and `/api/admin/*` are still Access-protected on `www`.
- [ ] CMS login works on `www`.
- [ ] Incoming and outgoing email still pass.
- [ ] `jarligatabell.puck.no` and `wiki.puck.no` still work.
- [ ] Submit `https://www.puck.no/sitemap-index.xml` in Search Console.

After the zone is stable, enable Cloudflare DNSSEC and add the new Cloudflare
DS record at Simply. Never reuse a Wix or Simply DS record.

## Rollback

For a website-only rollback, leave Cloudflare nameservers and all mail records
alone. Restore these DNS-only web records in Cloudflare:

```dns
puck.no.      3600 IN A     185.230.63.107
puck.no.      3600 IN A     185.230.63.171
puck.no.      3600 IN A     185.230.63.186
www.puck.no.  3600 IN CNAME cdn1.wixdns.net.
```

Only if Cloudflare DNS itself is the problem should the nameservers at Simply
be restored to `ns6.wixdns.net` and `ns7.wixdns.net`.
