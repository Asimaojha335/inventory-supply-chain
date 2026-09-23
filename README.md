# StockFlow: multi-warehouse inventory and supply chain

An inventory system for businesses that hold stock in more than one place: track quantities per warehouse, move stock between locations, order from suppliers and get told when to reorder.

**Stack:** React 19 + Vite, Node.js serverless functions on Vercel, MongoDB Atlas, JWT sessions in HttpOnly cookies, bcrypt.

## Features
- **Dashboard** with inventory value, units on hand, a 14-day in/out chart, value by warehouse and low-stock alerts
- **Products and SKUs** with categories, cost, price, reorder point and a preferred supplier
- **Stock per warehouse**: receive, ship, transfer between warehouses and adjust after a count
- **Movement ledger**: every change is recorded with who did it and why, filterable by type
- **Purchase orders**: draft, send, receive in full or in part, cancel. Receiving updates stock and the **weighted-average cost**
- **Reorder suggestions**: products at or below their reorder point (counting stock already on order) are grouped by supplier into draft purchase orders in one click
- **Sample data** button so a new account has something to explore

## Correctness notes
- Stock can never go negative. Shipping and transferring use a conditional update (`qty >= n`), so two people shipping the last units at the same time cannot both succeed. The tests fire 10 simultaneous shipments at 45 units and check that exactly 4 succeed.
- A transfer removes stock from the source first and puts it back if the destination update fails.
- Every record belongs to one account (`ownerId`); other accounts get a 404 for anything they do not own.
- Products and warehouses that still hold stock cannot be deleted.

## API
One serverless function (`api/index.js`, reached through a `vercel.json` rewrite) routes every request, because the free Vercel plan limits a deployment to 12 functions.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/signup`, `/auth/login`, `/auth/logout`, `GET /auth/me` |
| Catalogue | `GET/POST /products`, `PATCH/DELETE /products/:id`, same shape for `/warehouses` and `/suppliers` |
| Stock | `POST /stock/receive`, `/stock/ship`, `/stock/transfer`, `/stock/adjust`, `GET /movements` |
| Purchasing | `GET/POST /purchase-orders`, `POST /purchase-orders/:id/order`, `/receive`, `/cancel`, `GET /reorder-suggestions`, `POST /purchase-orders/from-suggestions` |
| Insights | `GET /dashboard`, `POST /demo/seed` |

## Run it locally
```bash
npm install
npm run build
```
The API needs a `MONGODB_URI` environment variable and Vercel's function runtime, so run `vercel dev` (or deploy to Vercel and add `MONGODB_URI`). Data goes to the `inventory_supply_chain` database.

This is a public demo database: please do not enter real business or personal data.
