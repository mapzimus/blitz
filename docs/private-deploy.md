# Private copy on Cloudflare (only you, from any browser)

The public GitHub Page ships code only. This recipe makes a second, private deployment of the
same repo on Cloudflare Pages, with your disc archive in a private R2 bucket next to it and
Cloudflare Access (Zero Trust) demanding your login before anything is served. Visiting it
loads the game with no file picking: the page finds `/pack/BASSETS.ZIP` on its own origin.

Everything below is free-tier. Order matters: the login gate goes up before the archive does,
so the archive is never reachable without a login, not even for a minute.

## 1. Log in and create the (still empty) bucket

```bash
npx wrangler login
```

```bash
npx wrangler r2 bucket create backroom-pack
```

## 2. Create the project and deploy the code only

Deploys the committed tree exported by `git archive`, never the working folder, so no local
files, logs or extracted data can ride along.

```bash
npx wrangler pages project create backroom --production-branch main
```

```bash
node tools/deploy-private.mjs
```

You get `https://backroom.pages.dev`. It holds code only at this point.

## 3. Lock it to you with Cloudflare Access (dashboard, about 3 minutes)

1. Cloudflare dashboard, Zero Trust (one.dash.cloudflare.com). Pick the free plan if asked.
2. Access, Applications, Add an application, type Self-hosted.
3. Application domain: `backroom.pages.dev`, and add `*.backroom.pages.dev` as a second domain
   so preview deployments are covered too. Session duration: 1 month is fine.
4. Policy: name `me`, action Allow, include rule "Emails" = your email address. Nothing else.
5. Identity providers: the default One-time PIN works (Cloudflare emails you a code).
6. Save. Then the check that matters: open the URL in a private window. You must be asked to
   log in before the hub appears. Do not continue until that is true.

## 4. Upload the archive (one time)

Only now, with the gate up:

```bash
npx wrangler r2 object put backroom-pack/BASSETS.ZIP --file "<your extracted DATA folder>\BASSETS.ZIP"
```

`wrangler.toml` binds the bucket as `PACK` for `functions/pack/[[path]].js`. If the dashboard
asks for the binding: variable name `PACK`, bucket `backroom-pack`.

Reload the site: the title screen should say the disc data is on, from "this site".

## 5. Updating later

Every later code change: `node tools/deploy-private.mjs`. The archive never changes.

## Phone

Open the same URL on the phone, log in once (Access remembers the session), and the game
loads from the site. On-screen controls appear automatically on touch devices; a Bluetooth
controller also works in Chrome on Android.

## SUNDIAL door (the other game)

Same bucket, same gate. Its archives are flat keys under `sundial/` and the page finds them on
its own origin at `/pack/sundial/<name>` (HEAD on `gun.pak` at boot), then keeps each one in the
browser after the first fetch. Upload after step 3 is confirmed:

```bash
powershell -File tools/sundial/upload-r2.ps1 -Disc "<folder you copied the disc to>"
```

That puts `gun.pak`, `sounds.pak`, `anim.pak`, `fe_anim.pak`, `l_103.pak` (UI text), every
`l_NN_ar.pak` and `l_NN_st.pak`, and the `MUSIC1` tracks (`NNNN.mib`) under `sundial/`, about
1.1 GB. Add `-Chr` to include `chr.pak` for the viewer page. Keys are lowercase.
