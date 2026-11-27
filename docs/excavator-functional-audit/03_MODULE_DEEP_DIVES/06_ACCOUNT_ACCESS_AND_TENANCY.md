# Module deep dive — Account, Access and Business (Tenant) Setup

**Modules covered:**
- Register (`/register`) and Login (`/login`)
- Forgot and reset password (`/forgot-password`, `/reset-password`)
- Operator login (`/operator-login`)
- App lock
- Sign out everywhere
- The "one business = one isolated account" rule

Investigated directly by the main investigator. Evidence grade **B** unless stated. Paths are relative to `excavator-manager/`.

## Module summary (business outcome)

**Registering** creates the business account and its first (and only) owner login in one step. The business is a fully separate data space: every record belongs to exactly one business.

**At registration** the app also prepares:
- a standard list of excavator service components;
- a standard list of operator money categories;
- a *business code* that operators use to request to join.

**Who signs in, and how:**
- **The owner** signs in with email or phone and a password.
- **Operators** sign in on a separate portal with mobile and PIN.

---

## F1. Register a business

- **Who:** anyone. This is public and rate-limited per IP.
- **Entry point:** `/register` (`src/app/(auth)/register/page.tsx`). It calls `POST /api/auth/register`, which calls `registerBusiness` (`src/lib/services/auth.ts` L37-~105).
- **Prerequisites:**
  - The email is not already used.
  - The phone is not already used by another login.
  - The business code, if typed, is free.

| Field | Required | Meaning | Validation (`src/lib/validation/auth.ts registerSchema`) | Business impact |
|---|---|---|---|---|
| businessName | Yes | Trading name | trimmed, min 1 ("Enter your business name") | Printed on the bill letterhead (copied onto each bill) |
| ownerName | Yes | Owner's name | min 1 | Becomes the owner login's name and `Business.ownerName` |
| phone | Yes | Business / owner phone | min 6 chars. Must be unique across all logins: "An account with this phone number already exists" | Owner can log in with it. Letterhead phone |
| email | Yes | Login email | valid email, lower-cased. Unique: "An account with this email already exists" | Login identity. Forgot-password emails go here |
| password | Yes | Login password | new-password policy (`password-policy.ts`) | — |
| businessCode | No | Code operators type to join | 3-20 letters or numbers. "Business code must be 3-20 letters/numbers, no spaces or symbols". Unique: "That business code is already taken — try another one." | Blank means a random code is generated. Can be regenerated later in Settings |

**Records created, in one transaction:**
- a **Business**, with defaults:
  - service interval 350 h
  - maintenance alert threshold 50 h
  - operator language English
  - bill template STANDARD
  - accent colour `#0B2B5E`
  - no diesel price
  - no limits, not frozen
- one **User** with role `OWNER`
- the **service component catalogue**: 58 default components in 8 categories, most with guide intervals (see deep dive 01, F12)
- the **transaction categories**: Salary Advance, Personal Advance, Food, Vegetables, Fuel, Medical, Loan, Bonus, Incentive, Extra Work Payment, Other.

No bank account, machine, customer or bill-number sequence is created. The Non-GST bill counter is created on the first auto-numbered bill.

**Limitation:** there is only one user per business. No second owner, staff or accountant login can be added from the app. `User.role` exists for future roles (schema comment).

## F2. Owner login / logout

- `POST /api/auth/login`, with `identifier` (email or phone) and `password`.
- Throttled per IP and per account. A wrong credential gives one generic message ("Wrong email/phone or password"), whichever part was wrong.
- The session lasts 30 days (per `docs/operations.md`). Every request re-checks the account against the database.
- Logout clears the caller's own session.

## F3. Forgot / reset password

- `POST /api/auth/forgot-password` with an email. It always answers "submitted", whether or not the email exists.
- A single-use reset token (stored hashed, valid 1 hour) is emailed.
- `/reset-password` takes the token plus a new password and its confirmation ("Passwords don't match").
- **Failure mode:** if the email service fails, the owner is told the request was submitted but receives nothing (per `docs/operations.md` §1). There is no support-side password reset.

## F4. Change password / Sign out everywhere / App lock (in Settings)

See deep dive 05, F16:
- Change password and Sign out everywhere both invalidate every existing session.
- The app lock is a 4- or 6-digit PIN that re-locks the app on this device. It does not replace the password.
- All three are refused while support is signed in as the owner.

## F5. Operator portal login

- `/operator-login` with mobile + PIN. It calls `authenticateOperator`: the candidates are operators with that mobile who have portal login enabled and are not archived, and the oldest PIN match wins.
- "Wrong mobile number or PIN" is the only error message.
- Before login, the portal screens are always in English. After login they use the operator's own language choice, or else the business default.
- See deep dive 03, F4–F6, for how a PIN is set (by the owner) or requested (self-signup).

## F6. Business isolation and freezing (functional effect)

- **Isolation.** Every owner and operator action is scoped to the signed-in business. A record of business A can never be read or changed by business B (`docs/invariants.md`, tenant-isolation rules).
- **Freezing.** A *frozen* business (set by support) can still open the app shell. Every other action fails with "This account has been frozen by our support team. Your data is safe — contact support for recovery." See deep dive 05, F17.

## Lifecycle

| Record | States | Transitions |
|---|---|---|
| Business | active / frozen | frozen ↔ unfrozen by support only. No owner-side closure or deletion. Support "clear data" wipes commercial records but keeps the business, its login, operators and operator money history |
| User (owner) | — | password changes, reset tokens, app PIN on/off. No deactivation |

## Limitations

- One login per business. No roles or permissions within a business.
- No owner-initiated account closure or data export of the whole business.
- No support-side password reset or contact procedure documented in the app.
- Self-registration is open to anyone (rate-limited). There is no verification of the email before the account is usable. **B**: `registerBusiness` creates the account directly, and there is no verification code path in `auth.ts`. The session lasts 30 days (`src/lib/auth.ts` L52, `maxAge: 30 * 24 * 60 * 60`).
