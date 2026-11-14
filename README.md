# Central Hills SC Management App

## Run on your server

Requirements: Node.js 22.9 or later. No npm dependencies are required.

1. Configure the variables in your server's environment. For local development, use a private `.env` file based on `.env.example`; do not commit it.
2. Set `ADMIN_PIN` to the chosen private PIN of at least 8 characters before the first start. Configure the requested value directly in the server environment or an uncommitted `.env` file. Do not commit the real `.env` file or put the PIN in frontend code.
3. Run `npm start` and place the server behind HTTPS for production.
4. Open the address served by the Node.js app. Do not open `index.html` directly or host it on GitHub Pages; the browser app needs the same-origin API provided by this server.

On first start, the PIN is salted and hashed into `data/admin-auth.json`. Subsequent PIN changes are also stored as a hash, so `ADMIN_PIN` is only used to initialize a new data directory. Club records are stored in `data/club-data.json`. Keep the `data` directory on persistent, backed-up storage; it is excluded from Git.

Administrator sessions use an HttpOnly, SameSite cookie and expire after eight hours. Failed PIN attempts are rate-limited. All data changes and PIN updates are checked by the server; changing browser storage or calling the API without an authenticated session does not grant edit access. The server also rejects any nested `admin_pin` fields in uploaded records and strips them from legacy browser data before saving. Use HTTPS in production so session cookies and PIN submissions are encrypted in transit.

The app preserves records already stored in this browser when the server database is empty. On the first successful admin sign-in, that browser's data is initialized on the server. Other browsers will then use the server's shared records.

## Included modules

Dashboard, player registration and editing, uniform catalogue and orders, payment recording, membership fees, attendance, matches, equipment, announcements, CSV exports, printing, and administrator backup/restore.

## Data and privacy

Records are shared by all clients of this server. The current app still allows read-only visitors to view club records, as the original prototype did. Hosting the app publicly therefore makes those records readable; restrict network access or add authenticated read access before storing information that should not be public.

Back up the `data` directory regularly. The application does not currently provide database replication, audit logs, or automatic off-site backups.

## Tests

Run `npm test` to execute the server authentication and API tests.
