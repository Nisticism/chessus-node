# The daily puzzle in Discord

Two separate things, which can be set up in either order and neither of which
needs the other:

| | What it is | What it needs |
|---|---|---|
| **The daily post** | A message in a channel each morning with the board and a Play button | A channel webhook URL. No bot, no application, nothing running. |
| **The activity** | The puzzle, playable inside Discord | A Discord application with Activities enabled. |

The post is ten minutes of work and takes effect immediately. The activity is
the part people actually play in, and it has a verification gate (see the end of
this document), so start with the post.

---

## Part 1 — the daily channel post

This uses a **channel webhook**: a URL Discord gives you from the channel's own
settings. Anything that can make an HTTP request can post to that channel. There
is no bot account, no token to rotate, and no process to keep alive.

### 1. Create the webhook

1. In Discord, right-click the channel you want the puzzle in → **Edit Channel**.
2. **Integrations** → **Webhooks** → **New Webhook**.
3. Name it `GridGrove` and give it the site's avatar.
4. **Copy Webhook URL**.

That URL is a secret. Anyone holding it can post to the channel as this webhook,
so it goes in the server's environment and nowhere else.

### 2. Configure the server

Add to your `.env`:

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/…
SITE_URL=https://gridgrove.gg
```

`SITE_URL` is probably already set — the rest of the repo uses it. The post
script reads the puzzle from it and puts it in the links, and both can be
overridden per-run (see the next step), so setting this does not commit you to
posting anything.

### 3. Test it without deploying anything

**You do not need to deploy to test this.** The script runs on your laptop and
POSTs to Discord; Discord does not care where the request came from. The board
travels *with* the message as an upload rather than as a link, so your server
never has to be reachable from the internet.

Three steps, each one safer than the next:

```bash
# 1. Print the exact message. Posts nothing, needs no webhook.
node scripts/discord-daily-post.js --dry-run --site http://localhost:3001

# 2. See the board it would upload.
node scripts/discord-daily-post.js --dry-run --site http://localhost:3001 --save board.png

# 3. Post for real, to a throwaway channel in your own test server.
node scripts/discord-daily-post.js --site http://localhost:3001 --webhook https://discord.com/api/webhooks/…
```

`--webhook` beats `DISCORD_WEBHOOK_URL`, so step 3 cannot post to the real
channel by accident. Make a webhook in a private channel nobody else is in, run
it as many times as you like, delete the messages, and only put the real
webhook in `.env` once you are happy.

Three flags worth knowing:

| Flag | What it changes |
|---|---|
| `--site` | Where the puzzle and board are **read from**. Point it at localhost. |
| `--public-url` | What goes in the **links**. Defaults to `SITE_URL`, so a local test still posts links that work. |
| `--date` | Post a specific day, for checking a board of a different shape. |

**If there is no puzzle scheduled**, the script says so and posts nothing. If the
board cannot be drawn, it posts without the image rather than failing. Neither
is an error, and neither should become a daily failure alert.

### 4. Schedule it — in your own timezone

Run it on the **backend** instance — the one with PM2 on it, where you run
`deploy-backend.sh`. Not the frontend one.

Two reasons, and the first is the one that will bite you:

1. **The webhook URL is a secret, and the backend already holds secrets.** The
   repo-root `.env` lives there — `ecosystem.config.js` reads it to give PM2 its
   environment. The frontend instance's `.env` is `chessus-frontend/.env`, and it
   holds `REACT_APP_*` build variables, which are *baked into a public JavaScript
   bundle*. Putting `DISCORD_WEBHOOK_URL` anywhere near that file risks
   publishing it. Keep it on the backend where the other secrets already are.
2. **The backend can read the puzzle over localhost**, with no DNS, no TLS and no
   public round-trip — and it is the machine that would be down if the API were
   down, so a post that fails is a post that had nothing to announce anyway.

**This replaces nothing.** It is a new unit that sits alongside nginx and PM2 and
touches neither. Nothing about your existing deploy changes, and neither
`deploy.sh` nor `deploy-backend.sh` needs editing.

The puzzle rotation is keyed to **UTC dates** — that is what makes everybody in
every timezone get the same puzzle on the same day. The *posting time* is a
separate decision and can be whatever hour suits your players.

#### Amazon Linux 2023 has no cron

`crontab: command not found` is expected. AL2023 deliberately ships without
cron and points you at systemd timers instead. Two ways forward.

**Option A — a systemd timer (what AWS recommends).** No packages to install,
the timezone goes in the schedule itself, and `journalctl` keeps the output.
Every command below is run on the **backend** instance, over SSH.

**1. Find where node actually is.** A systemd unit does not read your shell
profile, so the path in the unit has to be literal. If you installed node with
nvm it will not be `/usr/bin/node`.

```bash
command -v node
```

**2. Check the webhook is configured.** This prints the variable name only, never
the value, so it is safe to run with someone watching:

```bash
cd /home/ec2-user/chessus-node && grep -o '^DISCORD_WEBHOOK_URL' .env
```

If that prints nothing, add the line to `.env` before going further.

**3. Run it by hand once.** Nothing is scheduled yet — this is just proving the
command works before wrapping it in a unit:

```bash
cd /home/ec2-user/chessus-node && DISCORD_POST_SITE_URL=http://localhost:3001 node scripts/discord-daily-post.js
```

You should see `[discord] Posted "…" for YYYY-MM-DD.` and the message should
appear in your channel. **Do not continue until this works** — everything after
this point only controls *when* this exact command runs.

**4. Write the service unit.** `$(command -v node)` is substituted as you run
this, so the path from step 1 is baked in automatically:

```bash
sudo tee /etc/systemd/system/gridgrove-puzzle-post.service > /dev/null <<EOF
[Unit]
Description=Post the GridGrove daily puzzle to Discord
After=network-online.target

