# Database guide

smarTindahan stores everything in MongoDB through Mongoose. Production uses MongoDB Atlas.

## Requirements

- **A replica set.** Checkout, restock and stock adjustments use multi-document transactions. Atlas clusters (including the free tier) are replica sets. A plain `mongod` is not; use `npm run dev:memory --prefix backend` locally instead.
- **A database name in the connection string**, e.g. `mongodb+srv://USER:PASSWORD@cluster.mongodb.net/smartindahan?retryWrites=true&w=majority`. Without a name MongoDB uses the database called `test`. If your existing data is in `test`, keep the string as is until you migrate it deliberately.

## Atlas setup checklist

1. **Database user** – Atlas → Database Access → add a user with *readWrite* on your database only (not Atlas admin).
2. **Network access** – Atlas → Network Access.
   - Local development: add your current public IP. Home IPs change; a "server selection timed out" error that appears after it worked yesterday is almost always this.
   - Vercel: serverless functions have no fixed outbound IPs on the standard plans, so Atlas can only be reached by allowing `0.0.0.0/0`, or by using Vercel's static-IP/Secure Compute (paid), or Atlas Private Link/Vercel–Atlas integration. `0.0.0.0/0` makes the database reachable from anywhere, so it is only acceptable when the database user has a strong unique password and least-privilege role. **This is a security decision for you to make; the code does not change it.**
3. **Cluster running** – free clusters pause after inactivity; resume it in Atlas.
4. **Connection string** – Atlas → Connect → Drivers. URL-encode special characters in the password (`@` → `%40`, `:` → `%3A`, `/` → `%2F`).
5. **Create indexes (once per environment).** In production Mongoose does not build indexes at startup (`autoIndex` is off so cold starts stay fast). Run with `backend/.env` pointing at that database:

   ```bash
   npm run create-indexes --prefix backend
   ```

   Required indexes include unique barcodes per store, unique supplier names per store, unique user emails, and the partial unique index on `{storeId, idempotencyKey}` that makes checkout safe to retry. Re-run it after any model's indexes change; it is safe to repeat.

## How the API connects

- Long-running server (`npm run dev` / `npm start`): connects before listening and exits with a clear message if it cannot.
- Vercel function: connects lazily on the first `/api` request and re-uses the connection while the instance is warm. If the database is unreachable, API routes answer `503` with a generic JSON message; the real reason (auth failed, DNS/SRV refused, IP not allowed, timeout) is written to the function log **without the connection string or password**.
- `GET /api/health` returns `200 {"status":"ok","database":"connected"}` or `503 {"status":"degraded","database":"<state>"}`. Use it for deployment checks.

## Diagnosing connection errors

| Log message | Meaning | Fix |
| --- | --- | --- |
| `Authentication failed` | Wrong user/password or user lacks access to the database. | Re-check the Atlas user; URL-encode the password. |
| `querySrv ECONNREFUSED` / `ENOTFOUND` | DNS SRV lookup (`mongodb+srv://`) blocked or failing on that network. | Try another network/DNS, or use the standard `mongodb://` string. |
| `Server selection timed out` / "IP that isn't whitelisted" | TCP reaches Atlas but the handshake is dropped. | Add the caller's IP in Network Access; check the cluster is not paused. |
| `ECONNREFUSED 127.0.0.1:27017` | Using a local URI without a running local MongoDB. | Start MongoDB, or use `dev:memory`. |
| `Invalid connection string` | Malformed `MONGODB_URI`. | Check scheme, encoded password, no stray quotes or spaces. |

## Data notes

- Money is stored as numbers rounded to centavos; sale lines freeze `unitPrice` and `costPrice` at the time of sale so later price edits never rewrite history.
- "Today", "this week" and "this month" on the dashboard and reports are computed in Philippine time (UTC+8), not server time.
- Deleting a product archives it (`status: archived`); sales history keeps referencing it.
- Passwords are stored as bcrypt hashes. OTP codes are stored hashed with an expiry.

## Safe testing

Never run the test suite against production. Tests use an in-memory replica set and touch no external database. Legacy tenant-isolation tests that need a real database only run when `MONGODB_TEST_URI` is set — point that at a throw-away database, never at live data.
