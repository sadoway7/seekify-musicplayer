# Unraid Community Apps — Seekify

Files for the [Community Apps](https://ca.unraid.net) submission.

- `../ca_profile.xml` — repository profile (must live at repo root; required by the submission scanner).
- `templates/seekify.xml` — Docker template for the Seekify container.
- `../LICENSE` — MIT (required at repo root for submission).
- `../icon.png` — app icon, reused by the template via raw GitHub URL.

## Image

Built and published by `.github/workflows/docker-publish.yml` on every push to `main`:

    ghcr.io/sadoway7/seekify:latest

First push creates the package on GitHub under `sadoway7`. After the first build,
go to https://github.com/sadoway7?tab=packages and set the `seekify` package to
**Public** (it defaults to private).

## Submit

1. Push these files + trigger the action (push to `main`).
2. Confirm the image is public on GHCR.
3. Create a support thread at https://forums.unraid.net/ and uncomment the
   `<Forum>`/`<Support>` lines in `ca_profile.xml` and `templates/seekify.xml`.
4. Go to https://ca.unraid.net/submit/new, point it at this repository
   (`sadoway7/seekify-musicplayer`, branch `main`).
5. Run **Validate**, then **Scan**. Fix anything flagged. Submit for review.
