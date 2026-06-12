# __NAME__

A Bun fullstack app on the blueshed stack — [@blueshed/delta](https://github.com/blueshed/delta) realtime sync, [@blueshed/railroad](https://github.com/blueshed/railroad) signals + JSX, [invoket](https://github.com/blueshed/invoket) tasks. Scaffolded by `create-blueshed`, wired for agent sessions (SessionStart hook → skills sync + project memory).

```sh
bun install
bun dev          # http://localhost:3000
invt check       # typecheck + tests
invt -l          # all tasks
```

Open two browser windows — the board syncs live between them. That's delta: three op verbs over one WebSocket, no fetch, no REST.
