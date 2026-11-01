# Private copy on Cloudflare (only you, from any browser)

The public GitHub Page ships code only. This recipe makes a second, private deployment of the
same repo on Cloudflare Pages, with your disc archive in a private R2 bucket next to it and
Cloudflare Access (Zero Trust) demanding your login before anything is served. Visiting it
loads the game with no file picking: the page finds `/pack/BASSETS.ZIP` on its own origin.

Everything below is free-tier. You need the Cloudflare account login once in a terminal.

## 1. Log in and create the bucket (one time, about 2 minutes)

```bash
npx wrangler login
```

```bash
npx wrangler r2 bucket create backroom-pack
```

## 2. Upload the archive (one time, about 5 minutes on a normal upload link)

```bash
npx wrangler r2 object put backroom-pack/BASSETS.ZIP --file "C:\Users\mhowe\Downloads\NFL Blitz 2002 (USA)\extract\DATA\BASSETS.ZIP"
```

## 3. Deploy the site

```bash
npx wrangler pages project create backroom --production-branch main
```

```bash
npx wrangler pages deploy . --project-name backroom
```

`wrangler.toml` already binds the bucket as `PACK` for `functions/pack/[[path]].js`. If the
dashboard asks, the binding is: variable name `PACK`, bucket `backroom-pack`.

You get a URL like `https://backroom.pages.dev`. Do not share it yet; step 4 locks it.

## 4. Lock it to you with Cloudflare Access (dashboard, about 3 minutes)

1. Cloudflare dashboard, Zero Trust (one.dash.cloudflare.com). Pick the free plan if asked.
2. Access, Applications, Add an application, type Self-hosted.
3. Application domain: `backroom.pages.dev` (and `*.backroom.pages.dev` as a second entry
   so preview deployments are covered too). Session duration: 1 month is fine.
4. Policy: name `me`, action Allow, include rule "Emails" = your email address. Nothing else.
5. Identity providers: the default One-time PIN works (Cloudflare emails you a code). Google
   login can be added later if you want a password-manager flow.
6. Save. Open the URL in a private window: you must be asked to log in before the hub appears.

That is the "username and password" layer. Access sits in front of every path, including
`/pack/BASSETS.ZIP`, so the archive cannot be fetched by anyone who is not logged in as you.

## 5. Updating

Every later code change: `npx wrangler pages deploy . --project-name backroom`.
The archive never changes, so step 2 is never repeated.

## Phone

Open the same URL on the phone, log in once (Access remembers the session), and the game
loads from the site. On-screen controls appear automatically on touch devices; a Bluetooth
controller also works in Chrome on Android.
