# Changesets

Every change that people who install Hero would notice gets a changeset: run `pnpm changeset`,
pick the bump (`patch`, `minor`, or `major` once we reach 1.0), and describe the change in a
sentence a user can understand. All published packages share one version, so one changeset moves
them together. The release workflow turns the pending changesets into a version pull request.
