# FocusKey Backend

The backend service behind the FocusKey mobile app, built to help users stay focused, reduce distractions, and build better digital habits. It manages everything from authentication and NFC key pairing to focus sessions, notifications, and real-time communication.

---

## Overview

FocusKey Backend is built with Node.js, Express, TypeScript, and MongoDB. It serves as the central API for the mobile application, handling all core business logic and data management.

The system allows users to create an account, connect NFC-based physical focus keys to their devices, start and manage focus sessions, schedule breaks, and keep track of their productivity over time. It sends push notifications using Firebase Cloud Messaging and processes emails and SMS OTPs through background jobs powered by BullMQ.

To provide a smoother user experience, real-time updates—such as device pairing changes, focus session events, and notifications—are delivered through Socket.IO.

---

## Design Reference

The backend APIs in this project were developed based on the approved UI/UX design.

| Resource     | Link                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| Figma Design | [Click Here](https://www.figma.com/design/XBvJRsyd2gCGEaJPIXlV3r/Focus-Key?node-id=0-1&p=f&t=ITA62L1HEX5cMaMA-0) |

> The UI/UX design was provided by the project team and is referenced here to help understand the API flow and business requirements.

---

## Features

- **Email & Google Authentication** — credential login with OTP-based email verification, Google Sign-In via Firebase ID token
- **JWT Access & Refresh Tokens** — stateless authentication with configurable expiry
- **Role-Based Access Control** — `SUPER_ADMIN`, `ADMIN`, `USER` roles enforced at the middleware layer
- **NFC Device Pairing** — register physical NFC keys by UID/serial number, pair/unpair them to user accounts with atomic MongoDB transactions
- **Focus Modes** — create and activate customizable app-blocking modes; three defaults provisioned on first login
- **Focus Sessions** — start, pause, and complete timed focus sessions with per-mode history and analytics
- **Scheduled Breaks** — time-boxed break periods with automatic expiry enforced by a per-minute cron job
- **Friends & Social** — friend requests, friend lists, and user discovery
- **Push Notifications** — Firebase FCM delivery to individual or batched users, with in-app notification records
- **Transactional Email** — Nodemailer with Gmail SMTP; OTP, account creation, and password reset templates rendered via EJS
- **Analytics & Dashboard** — aggregated focus statistics for users and administrators
- **Admin Dashboard API** — user management, device management, support tickets, banners, FAQs
- **File Upload** — Multer-based local disk storage with MIME-type validation for images, videos, audio, and documents

---

## Tech Stack

| Category             | Technology                                        |
| -------------------- | ------------------------------------------------- |
| Runtime              | Node.js                                           |
| Language             | TypeScript 5.5                                    |
| Framework            | Express 4                                         |
| Database             | MongoDB (Atlas / self-hosted)                     |
| ODM                  | Mongoose 8                                        |
| Authentication       | JWT (`jsonwebtoken`) + Firebase Admin SDK         |
| Password Hashing     | bcrypt                                            |
| Validation           | Zod                                               |
| Cache / Queue Broker | Redis (ioredis)                                   |
| Job Queue            | BullMQ 5                                          |
| Queue Dashboard      | Bull Board (`@bull-board/express`)                |
| Real-time            | Socket.io 4                                       |
| Push Notifications   | Firebase Cloud Messaging (firebase-admin)         |
| Email                | Nodemailer (Gmail SMTP)                           |
| File Uploads         | Multer (local disk)                               |
| Template Engine      | EJS                                               |
| Logging              | Winston + `winston-daily-rotate-file` + Morgan    |
| HTTP Utilities       | `http-status-codes`, `cors`, `express-rate-limit` |
| Cryptography         | Node.js `crypto`, `crypto-js`                     |
| Formatter            | Prettier                                          |

---

## Project Structure

```
focusKey-backend/
├── src/
│   ├── server.ts               # Entry point — DB connect, Socket.io, cron init, graceful shutdown
│   ├── app.ts                  # Express app — middleware, routing, error handler registration
│   ├── app/
│   │   ├── modules/            # Feature modules (one folder per domain)
│   │   │   ├── auth/           # Login, registration, OTP verify, password reset, Google OAuth
│   │   │   ├── user/           # User profile, NFC pairing, device management, app sync
│   │   │   │   └── services/   # Command services (pairing, profile update, account operations)
│   │   │   ├── registeredDevice/  # Admin-managed NFC device registry
│   │   │   ├── focusSession/   # Focus session lifecycle and history
│   │   │   ├── modes/          # Focus mode CRUD and activation
│   │   │   ├── breaks/         # Break session lifecycle
│   │   │   ├── friends/        # Friend requests and social graph
│   │   │   ├── notification/   # In-app notification records
│   │   │   ├── fcmToken/       # FCM device token storage and management
│   │   │   ├── personalReminder/  # User-defined reminders
│   │   │   ├── analytics/      # Focus statistics and productivity analytics
│   │   │   ├── dashboard/      # Admin dashboard aggregations
│   │   │   ├── settings/       # App-level settings (appName, supportEmail)
│   │   │   ├── banner/         # Promotional banners (admin)
│   │   │   ├── faq/            # FAQ content management
│   │   │   ├── support/        # User support ticket submission
│   │   │   ├── rule/           # Platform rules/guidelines
│   │   │   └── resetToken/     # Password reset token storage
│   │   ├── middlewares/
│   │   │   ├── auth.ts                 # JWT auth + role guard
│   │   │   ├── optionalAuth.ts         # Auth that does not reject unauthenticated requests
│   │   │   ├── fileUploaderHandler.ts  # Multer configuration and MIME validation
│   │   │   ├── parseFileData.ts        # Normalises uploaded file paths for responses
│   │   │   ├── fileMapper.ts           # Maps raw Multer output to structured form
│   │   │   ├── globalErrorHandler.ts   # Centralised error handling with STRICT/SOFT modes
│   │   │   ├── rateLimiter.ts          # express-rate-limit configuration
│   │   │   └── validateRequest.ts      # Zod schema validation wrapper
│   │   ├── routes/
│   │   │   ├── index.ts        # v1 route registration
│   │   │   └── v2.ts           # v2 route registration (users)
│   │   ├── builder/
│   │   │   ├── queryBuilder.ts     # Chainable Mongoose query builder (search/filter/sort/paginate)
│   │   │   └── pushNotification.ts # FCM batch and single-user push notification helper
│   │   └── cronJobs/
│   │       └── breakCron.ts    # Per-minute cron to expire overdue breaks and emit socket events
│   ├── config/
│   │   ├── index.ts            # Centralised environment variable bindings
│   │   ├── bull.ts             # BullMQ Redis connection and default job options
│   │   ├── bullboard.ts        # Bull Board UI adapter setup
│   │   ├── firebase.ts         # Firebase Admin SDK initialisation
│   │   ├── cron.ts             # Cron enable flag
│   │   └── responseMode.ts     # STRICT/SOFT response mode reader
│   ├── queues/
│   │   ├── email/
│   │   │   ├── email.queue.ts      # BullMQ queue definition
│   │   │   └── email.worker.ts     # Worker that sends emails via Nodemailer
│   │   └── notification/
│   │       ├── notification.queue.ts   # BullMQ queue definition
│   │       └── notification.worker.ts  # Worker that dispatches FCM notifications
│   ├── DB/
│   │   ├── index.ts            # Super admin seed on startup
│   │   └── plugins/
│   │       └── softDeletePlugin.ts  # Reusable Mongoose soft-delete plugin
│   ├── shared/
│   │   ├── logger.ts           # Winston logger instances (info + error)
│   │   ├── morgan.ts           # Morgan HTTP logging streams
│   │   ├── emailTemplate.ts    # EJS-based transactional email templates
│   │   ├── redisClient.ts      # Redis client for direct cache operations
│   │   ├── sendResponse.ts     # Standardised JSON response helper
│   │   ├── catchAsync.ts       # Async error boundary wrapper
│   │   ├── checkValidID.ts     # MongoDB ObjectId validation utility
│   │   ├── getFilePath.ts      # Resolve upload file paths
│   │   └── unlinkFile.ts       # Delete uploaded files from disk
│   ├── helpers/
│   │   ├── jwtHelper.ts        # JWT sign and verify wrappers
│   │   ├── authHelper.ts       # Auth utility helpers
│   │   ├── emailHelper.ts      # Direct (non-queue) email send helper
│   │   ├── notificationsHelper.ts  # Unified notification dispatcher (FCM or Socket.io by type)
│   │   ├── socketHelper.ts     # Socket.io connection handler
│   │   ├── apiFeature.ts       # API feature utilities
│   │   └── generateCustomId.ts # Custom ID generation
│   ├── errors/
│   │   ├── ApiErrors.ts            # Custom ApiError class
│   │   ├── handleValidationError.ts # Mongoose ValidationError normaliser
│   │   └── handleZodError.ts       # Zod ZodError normaliser
│   ├── enums/
│   │   ├── user.ts             # USER_ROLES, STATUS, GENDER enums
│   │   └── files.ts            # File-related enums
│   ├── constants/
│   │   └── responseMode.ts     # RESPONSE_MODE enum (STRICT | SOFT)
│   ├── types/                  # Shared TypeScript interfaces and type declarations
│   └── util/
│       ├── cryptoToken.ts      # Secure random token generation
│       ├── encryptDecrypt.ts   # AES encryption/decryption utilities (crypto-js)
│       ├── generateOTP.ts      # Numeric OTP generator
│       ├── validEmail.ts       # Email format validation
│       └── verifyToken.ts      # Raw JWT verify utility
├── views/                      # EJS email templates
├── winston/                    # Log output directory (auto-created)
│   ├── success/                # Daily rotating success logs
│   └── error/                  # Daily rotating error logs
├── public/                     # Static assets
├── package.json
├── tsconfig.json
└── .env
```

---

## Installation

### Prerequisites

- **Node.js** >= 18
- **MongoDB** (Atlas cluster or local instance)
- **Redis** >= 6 (used by BullMQ and optional direct cache)
- **npm** >= 9

### Steps

**1. Clone the repository**

```bash
git clone <repository-url>
cd focusKey-backend
```

**2. Install dependencies**

```bash
npm install
```

**3. Create the environment file**

```bash
cp .env.example .env
```

Then populate all required values. See the [Environment Variables](#environment-variables) section below.

**4. Start a Redis instance**

```bash
# Example using Docker
docker run -d -p 6379:6379 redis:7
```

**5. Start the development server**

```bash
npm run dev
```

The server will connect to MongoDB, seed the super admin account if absent, register cron jobs, and begin listening on the configured port.

---

## Environment Variables

| Variable                 | Required | Description                                              |
| ------------------------ | -------- | -------------------------------------------------------- |
| `IP`                     | Yes      | IP address the server binds to (e.g. `0.0.0.0`)          |
| `PORT`                   | Yes      | Port the HTTP server listens on                          |
| `DATABASE_URL`           | Yes      | MongoDB connection string                                |
| `NODE_ENV`               | Yes      | Runtime environment (`development` or `production`)      |
| `BCRYPT_SALT_ROUNDS`     | Yes      | bcrypt hash rounds for password hashing                  |
| `RESPONSE_MODE`          | No       | Error response mode — `STRICT` (default) or `SOFT`       |
| `JWT_SECRET`             | Yes      | Secret key for signing access tokens                     |
| `JWT_EXPIRE_IN`          | Yes      | Access token expiry (e.g. `30d`)                         |
| `JWT_REFRESH_SECRET`     | Yes      | Secret key for signing refresh tokens                    |
| `JWT_REFRESH_EXPIRES_IN` | Yes      | Refresh token expiry                                     |
| `REDIS_HOST`             | Yes      | Redis server hostname                                    |
| `REDIS_PORT`             | Yes      | Redis server port                                        |
| `REDIS_PASSWORD`         | No       | Redis authentication password                            |
| `REDIS_DB`               | No       | Redis logical database index                             |
| `START_CRON`             | No       | Set to `true` to activate scheduled cron jobs            |
| `CLIENT_URL`             | Yes      | Frontend application URL (CORS / redirect use)           |
| `BASE_URL`               | Yes      | Public base URL of this API server                       |
| `DASHBOARD_URL`          | No       | Admin dashboard URL                                      |
| `FIREBASE_PROJECT_ID`    | Yes      | Firebase project identifier                              |
| `FIREBASE_CLIENT_EMAIL`  | Yes      | Firebase service account client email                    |
| `FIREBASE_PRIVATE_KEY`   | Yes      | Firebase service account private key (PEM)               |
| `EMAIL_FROM`             | Yes      | Sender address for transactional emails                  |
| `EMAIL_USER`             | Yes      | SMTP auth username                                       |
| `EMAIL_HOST`             | Yes      | SMTP server hostname                                     |
| `EMAIL_PASS`             | Yes      | SMTP auth password                                       |
| `EMAIL_PORT`             | Yes      | SMTP server port                                         |
| `SUPPORT_RECEIVER_EMAIL` | No       | Email address that receives support ticket notifications |
| `ADMIN_EMAIL`            | Yes      | Super admin seed account email                           |
| `ADMIN_PASSWORD`         | Yes      | Super admin seed account password                        |
| `GOOGLE_CLIENT_ID`       | No       | Google OAuth 2.0 client ID                               |
| `GOOGLE_CLIENT_SECRET`   | No       | Google OAuth 2.0 client secret                           |

---

## Available Scripts

| Script           | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `npm run dev`    | Start the development server with hot reload (`ts-node-dev`) |
| `npm run build`  | Compile TypeScript to JavaScript in `./dist`                 |
| `npm run start`  | Run the compiled production build (`node dist/server.js`)    |
| `npm run format` | Format all source files with Prettier                        |

---

## API Documentation

No Swagger/OpenAPI documentation was detected in the source.

The API is organised under the following base paths:

| Version | Base Path |
| ------- | --------- |
| v1      | `/api/v1` |
| v2      | `/api/v2` |

A Bull Board queue monitoring UI is available at:

```
GET /admin/queues
```

---

## Database

| Property     | Detail                                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database     | MongoDB                                                                                                                                                                             |
| ODM          | Mongoose 8                                                                                                                                                                          |
| Connection   | `mongoose.connect()` on server startup; process exits immediately if unreachable                                                                                                    |
| Atlas        | Supported via `DATABASE_URL` connection string                                                                                                                                      |
| Seeding      | `seedSuperAdmin()` runs on startup and creates the super admin user if absent                                                                                                       |
| Soft Delete  | A reusable `softDeletePlugin` is applied per-model; deleted documents are transparently excluded from all `find`, `findOne`, `countDocuments`, `update`, and `aggregate` operations |
| Transactions | MongoDB sessions are used for atomic operations (e.g. NFC device pairing/unpairing)                                                                                                 |

---

## Entity Relationship Diagram (ERD)

The project includes automatically generated Entity Relationship Diagrams (ERDs) mapping the Mongoose schemas and relationships across modules.

#### System-Wide ER Diagram

Below is the rendered project-wide database structure:

![System-Wide ER Diagram](./docs/erd/modules/whole-er-diagram/er-diagram.png)

You can access the generated diagrams under the `./docs/erd/modules/` directory:

- **System-Wide (All Modules Consolidated):**
  - 📸 [Diagram(.png)](./docs/erd/modules/whole-er-diagram/er-diagram.png)

#### Module-Specific Diagrams

For a focused view of each module, check the following directories:

- **User:** [PNG](./docs/erd/modules/user/er-diagram.png)
- **Banner:** [PNG](./docs/erd/modules/banner/er-diagram.png)
- **Breaks:** [PNG](./docs/erd/modules/breaks/er-diagram.png)
- **Chat:** [PNG](./docs/erd/modules/chat/er-diagram.png)
- **FAQ:** [PNG](./docs/erd/modules/faq/er-diagram.png)
- **FCM Token:** [PNG](./docs/erd/modules/fcmToken/er-diagram.png)
- **Focus Session:** [PNG](./docs/erd/modules/focusSession/er-diagram.png)
- **Friends:** [PNG](./docs/erd/modules/friends/er-diagram.png)
- **Message:** [PNG](./docs/erd/modules/message/er-diagram.png)
- **Modes:** [PNG](./docs/erd/modules/modes/er-diagram.png)
- **Notification:** [PNG](./docs/erd/modules/notification/er-diagram.png)
- **Personal Reminder:** [PNG](./docs/erd/modules/personalReminder/er-diagram.png)
- **Registered Device:** [PNG](./docs/erd/modules/registeredDevice/er-diagram.png)
- **ResetToken:** [PNG](./docs/erd/modules/resetToken/er-diagram.png)
- **Rule:** [PNG](./docs/erd/modules/rule/er-diagram.png)
- **Settings:** [PNG](./docs/erd/modules/settings/er-diagram.png)
- **Support:** [PNG](./docs/erd/modules/support/er-diagram.png)

---

## Authentication & Authorization

### Authentication

- **Email / Password** — users register with email and password; account activation requires OTP verification sent via email
- **Google Sign-In** — Firebase ID token is verified server-side using Firebase Admin SDK; account is created automatically on first login
- **OTP Flows** — 6-digit numeric OTPs with 3-minute expiry, delivered via the async email queue
- **Password Reset** — OTP verification generates a short-lived crypto reset token; the token authorises a password update

### Tokens

| Token         | Details                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------- |
| Access Token  | Signed JWT (`HS256`) containing `id`, `role`, `email`; expiry configured via `JWT_EXPIRE_IN` |
| Refresh Token | Separate JWT signed with `JWT_REFRESH_SECRET`; issues a new access token without re-login    |
| Reset Token   | Cryptographic random hex token stored in a `ResetToken` collection with 5-minute expiry      |

### Authorization

- The `auth` middleware validates the `Authorization: Bearer <token>` header, confirms the user exists and is `ACTIVE`, and enforces role membership
- Roles: `SUPER_ADMIN`, `ADMIN`, `USER`
- An `optionalAuth` middleware is available for routes that serve both authenticated and unauthenticated requests

---

## Modules

| Module            | API Path                     | Description                                                                  |
| ----------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| Auth              | `/api/v1/auth`               | Login, registration, OTP verify, password reset, Google login, refresh token |
| User              | `/api/v1/users`              | Profile management, NFC pairing, device sync, installed app list             |
| Registered Device | `/api/v1/devices`            | Admin-managed NFC hardware device registry                                   |
| Focus Session     | `/api/v1/focus-sessions`     | Start, pause, complete focus sessions; session history                       |
| Modes             | `/api/v1/modes`              | Create and manage app-blocking focus modes                                   |
| Breaks            | `/api/v1/breaks`             | Start and manage break periods                                               |
| Friends           | `/api/v1/friends`            | Friend requests, friend list, user search                                    |
| Notification      | `/api/v1/notifications`      | In-app notification records                                                  |
| FCM Token         | `/api/v1/fcmTokens`          | Register and manage Firebase device tokens                                   |
| Personal Reminder | `/api/v1/personal-reminders` | User-defined reminder records                                                |
| Analytics         | `/api/v1/analytics`          | Focus time statistics and productivity metrics                               |
| Dashboard         | `/api/v1/dashboard`          | Admin-facing aggregations and overviews                                      |
| Settings          | `/api/v1/settings`           | Application settings                                                         |
| Banner            | `/api/v1/banners`            | Promotional banner management (admin)                                        |
| FAQ               | `/api/v1/faqs`               | Frequently asked questions management                                        |
| Support           | `/api/v1/supports`           | User support ticket submission                                               |
| Rule              | `/api/v1/rules`              | Platform rules and guidelines                                                |

---

## Running the Project

### Development

```bash
yarn dev
```

Hot-reloads on file changes via `ts-node-dev`.

### Production

```bash
# 1. Compile TypeScript
yarn build

# 2. Run the compiled output
yarn start
```

### Build only

```bash
yarn build
```

### Format code

```bash
yarn format
```

---

## Logging

Winston is used with two named logger instances:

| Logger        | Level   | Destination                                    |
| ------------- | ------- | ---------------------------------------------- |
| `logger`      | `info`  | Console + `winston/success/%DATE%-success.log` |
| `errorLogger` | `error` | Console + `winston/error/%DATE%-error.log`     |

Log files rotate daily (`DD-MM-YYYY-HH` date pattern), with a maximum file size of 20 MB and a 1-day retention period. HTTP request logging is handled by Morgan, which pipes output through the Winston streams.

---

## Error Handling

All unhandled errors in route handlers are caught by `catchAsync` and forwarded to the global error handler (`src/app/middlewares/globalErrorHandler.ts`).

The global handler normalises the following error types:

| Error Type                 | Handling                                               |
| -------------------------- | ------------------------------------------------------ |
| `ZodError`                 | Parsed into field-level validation messages            |
| Mongoose `ValidationError` | Parsed into field-level validation messages            |
| `TokenExpiredError`        | 401 with session-expired message                       |
| `JsonWebTokenError`        | 401 with invalid-token message                         |
| `ApiError`                 | Uses the status code and message from the thrown error |
| Generic `Error`            | 500 with the error message                             |

**Response modes** (controlled by the `RESPONSE_MODE` environment variable):

- `STRICT` — returns the appropriate HTTP status code (default)
- `SOFT` — always returns HTTP 200 with `success: false` in the body (for clients that cannot handle non-2xx responses)

Stack traces are included in error responses when `NODE_ENV` is not `production`.

Process-level events (`uncaughtException`, `unhandledRejection`) are logged to `errorLogger` and trigger a graceful shutdown.

---

## Security

| Mechanism                     | Implementation                                                           |
| ----------------------------- | ------------------------------------------------------------------------ |
| CORS                          | `cors` middleware; `credentials: true`                                   |
| Rate Limiting                 | 200 requests per 15 minutes per IP (`express-rate-limit`)                |
| JWT Authentication            | `Authorization: Bearer` header validation on all protected routes        |
| Role Guards                   | Role membership enforced in `auth` middleware                            |
| Password Hashing              | bcrypt with configurable salt rounds (`BCRYPT_SALT_ROUNDS`)              |
| OTP Expiry                    | 3-minute expiry for email OTPs; 5-minute expiry for reset tokens         |
| Input Validation              | Zod schema validation via the `validateRequest` middleware               |
| Device Fingerprint Validation | Known invalid/placeholder fingerprint values rejected during NFC pairing |
| Soft Deletes                  | Deleted records are excluded from all standard queries transparently     |

---

## License

ISC

---

## Maintainers

Moshfiqur Rahman — moshfiqurrahman37@gmail.com