[Service]
Type=oneshot
User=ec2-user
WorkingDirectory=/home/ec2-user/chessus-node
Environment=DISCORD_POST_SITE_URL=http://localhost:3001
Environment=SITE_URL=https://gridgrove.gg
ExecStart=$(command -v node) scripts/discord-daily-post.js
EOF
```

`DISCORD_WEBHOOK_URL` is deliberately absent — the script reads `.env` itself,
and unit files are world-readable.

**5. Write the timer unit.** Change `09:00:00` to whatever hour you want, and
the zone to `America/Chicago`, `America/Denver` or `America/Los_Angeles` if you
are not Eastern:

```bash
sudo tee /etc/systemd/system/gridgrove-puzzle-post.timer > /dev/null <<'EOF'
[Unit]
Description=Post the GridGrove daily puzzle every morning

[Timer]
OnCalendar=*-*-* 09:00:00 America/New_York
Persistent=true

[Install]
WantedBy=timers.target
EOF
```

`Persistent=true` means that if the box was rebooting at 9am, it posts as soon
as it is back rather than skipping the day.

**6. Check the schedule parses.** This prints the next three times it would fire,
so you can see the timezone was understood before committing to it:

```bash
systemd-analyze calendar '*-*-* 09:00:00 America/New_York' --iterations=3
```

**7. Turn it on.**

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gridgrove-puzzle-post.timer
```

**8. Confirm it is scheduled.** `NEXT` should read tomorrow morning (or today, if
it is still before 9am):

```bash
systemctl list-timers gridgrove-puzzle-post.timer
```

**9. Fire it once through systemd**, to prove the unit works and not just the
command:

```bash
sudo systemctl start gridgrove-puzzle-post.service
journalctl -u gridgrove-puzzle-post.service -n 20 --no-pager
```

That posts immediately. If it works here it will work at 9am.

### Changing or removing it later

```bash
sudo systemctl edit --full gridgrove-puzzle-post.timer   # change the time
sudo systemctl daemon-reload && sudo systemctl restart gridgrove-puzzle-post.timer
sudo systemctl disable --now gridgrove-puzzle-post.timer # stop posting
```

**Option B — install cron.** If you would rather use a crontab, do steps 1–3
above first, then:

```bash
sudo dnf install -y cronie
sudo systemctl enable --now crond
crontab -e
```

Paste this into the editor that opens (`CRON_TZ` must be the first line):

```
CRON_TZ=America/New_York
0 9 * * * cd /home/ec2-user/chessus-node && DISCORD_POST_SITE_URL=http://localhost:3001 /usr/bin/node scripts/discord-daily-post.js >> /home/ec2-user/gridgrove-discord.log 2>&1
```

Either way it is 9am Eastern year-round — 13:00 UTC in summer, 14:00 in winter —
with nothing to change twice a year.

**The one boundary to know about.** A US morning or afternoon is the same UTC day
as itself, so the post announces the day it is. But US evening is already
tomorrow in UTC:

Midnight UTC is 7pm Eastern in winter and 8pm in summer, so:

| Post time (Eastern) | Which puzzle |
|---|---|
| Midnight – 6pm | today's ✅ |
| 7pm – 8pm | depends on daylight saving ⚠️ |
| 9pm and later | **tomorrow's** ⚠️ |

Pick anything up to 6pm and there is nothing to think about. If you specifically
want a late post, use `--date` to pin it to the day you mean rather than letting
"now" decide.

To check the schedule took:

```bash
crontab -l
grep discord-daily-post /var/log/cron
```

---

## Part 2 — the activity

This is what Wordle is on Discord, and it is not a bot. It is a web page —
`/discord` on this site — that Discord loads in an iframe inside its own client.
Because it is a real page, it is a real board you drag pieces on.

### 1. Create the application

1. <https://discord.com/developers/applications> → **New Application**.
2. Name it `GridGrove`, give it an icon and a description (both appear in the
   activity shelf).
3. **OAuth2** → copy the **Client ID** and **Client Secret**.

### 2. Turn on Activities and map the URL

1. **Activities** → **Settings** → enable **Activities**.
2. **Activities** → **URL Mappings**. Add one mapping:

   | Prefix | Target |
   |---|---|
   | `/` | `gridgrove.gg` |

   Everything the activity loads — the page, `/api`, `/uploads` — is then served
   through Discord's proxy from your own domain. Discord sandboxes activities
   behind that proxy so the page never sees a player's IP, which is why an
   unmapped external host silently fails to load rather than erroring.

