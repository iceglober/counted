# Changesets

This directory is used by [changesets](https://github.com/changesets/changesets) to manage versioning and changelogs for the SDK packages.

## Adding a changeset

When you make a change to `@counted/sdk`, `@counted/react`, or `@counted/migrate`:

```bash
npx @changesets/cli add
```

Select the packages that changed, choose the bump type (patch/minor/major), and write a summary.

## How releases work

1. Changesets accumulate in `.changeset/` as you merge PRs
2. CI opens a "Version Packages" PR that bumps versions and updates changelogs
3. Merging that PR triggers npm publish
