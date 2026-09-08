# Changesets

This directory is used by [changesets](https://github.com/changesets/changesets) to manage versioning and changelogs for the SDK packages.

## Adding a changeset

When you make a change to a published SDK or agent integration package:

```bash
npx @changesets/cli add
```

Select the packages that changed, choose the bump type (patch/minor/major), and write a summary.

## How releases work

Changesets versioning and registry publication are separate from CI and application
deployment. After a successful push-to-main CI run, `release-sdks.yml` opens or
updates the **Version Packages** PR for nonempty changesets. It does not publish.
Review and merge that PR so the versioned commit gets its own CI and deployment.
If GitHub shows **Approve workflows to run** on the automated PR, approve those
runs before waiting for required CI checks.

Once production serves the tested commit, run **Release npm SDKs** from the Actions
tab on `main`, providing its full 40-character SHA. The workflow checks that the
checkout matches, the commit belongs to main, its push CI passed, and a successful Deploy artifact records that exact resolved
release plus all five service deployment IDs. It rebuilds the packages and checks
their npm tarballs in a clean consumer. Immediately before publishing it verifies
live API readiness and runs the selected commit's production smoke checks with
`SMOKE_EXPECTED_RELEASE` set to that SHA.

Nonempty changesets block publication until their version PR is merged. Empty
notes do not require another version bump; the publishing job removes those notes
only in its temporary checkout so Changesets can publish already-versioned,
unpublished packages. Changesets still handles registry publication, tags and
GitHub release entries. The workflow's `NPM_TOKEN` must permit all public Counted
packages; the secret's presence alone does not establish that its access is valid.

Publication shares the coordinated deployment lock, so production cannot move
between the live check and upload through the deploy workflow. A registry failure
fails only the npm release workflow and does not prevent application deployment.

The release artifact is named `counted-production-release` and expires after
90 days. Missing, expired, mismatched or incomplete artifacts block publication.
The workflow reads the artifact's resolved release rather than guessing from a
Deploy run's workflow ref. Production smoke also requires `SMOKE_CLIENT_KEY`,
`SMOKE_SERVICE_KEY` and `SMOKE_PROJECT_ID` for the same dedicated synthetic project;
missing credentials or any failed journey prevent publication. These checks emit
a synthetic event and verify that exact run is queryable.

After a successful publish, verify an actual registry install against the public
API; local tarball checks do not prove what a new customer installs.