3. There is **no "Activity URL" field**, and you are not missing it. An activity
   is always loaded at the **root** of the proxied domain, so the root mapping
   above *is* the activity URL — `https://<app id>.discordsays.com/` serves
   `https://gridgrove.gg/`.

   The site handles this itself. Discord always adds `frame_id` to the query
   string when it loads an activity, so when that parameter is present the root
   serves the puzzle instead of the home page ([App.js](chessus-frontend/src/App.js)).
   `/discord` still works for opening it directly, which is how you test it in a
   browser.

### 3. Choose which platforms it appears on

**Settings** → **Supported Platforms**: web, iOS, Android. An activity is
invisible on any platform you have not ticked, so this is worth getting right
rather than leaving at the default.

**Tick all three now.** While the app is unverified only you and your testers
can see it, so ticking mobile costs nothing and is the only way to try it on a
phone. The board is built on pointer events with `touch-action: none`, so
dragging a piece should work on touch — but "should" is the operative word until
you have held it in your hand.

**Before you submit for verification**, actually open it on a phone. A mobile
frame is much shorter than a desktop one, and a 12×12 board in it is the case
most likely to look wrong. If it does, untick mobile for the verified app and
fix it later — a verified activity that is broken on a platform you claimed is
worse than one that never offered that platform.

### 4. Configure the server

`.env` on the server:

```
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
DISCORD_APP_ID=…          # same as the client id; used by the daily post's button
```

`chessus-frontend/.env` (or your build environment):

```
REACT_APP_DISCORD_CLIENT_ID=…
```

The **client secret never goes in the frontend**. The activity gets an OAuth
code from Discord and posts it to `/api/discord/token`, and the server does the
exchange. That endpoint is the only thing that touches the secret.

### 5. Run the migrations

Restarting the API applies them. They add:

- `discord_players` — streaks and totals for a player with no GridGrove account
- `puzzle_attempts.source` — `web` or `discord`, on every attempt from now on
- `puzzle_attempts.discord_user_id` — who played it, when they came from Discord

Existing rows all become `source = 'web'`, which is what they were.

### 6. Check the iframe is allowed

Discord embeds the page, so whatever serves the frontend must not send
`X-Frame-Options: DENY` or a `frame-ancestors` CSP that excludes Discord. Either
one makes the activity load as a blank frame with **no error message**, which is
why it is worth ruling out first rather than debugging it later.

`configs/nginx-site.conf` sets neither today, so this should already be fine.
Confirm against the live site:

```bash
curl -sI https://gridgrove.gg | grep -i "x-frame-options\|content-security-policy"
```

No output means nothing is blocking the embed. If something appears, allow:

```
https://discord.com
https://*.discordsays.com
```

### 7. Test it locally

Discord needs a public HTTPS URL, so point a tunnel at your dev server:

```bash
cloudflared tunnel --url http://localhost:3000
```

Put the tunnel's hostname in the URL mapping while you work, then **reset the
mapping when you are done** — if you stop owning that hostname, someone else can
claim it and serve their own page as your activity.

In Discord, join a voice channel in your test server and pick GridGrove from the
activity shelf.

---

## How people find it

You do not build the "**[Username] was playing**" message with the board preview
and the Play button. **Discord generates that itself** when somebody launches an
activity in a channel — it is the activity invite embed, and you get it free.
That is exactly the Wordle behaviour, and it is the reason to do the activity
rather than a bot: a bot cannot produce that message at all.

So there are two paths to the puzzle, and they complement each other:

- **The daily post** (Part 1) reminds the channel there is a new puzzle. This is
  the part Wordle does *not* do — its players have to remember on their own.
- **The invite embed** spreads it socially when somebody plays.

## The verification gate — read this before promising anyone access

An **unverified** activity can only be launched:

- in servers with **fewer than 25 members**, and
- by your developer team plus up to 50 explicitly-invited **App Testers**.

That is enough to build and test it, and not enough to launch it. To open it to
everyone you submit the application for **verification**, which also unlocks
discovery in the activity shelf.

Practically: keep two applications — an unverified one you develop against, and
a verified one that is live. Discord recommends exactly this split.

**The daily post has no such gate.** A webhook works in any server, at any size,
today. That is the other reason to do Part 1 first.

## What is stored, and what it is allowed to do

A Discord id identifies a **person across days**. It never authenticates
anything.

- It is only ever written after Discord itself confirmed the token belongs to
  that id — the client sends a token, never a user id (`server/discord-auth.js`).
- It can reach daily-puzzle progress and nothing else. It cannot sign anyone in,
  stand in for a GridGrove account, change an account, or spend an allowance.
- Playing without signing in works completely. Nothing is stored, and no consent
  is needed, because there is nothing to consent to.
- A player who has both gets both: the attempt rates their GridGrove account and
  continues their Discord streak.

Streaks move on the **daily** puzzle only. Solving six old puzzles in an
afternoon is worth doing and is recorded, but it is not a streak.
