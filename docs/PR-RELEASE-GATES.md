# Implementation PR — merge and release gates

This branch is an implementation review, **not a 175/175 completion or production release**. Do not enable auto-merge. Keep the PR draft until review gates have been addressed.

## Required before merge

- [ ] Latest PR commit has successful GitHub **CI / frontend**, **CI / workers**, and **CI / backend** jobs (use the check names shown by GitHub when selecting required checks).
- [ ] An independent reviewer approves the current diff, including history reconciliation, authentication cutover, migrations, secret handling, authorization boundaries and retirement of old login/deployment paths.
- [ ] All review conversations are resolved; stale approvals are dismissed after new changes.
- [ ] No real secrets, runtime databases, browser artifacts or build output are committed.
- [ ] The maintainer accepts the explicitly scoped implementation and unfinished ledger; it is not represented as a finished 175-feature release.

The app connection can create/push the PR but **GitHub denied branch-protection API access (403)**. A repository administrator must configure enforcement in **Settings → Rules → Rulesets** (or **Branches → Add branch protection rule**) for `main`:

1. Require a pull request before merging, with at least **one approval** from someone other than the author.
2. Dismiss stale approvals when new commits are pushed; require the latest reviewable push to be approved if supported.
3. Require all three CI checks above and require the branch to be up to date.
4. Require conversation resolution. Block force pushes and branch deletion.
5. Apply to administrators / minimize bypass permissions as appropriate. If direct rules editing is unavailable, obtain the repository owner's assistance rather than claiming the checks are required.

A draft PR blocks normal merging until marked ready, but it does not replace branch protection. A single maintainer cannot supply an independent approval for their own PR; invite another qualified reviewer.

## Additional gates before production

- [ ] Configure Google OAuth privately and verify real consent/sign-out/account isolation on the actual HTTPS app origin.
- [ ] Back up existing D1 data and approve the Google-only cutover. Existing unlinked email accounts need an operator-reviewed identity migration; no automatic email linking is allowed.
- [ ] Test live authorized connectors, real devices, deployment infrastructure and remaining security/privacy controls.
- [ ] Resolve or explicitly risk-review development dependency findings and independent application-security findings.
- [ ] Replace the historical static-export deployment with a reviewed server-capable frontend release process. The supplied manual workflow builds artifacts only and never deploys.
- [ ] Keep the remaining requirements in `IMPLEMENTATION-STATUS.md` open. SSO/SAML login is superseded by the owner's Google-only authentication instruction; enterprise administration, broader workflows, billing/entitlements and other unfinished software are not completed by this PR.
