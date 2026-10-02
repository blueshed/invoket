# create-blueshed

Start a Bun website from [paintbrush](https://github.com/blueshed/paintbrush): routes and resources, [railroad](https://github.com/blueshed/railroad) for the page, Railway for the deploy, and a resource that can evolve from an HTTP route to a WebSocket and a [delta](https://github.com/blueshed/delta) document.

```sh
bunx create-blueshed my-app
# or: bun create blueshed my-app
cd my-app
bun dev
```

Needs Bun 1.4 or later.

This package is only the way in. It runs `bun create blueshed/paintbrush` with the arguments you give it, so the template, its tests and its documentation are in the [paintbrush](https://github.com/blueshed/paintbrush) repository, and `bun create blueshed/paintbrush my-app` does the same thing directly.

## From 0.3.0

Earlier versions scaffolded a delta and railroad app with invoket tasks and project memory. 0.3.0 replaces that with paintbrush. If you want the old scaffold, use `create-blueshed@0.2.0`.
