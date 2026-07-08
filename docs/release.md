# Release Publishing

CReader macOS `.dmg` bundles are **not** committed to git. Build locally, stage under `releases/<version>/`, then publish assets to [GitHub Releases](https://github.com/lima1217/creader/releases).

## Build

1. Bump `version` in `package.json` and `src-tauri/tauri.conf.json`, then commit.
2. Tag the release commit: `git tag vX.Y.Z`.
3. Run the full check gate: `npm run check`.
4. Build the app bundle:

```bash
npm run tauri build
```

Tauri writes `.dmg` files to `src-tauri/target/release/bundle/dmg/`. Copy them into a local staging folder (gitignored):

```bash
VERSION=1.2.0
mkdir -p "releases/v${VERSION}"
cp src-tauri/target/release/bundle/dmg/*.dmg "releases/v${VERSION}/"
```

Build both architectures on their respective machines when shipping universal coverage (`aarch64` on Apple Silicon, `x64` on Intel).

## Publish to GitHub Releases

Push the tag, then create the release and upload staged assets:

```bash
git push origin vX.Y.Z
gh release create vX.Y.Z \
  "releases/vX.Y.Z/"*.dmg \
  --title "CReader X.Y.Z" \
  --generate-notes
```

If the tag already exists remotely, omit re-tagging and run only `gh release create` with `--verify-tag`.

Use `gh release upload vX.Y.Z releases/vX.Y.Z/*.dmg` to add or replace assets on an existing release.

## Local `releases/` directory

`releases/<version>/` is a **local staging area** only. `.gitignore` excludes `releases/**/*.dmg` so build output is never tracked. Keep a short `releases/README.md` in git as a pointer; do not commit binaries.

## Historical git bloat

Older commits still contain `.dmg` blobs in git history. Cleaning that history requires `git filter-repo` and a force-push — tracked separately; do not run as part of ordinary releases.
