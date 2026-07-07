# Release

Forge follows the same two-step release model as FScript.

1. Push a version tag.
2. GitHub Actions creates a draft release with an unsigned macOS arm64 app ZIP.
3. Publish the draft release.
4. GitHub Actions signs and notarizes the app, uploads the signed ZIP, and removes the unsigned ZIP.
5. Stable releases update `MagnusOpera/homebrew-tap` with the signed Forge cask.

## Version Tags

Both `0.1.0` and `v0.1.0` style tags are supported.

The recommended local release preparation command is:

```sh
make release-prepare version=0.1.0
```

It moves the `## [Unreleased]` notes into `## [0.1.0]`, commits `CHANGELOG.md`, and creates an annotated tag.

To preview the changelog/tag operation without writing files:

```sh
make release-prepare version=0.1.0 dryrun=true
```

```sh
git push origin main --follow-tags
```

Each release tag must have a matching `## [x.y.z]` section in `CHANGELOG.md`.

## Required Secrets

Configure these repository secrets before publishing a release:

- `MAC_CERT_BASE64`: base64-encoded Developer ID Application `.p12` certificate.
- `MAC_CERT_PASSWORD`: password for the `.p12` certificate.
- `MAC_DEV_TEAM_ID`: Apple Developer Team ID.
- `MAC_DEV_LOGIN`: Apple ID used for notarization.
- `MAC_DEV_PASSWORD`: app-specific password for Apple notarization.
- `PAT_HOMEBREW_TAP`: token with write access to `MagnusOpera/homebrew-tap`.

The app is only signed after the GitHub release is published.
