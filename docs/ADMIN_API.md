# Admin API contract

Everything under `/api/admin` requires the `bbs_admin` cookie (httpOnly, set by
`POST /api/admin/login`). Bodies are JSON. Errors: `{ "error": "message" }` with
400/401/404.

## Auth
- `POST /api/admin/login` `{user, password}` → `{ok:true, user}` + Set-Cookie `bbs_admin`
- `POST /api/admin/logout` → `{ok:true}`
- `GET  /api/admin/me` → `{user}` or 401
- `POST /api/admin/password` `{current, next}` → `{ok:true}`

## Overview
- `GET /api/admin/overview` →
```json
{ "bbs": {"name":"...","sysop":"...","software":"..."},
  "nodes": [{"node":1,"handle":"...","activity":"...","kind":"web","minutes":4}],
  "stats": {"users":12,"calls":930,"posts":44,"files":7,"doors":6,"uptimeSec":3600},
  "pages": [{"id":"page_1","handle":"x","node":2,"msg":"help","when":169...}],
  "log": [{"when":169...,"msg":"installed ..."}] }
```

## Users  (record fields: id, handle, name, level, calls, posts, credits, timeBank, city, state, email, banned, notes, lastCall)
- `GET /api/admin/users?q=` → `{users:[...]}`
- `PATCH /api/admin/users/:id` body = any subset → `{user}`
- `POST /api/admin/users/:id/password` `{password}` → `{ok:true}`
- `DELETE /api/admin/users/:id` → `{ok:true}` (never the sysop)

## Boards & messages (record: id, name, desc, level, order)
- `GET /api/admin/boards` → `{boards:[{...,messages:12}]}`
- `POST /api/admin/boards` `{name, desc, level}` → `{board}`
- `PATCH /api/admin/boards/:id`, `DELETE /api/admin/boards/:id`
- `GET /api/admin/messages?boardId=` → `{messages:[...]}` (latest 200)
- `PATCH /api/admin/messages/:id` `{subject, body, to}`, `DELETE /api/admin/messages/:id`

## File areas & files (area: id, name, desc, level | file: id, areaId, name, desc, size, date, path, downloads)
- `GET /api/admin/fileareas` → `{areas:[{...,files:3}]}`
- `POST /api/admin/fileareas` `{name, desc, level}`, `PATCH`, `DELETE`
- `GET /api/admin/files?areaId=` → `{files:[...]}`
- `POST /api/admin/files` `{areaId, name, desc, contentBase64}` → `{file}` (stores under `files/<areaId>/`)
- `DELETE /api/admin/files/:id`

## Doors
- `GET /api/admin/doors` → `{doors:[manifest...], installDir:"doors/install", log:[...]}`
- `POST /api/admin/doors/scan` → `{installed:[manifest...], doors:[...]}`
- `POST /api/admin/doors/upload` `{filename, zipBase64}` → `{installed:manifest}` (writes zip then installs)
- `PATCH /api/admin/doors/:id` `{name, description, category, enabled, minLevel, exec, dropType, cmd, args, art}` → `{door}`
- `DELETE /api/admin/doors/:id` → `{ok:true}` (deletes the door folder, not built-ins)

## ANSI art
- `GET /api/admin/art` → `{art:[{name,size,mtime}], dir:"art"}`
- `GET /api/admin/art/:name/preview` → `text/plain; charset=utf-8` rendered text (decoded to unicode)
- `POST /api/admin/art/upload` `{name, contentBase64}` → `{art}` (name must end .ans/.asc/.txt)
- `DELETE /api/admin/art/:name` → `{ok:true}`
- `POST /api/admin/art/assign` `{slot, name}` where slot ∈ welcomeArt, mainArt, loginArt, goodbyeArt, newUserArt

## Chat bots (record: id, handle, name, persona, style, active, level, chatter〔0-100〕, topics[])
- `GET /api/admin/bots`, `POST /api/admin/bots`, `PATCH /api/admin/bots/:id`, `DELETE /api/admin/bots/:id`

## Config
- `GET /api/admin/config` → `{config}` (secrets redacted: admin.passwordHash/salt removed)
- `PUT /api/admin/config` body `{patch}` (dotted keys allowed, e.g. `{"bbs.name":"X"}`) → `{config}`

## Bulletins (id, title, body, date)
- `GET /api/admin/bulletins`, `POST`, `PATCH /api/admin/bulletins/:id`, `DELETE /api/admin/bulletins/:id`

## Sysop pages
- `POST /api/admin/pages/:id/handled` → `{ok:true}`

## Live view
- Poll `GET /api/admin/overview` every 4s for the node table.

## Public (no auth, used by the landing page)
- `GET /api/status` → `{name, tagline, sysop, location, online, maxNodes, callers:[{handle,when,location}], stats:{users,calls,posts,files}}`
- `GET /api/chat/recent?limit=20` → `{messages:[{from,text,when}]}`
