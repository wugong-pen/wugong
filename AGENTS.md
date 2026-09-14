# Website release rules

## Current owner instruction — 2026-09-14

The owner now wants one evolving website, with its paid custom domain connected when the remaining features are ready. Do not create separate feature versions or require a test-to-production review for every requested feature. Continue the latest complete code and the existing connected deployment; historical staging/Worker/database names currently identify that deployment and are not permission to enable live payments or delete old data. Apply the requested administrator security change to this website. The older rules below describe the previous release model and do not override this instruction.

- Develop and commit website updates on the staging branch. The user authorizes routine commits and pushes of completed, checked changes to staging.
- main is the production branch. Do not merge into main, push changes to main, or deploy production until the user explicitly approves the exact tested revision.
- Deploy staging first and provide the user with the test URL and a description of changes. Record the tested commit SHA. Any later change requires another staging deployment and review.
- Promote the same approved commit to production without unrelated changes. Never force push shared branches.
- Test and production must use separate Cloudflare Workers and separate D1 databases. Never point staging at production order data or use real payment credentials in staging.
- Verify deployment success; a successful Git push alone does not prove a deployment succeeded.
- The intended Worker names are wugong (production) and wugong-test (staging). Existing production is not yet verified: preserve the live mellowisle Worker until its replacement is confirmed.
- Cloudflare branch connections and isolated test database still need to be configured and verified. Do not report them as complete based on these rules alone.
