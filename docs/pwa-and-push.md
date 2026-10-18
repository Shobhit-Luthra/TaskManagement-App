# Kanbo as an installable app, with push notifications

Kanbo is a Progressive Web App (PWA): it installs from the browser to the home screen or desktop,
opens in its own window, shows an offline page when there is no network, and can send push
notifications when it is closed. No app store is involved.

## How it works

| Piece | Where |
| --- | --- |
| Web app manifest (name, colours, icons, shortcuts) | `src/app/manifest.ts` |
| Icons, generated as PNG (192, 512, maskable 512) | `src/app/pwa-icon/[size]/route.tsx` |
| Service worker (offline page, push, notification click) | `public/sw.js` |
| Registers the worker (production only) | `src/components/pwa/register-service-worker.tsx` |
| "Turn on for this device" switch | `src/components/pwa/push-toggle.tsx`, shown on `/account` |
| Subscribe / unsubscribe API | `src/app/api/v1/push/subscription/route.ts` |
| Sending pushes | `src/lib/push/flush.ts`, run by the `push-flush` cron job |
| Tables and schedule | `supabase/migrations/202610190002_push_subscriptions.sql` |

Security choices:

- The service worker never caches API responses or signed-in pages. It only serves `/offline`
  when a navigation fails.
- The server only sends to the real browser push services (Google, Mozilla, Apple, Windows). A
  subscription with any other host is rejected, so the endpoint cannot be used to make the server
  call arbitrary URLs.
- A device that signs in as a different user moves to that user; it never receives both users'
  pushes.
- Pushes use the existing notification pipeline, so recipients, membership checks and "do not
  notify the actor" rules are the same as email and the in-app bell.

## Setup (one time per environment)

1. **VAPID keys.** Already generated into `.env.local` for local use. For Vercel, generate a
   separate pair and set all three as environment variables (Production and Preview):
   ```
   npx web-push generate-vapid-keys
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key>
   VAPID_PRIVATE_KEY=<private key>
   VAPID_SUBJECT=mailto:you@your-domain
   ```
   Without them the app works normally and the switch says push is not set up.
2. **Database.** Apply `202610190002_push_subscriptions.sql`. It adds `push_subscriptions`,
   `notifications.push_sent_at`, and a `push-flush` pg_cron job (every minute).
3. **Cron secrets.** `push-flush` reuses the `cron_site_url` and `cron_secret` vault secrets that
   `notification-flush` already needs, and the `CRON_SECRET` env var. If email digests work, push
   will too.
4. **Deploy**, open the site on your phone, sign in, go to **Account**, and tap
   **Turn on for this device**.

## Installing

- **Android (Chrome):** menu, then **Install app** (or the install banner).
- **iPhone (Safari, iOS 16.4+):** Share, then **Add to Home Screen**. Push only works for the
  installed home-screen app on iOS, not in a normal Safari tab.
- **Desktop (Chrome/Edge):** the install icon in the address bar.

## Putting it in the app stores later

The PWA can be wrapped without rewriting it: **Android** with Trusted Web Activity
(Bubblewrap or PWABuilder, produces an `.aab` for Google Play, one-time $25 account);
**iOS** with Capacitor, which needs a Mac, Xcode and an Apple Developer account ($99/year) and
ships the same site inside a native shell. Do this only if you need store listings; the PWA
already installs and sends push.

## Not done / limits

- Push is on or off per device. There is no per-category setting (assignments, mentions, etc.);
  the in-app notification preferences still control email only.
- Notifications are sent within about a minute (the cron interval), not instantly.
- The offline page is a placeholder; boards are not usable offline.
