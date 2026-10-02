#!/usr/bin/env bun
/**
 * create-blueshed: `bunx create-blueshed my-app`, or `bun create blueshed my-app`, makes a
 * paintbrush app: routes and resources, railroad for the page, Railway for the deploy.
 *
 * The template is github.com/blueshed/paintbrush. Bun fetches it and runs its setup, so there
 * is one template and nothing here to keep in step with it. Arguments go straight to
 * `bun create`: the destination, and its flags (--force, --no-install, --no-git, --open).
 */
const proc = Bun.spawn([process.execPath, "create", "blueshed/paintbrush", ...process.argv.slice(2)], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await proc.exited);
