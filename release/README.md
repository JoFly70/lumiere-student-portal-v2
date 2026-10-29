# Controlled production release marker

`S26_RELEASE_SHA` names the ONE commit the production release runner may deploy
(`S26_RELEASE_MARKER=1`, see `scripts/s26/release-loop.sh`). Ordinary pushes to the branch are
ignored by the runner; only a deliberate change of this file moves production to another commit.
Writing `STOP` makes the runner exit. The runner still requires successful provisioning before a
build is marked ready, and the live site must report the same SHA in `/health` before acceptance runs.
