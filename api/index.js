// Vercel serverless entry point. It serves the compiled Express app (built by `npm run build`),
// which connects to MongoDB lazily and reuses that connection across invocations.
// vercel.json rewrites /api/* here; Express receives the original URL and routes it.
import { app } from '../backend/dist/server.js'

export default app
