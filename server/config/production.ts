import { type HelmetOptions } from 'helmet';
import { type CorsOptions } from 'cors';

const isProduction = process.env.NODE_ENV === 'production';
const domain = process.env.CUSTOM_DOMAIN || 'lumiereportal.app';

// Security headers configuration
// Production CSP is strict; development CSP allows inline scripts for Vite
const productionCSP = {
  defaultSrc: ["'self'"],
  scriptSrc: [
    "'self'",
    "'unsafe-inline'", // Required for Tailwind config in landing page
    "https://js.stripe.com",
    "https://cdn.tailwindcss.com",
  ],
  styleSrc: [
    "'self'",
    "'unsafe-inline'", // Required for Tailwind generated styles
    "https://fonts.googleapis.com",
  ],
  imgSrc: [
    "'self'",
    "data:",
    "blob:",
    "https:",
  ],
  fontSrc: [
    "'self'",
    "https://fonts.gstatic.com",
  ],
  connectSrc: [
    "'self'",
    ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []),
    "https://api.stripe.com",
  ],
  frameSrc: [
    "'self'",
    "https://js.stripe.com",
    "https://hooks.stripe.com",
  ],
  objectSrc: ["'none'"],
  upgradeInsecureRequests: [],
};

const developmentCSP = {
  defaultSrc: ["'self'"],
  scriptSrc: [
    "'self'",
    "'unsafe-inline'", // Required for Vite HMR
    "'unsafe-eval'",   // Required for Vite HMR
    "https://js.stripe.com",
    "https://cdn.tailwindcss.com",
  ],
  styleSrc: [
    "'self'",
    "'unsafe-inline'", // Required for style injection
    "https://fonts.googleapis.com",
  ],
  imgSrc: [
    "'self'",
    "data:",
    "blob:",
    "https:",
  ],
  fontSrc: [
    "'self'",
    "https://fonts.gstatic.com",
  ],
  connectSrc: [
    "'self'",
    "wss:", // WebSockets for HMR
    ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []),
    "https://api.stripe.com",
  ],
  frameSrc: [
    "'self'",
    "https://js.stripe.com",
    "https://hooks.stripe.com",
  ],
  objectSrc: ["'none'"],
};

export const helmetConfig: HelmetOptions = {
  contentSecurityPolicy: {
    directives: isProduction ? productionCSP : developmentCSP,
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
};

// CORS configuration
export const corsConfig: CorsOptions = {
  origin: isProduction
    ? [
        `https://${domain}`,
        `https://www.${domain}`,
        /\.lumiere\.college$/, // Allow all subdomains
      ]
    : ['http://localhost:5000', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'stripe-signature',
  ],
  maxAge: 86400, // 24 hours
};

// Rate limiting configuration (S34 / S33-02).
//
// Middleware order for /api (see server/index.ts and server/middleware/auth.ts):
//   1. webhooks (no limiter)
//   2. ipCeiling      - ONE general limiter, keyed by client IP, runs before identity is known. It is a flood
//                       ceiling sized for an office/school behind one NAT, not a fairness limit.
//   3. route-level auth limiters: login (strict, failures only), refresh (own bucket), signup, resets
//   4. requireAuth verifies the bearer token, sets req.user, then runs the per-user limiters
//      (user: every authenticated request; adminUser: additionally /api/admin/*), keyed by the verified user id.
// Identity for (4) comes only from requireAuth (verified Supabase token / dev-test local JWT), never from a header.
//
// Sizing evidence (S33): the acceptance runner spends ~14 /api requests per page view; Admin Diagnostics polls
// every 60 s (15 per 15 min per open tab); the support desk polls too. A busy staff member stays well under 600.
export const rateLimitConfig = {
  // Pre-auth per-IP flood ceiling: ~3 staff + students behind one NAT, plus unauthenticated traffic.
  ipCeiling: {
    windowMs: 15 * 60 * 1000,
    max: 1500,
    message: 'Too many requests from this network, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  },
  // Per authenticated user, all /api traffic.
  user: {
    windowMs: 15 * 60 * 1000,
    max: 600,
  },
  // Per authenticated user, /api/admin/* only (counted in addition to `user`).
  adminUser: {
    windowMs: 15 * 60 * 1000,
    max: 300,
  },
  // Login brute-force protection: per IP, failed attempts only (successful sign-ins are not counted).
  login: {
    windowMs: 15 * 60 * 1000,
    max: 10,
  },
  // Session renewal: its own bucket so renewals never consume the login budget. Per IP.
  refresh: {
    windowMs: 15 * 60 * 1000,
    max: 60,
  },
  // Legacy strict bucket (5 / 15 min); no longer mounted on login or refresh.
  auth: {
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many authentication attempts, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  },
  // Webhook endpoints (no rate limit - Stripe handles this)
  webhook: {
    windowMs: 60 * 1000, // 1 minute
    max: 1000, // Very high limit for webhooks
  },
};

// Session configuration - HARDENED FOR PRODUCTION
export const sessionConfig = {
  name: 'lumiere.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiration on every request (sliding session)
  cookie: {
    secure: isProduction, // HTTPS only in production
    httpOnly: true, // Prevents JavaScript access to cookies (XSS protection)
    sameSite: 'strict' as const, // CSRF protection - changed from 'lax' to 'strict'
    maxAge: 12 * 60 * 60 * 1000, // 12 hours (reduced from 24 for better security)
    domain: isProduction ? `.${domain}` : undefined,
    path: '/',
  },
  proxy: true, // Trust proxy (required for Replit/CloudFlare)
};

// Session timeout warning (client-side should warn at 11.5 hours)
export const SESSION_TIMEOUT_MS = sessionConfig.cookie.maxAge as number;
export const SESSION_WARNING_MS = SESSION_TIMEOUT_MS - (30 * 60 * 1000); // 30 min before expiry

// Compression configuration
export const compressionConfig = {
  level: 6, // Compression level (0-9)
  threshold: 1024, // Minimum size to compress (1KB)
  filter: (req: any, res: any) => {
    // Don't compress if client doesn't accept encoding
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Use compression filter
    return true;
  },
};
