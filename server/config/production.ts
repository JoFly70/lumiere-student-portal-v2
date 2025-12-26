import { type HelmetOptions } from 'helmet';
import { type CorsOptions } from 'cors';

const isProduction = process.env.NODE_ENV === 'production';
const domain = process.env.CUSTOM_DOMAIN || 'lumiereportal.app';

const productionCSP = {
  defaultSrc: ["'self'"],
  scriptSrc: [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    "https://js.stripe.com",
    "https://cdn.tailwindcss.com",
    "https://www.chatbase.co",
    "https://cdn.jsdelivr.net",
    "https://unpkg.com",
  ],
  styleSrc: [
    "'self'",
    "'unsafe-inline'",
    "https://fonts.googleapis.com",
    "https://cdn.tailwindcss.com",
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
    "data:",
  ],
  connectSrc: [
    "'self'",
    "https://*.supabase.co",
    ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []),
    "https://api.stripe.com",
    "https://www.chatbase.co",
  ],
  frameSrc: [
    "'self'",
    "https://js.stripe.com",
    "https://hooks.stripe.com",
    "https://www.chatbase.co",
  ],
  objectSrc: ["'none'"],
  upgradeInsecureRequests: [],
};

const developmentCSP = {
  defaultSrc: ["'self'"],
  scriptSrc: [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    "https://js.stripe.com",
    "https://cdn.tailwindcss.com",
    "https://www.chatbase.co",
    "https://cdn.jsdelivr.net",
    "https://unpkg.com",
  ],
  styleSrc: [
    "'self'",
    "'unsafe-inline'",
    "https://fonts.googleapis.com",
    "https://cdn.tailwindcss.com",
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
    "data:",
  ],
  connectSrc: [
    "'self'",
    "wss:",
    "https://*.supabase.co",
    ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []),
    "https://api.stripe.com",
    "https://www.chatbase.co",
  ],
  frameSrc: [
    "'self'",
    "https://js.stripe.com",
    "https://hooks.stripe.com",
    "https://www.chatbase.co",
  ],
  objectSrc: ["'none'"],
};

export const helmetConfig: HelmetOptions = {
  contentSecurityPolicy: {
    directives: isProduction ? productionCSP : developmentCSP,
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
};

export const corsConfig: CorsOptions = {
  origin: isProduction
    ? [
        `https://${domain}`,
        `https://www.${domain}`,
        /\.lumiere\.college$/,
        /\.up\.railway\.app$/,
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
  maxAge: 86400,
};

export const rateLimitConfig = {
  api: {
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  },
  admin: {
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: 'Too many admin requests, please try again later',
  },
  auth: {
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: 'Too many authentication attempts, please try again later',
  },
  webhook: {
    windowMs: 60 * 1000,
    max: 1000,
  },
};

export const sessionConfig = {
  name: 'lumiere.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    sameSite: 'strict' as const,
    maxAge: 12 * 60 * 60 * 1000,
    domain: isProduction ? `.${domain}` : undefined,
    path: '/',
  },
  proxy: true,
};

export const SESSION_TIMEOUT_MS = sessionConfig.cookie.maxAge as number;
export const SESSION_WARNING_MS = SESSION_TIMEOUT_MS - (30 * 60 * 1000);

export const compressionConfig = {
  level: 6,
  threshold: 1024,
  filter: (req: any, res: any) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return true;
  },
};
