# Notification implementation status

The notification increment adds a header bell, realtime notification inserts,
preferences endpoints, signed unsubscribe links, a scheduled queue flush, and a
due-soon scan. Weekly digests, account settings, and an external email provider
are still pending. The current email provider logs messages instead of delivering
them.

Pre-merge review fixed HTML escaping in notification emails, limited sent-status
updates to the notification IDs included in the email, and made queue/read errors
visible. Regression tests cover these changes. The due-soon integration fixture
uses tomorrow's UTC date so its deadline is consistently within the next 24 hours.

Database verification on 2026-09-19: 40 integration tests passed and 18 failed.
The configured test database lacks newer tables and RPCs, including notifications,
notification preferences, comments, labels, restore_task, and due_soon_scan. The
linked database migration history also contains remote-only versions and lacks
matching versions for many local migrations. These results do not verify the new
SQL or establish that the application can run against that database.

Before deployment, reconcile the remote migration history against the actual
schema, apply the required migrations to the intended environment, and rerun the
database integration suite. Do not blindly push migrations or repair history.
The cron migration also requires operator-provided Vault values for
cron_site_url and cron_secret. No database migrations were applied during this
local Git integration.
