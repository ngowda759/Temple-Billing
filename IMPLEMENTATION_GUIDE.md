# Devotee Registration & Multi-Channel Notification System - Implementation Guide

## Overview

This system lets devotees register with complete personal information and receive
notifications via email and in-app records when they book, donate, or order prasadam.

Registering does not receive a notification — it *triggers* one. See
[Notification Flow](#notification-flow) for exactly what is sent on each action.

## What's implemented

### 1. Devotee registration (verification-link flow)

Registration is **two-step**, not a single `POST`. The register form calls
`POST /api/auth/send-verification-link`, which emails a link; clicking the link
completes registration via `GET /api/auth/verify-registration`.

Fields validated on both steps:

| Field | Rule |
|---|---|
| Name | required |
| Email | required, valid format, unique |
| Phone Number | required, exactly 10 digits, unique |
| Address | required |
| Place/City | required, letters and spaces only |
| Password | required, minimum 6 characters |
| Confirm Password | required, must match password |

Files:
- `frontend/src/pages/auth/RegisterPage.jsx` — the form and client-side validation
- `frontend/src/services/authService.js` — `sendVerificationLink()` (and `register()`)
- `backend/src/controllers/authController.js` — `sendVerificationLink`,
  `verifyRegistration`, `registerUser`

The verification token is a JWT valid for **15 minutes** and carries the
already-bcrypt-hashed password, so the raw password is never placed in the token.

`registerUser` (the direct endpoint) additionally requires an authenticated
`admin`, `cashier`, `accountant`, or `staff` caller — a devotee cannot register
directly through it:

```js
// backend/src/controllers/authController.js, registerUser
if (!isAuthorized) {
  return res.status(403).json({ message: "Direct devotee registration is not allowed. Please use the verification link." });
}
```

### 2. Models supporting devotee information

All models are **Mongoose** models under `backend/src/models/`. For the entities
that have been migrated, the same fields are mirrored in a PostgreSQL repository;
see [`docs/postgres-migration.md`](docs/postgres-migration.md).

#### User — `backend/src/models/User.js`
`name`, `email` (unique, lowercase), `username`, `employeeId`, `phone`, `address`,
`place`, `password` (bcrypt, minlength 6), `role`, `photo`, `status`,
`accountEnabled`, `permissions`, `menuAccess`, `lastLogin`, `mustChangePassword`,
`provider` (`local` | `google`), `resetPasswordToken`, `resetPasswordExpiresAt`.
Roles: `admin`, `accountant`, `cashier`, `priest`, `staff`, `devotee`.

#### Booking — `backend/src/models/Booking.js`
`devoteeId` (ref User), `devoteeName` (required), `devoteeEmail`, `devoteePhone`,
`service` (required), `datetime` (required, **String** — not a Date),
`amount` (required, min 0), `gst`, `paymentMethod`, `paymentStatus`,
`transactionId`, Razorpay fields, `bookingNumber` (auto-generated `PB####` /
`CB####` prefix for combined bookings), `status`, `contactNumber`, `notes`,
`counted`, `assignedPriest`, `priestName`, timing/completion fields,
`templeMaterialRequests[]`, `materialStatus`, `priestChecklist`,
pooja snapshot fields (`poojaDuration`, `poojaRules`, `poojaDressCode`,
`priestInstructions`, `snapshotMaterials`), `isCombined`, `items[]`, and
`bookingHistory[]`.

PostgreSQL repository: `backend/src/repositories/bookingRepository.js`
(`bookings` + `booking_history` + `booking_material_requests` + `booking_items`).

#### Donation — `backend/src/models/Donation.js`
`donorName` (required), `donorEmail` (lowercase), `contactNumber`, `donorPhone`,
`amount` (required, min 0), `category` (default `General`), `paymentMethod`,
`transactionId`, Razorpay fields, `eventId`, `notes`, `status`, `donatedBy`.

PostgreSQL repository: `backend/src/repositories/donationRepository.js`.

#### PrasadamOrder — `backend/src/models/PrasadamOrder.js`
`channel` (`devotee` | `cashier`), `devoteeId`, `devoteeName` (required), `email`,
`phone`, `address`, `itemName` (required), `quantity` (min 1, default 1),
`unitPrice` (required, min 0), `amount` (required, min 0), `paymentMethod`,
Razorpay fields, `status`.

PostgreSQL repository: `backend/src/repositories/prasadamOrderRepository.js`.

### 3. Communication service — `backend/src/utils/communicationService.js`

Sends messages over these channels and additionally appends every message to
`backend/src/logs/communications.log`:

| Channel | Status |
|---|---|
| Email | **Real** — Nodemailer SMTP |
| SMS | **Stub** — logs only, no provider integrated |
| In-app notification | Store + email, via `notificationService.js` and the `Notification` model |

Exports:

```js
module.exports = {
  sendEmail,
  sendSMS,
  sendNotification,
  sendBookingConfirmation,
  sendDonationReceipt,
  sendPrasadamOrderConfirmation,
  sendBillReceipt,
  sendFestivalNotification,
};
```

Usage:

```js
await sendBookingConfirmation(devotee, booking);      // devotee: { name, email, phone }
await sendDonationReceipt(donor, donation);
await sendPrasadamOrderConfirmation(devotee, order);

await sendEmail({ to, bcc, subject, html, text, attachments });
await sendSMS({ to, message });
await sendNotification({ to, subject, message, messageType });
```

`sendBookingConfirmation` also generates a PDF receipt with
`generateBookingReceiptPDF` (from `backend/src/utils/pdfGenerator.js`, built on
`pdfkit`) and attaches it to the email.

Environment variables (`EMAIL_SERVICE`, `EMAIL_USER`, `EMAIL_PASS`) configure the
transporter. **Security note:** the file currently falls back to a hard-coded
Gmail address and app password when those variables are unset
(`initTransporter`). Remove those literals and require the environment variables
instead.

#### Email and SMS for other flows

Booking, donation, prasadam, support, event, and staff notifications are also
created through `backend/src/utils/notificationService.js`
(`createNotification`, `createStaffNotification`, `sendBroadcastEmail`), which
persists a `Notification` document and, where an audience email is resolvable,
sends the email. `sendBroadcastEmail` supports image and PDF attachments for
festival invitations.

### 4. Devotee controller — `backend/src/controllers/devoteeController.js`

Routes are mounted at **both** `/api/devotee` and `/api/devotees`
(`backend/src/routes/devoteeRoutes.js`, registered twice in
`backend/src/app.js`). Relevant endpoints:

| Method | Path | Handler |
|---|---|---|
| GET | `/api/devotee/bookings` | `getBookings` |
| POST | `/api/devotee/bookings` | `createBooking` |
| POST | `/api/devotee/bookings/verify` | `verifyBookingPayment` |
| PATCH | `/api/devotee/bookings/:id/status` | `updateBookingStatus` |
| GET | `/api/devotee/donations` | `getDonations` |
| POST | `/api/devotee/donations` | `createDonation` |
| GET | `/api/devotee/notifications` | `getNotifications` |
| POST | `/api/devotee/notifications/:id/send-email` | `sendNotificationEmail` |
| PATCH | `/api/devotee/notifications/:id/read` | `markNotificationAsRead` |
| GET | `/api/devotee/profile` | `getProfile` |
| PUT | `/api/devotee/profile` | `updateProfile` |
| GET/POST | `/api/devotee/events` | `getEvents` / `createEvent` |
| GET | `/api/devotee/events/overview` | `getFestivalOverview` |
| PATCH/DELETE | `/api/devotee/events/:id` | `updateEvent` / `deleteEvent` |
| POST | `/api/devotee/razorpay/order`, `/razorpay/verify`, `/razorpay/webhook` | Razorpay flows |
| POST | `/api/devotee/prasadam-orders/verify` | `verifyPrasadamPayment` |
| POST/GET | `/api/devotee/support` | `submitSupportRequest` / `getSupportRequests` |
| PATCH | `/api/devotee/support/:id`, `/support/:id/read` | `replySupportRequest` / `markSupportRequestAsRead` |
| GET/POST | `/api/devotee/prasadam-orders` | `getPrasadamOrders` / `createPrasadamOrder` |
| PATCH | `/api/devotee/prasadam-orders/:id/cancel` | `cancelPrasadamOrder` |

`createBooking` validates that `devoteeName`, `service`, `datetime`, and `amount`
are present, that the amount is a **strictly positive** number, that `datetime`
parses to a **future** time, and that `paymentMethod` (when supplied) is one of
`UPI`, `Cash`, `Card`, `Bank Transfer`, `Net Banking`. The booking status is
forced to `Confirmed` and payment status to `Paid`.

`createDonation` and `createPrasadamOrder` likewise persist first and then fire
notifications.

Notifications are sent with `.catch()` guards so a delivery failure does not fail
the request:

```js
sendBookingConfirmation(devotee, { service, datetime, amount: numericAmount, status: bookingStatus })
  .catch((err) => console.warn("Failed to send booking confirmation:", err.message));
```

`createBooking` also creates a ledger `Bill` (`createLedgerBill`), records an
`AccountTransaction` when paid, and generates inventory requests for selected
temple materials.

### 5. Devotee profile component

`frontend/src/components/DevoteeProfile.jsx` renders and edits the profile:
fields `id`, `name`, `email`, `phone`, `address`, `place`, `memberSince`, with
client-side validation (10-digit phone, letters/spaces-only place), a
`loading`/`saving` state split, a success message, and an edit/cancel flow.

## API examples

### Send verification link (no auth required)
```
POST /api/auth/send-verification-link
Body: {
  "name": "John Devotee",
  "email": "john@example.com",
  "phone": "9876543210",
  "address": "123 Main Street",
  "place": "Chennai",
  "password": "secure123",
  "confirmPassword": "secure123",
  "role": "devotee"
}
Response: { "message": "Verification link sent successfully to your email.", "verificationLink": "..." }
```

### Complete registration
```
GET /api/auth/verify-registration?token=<jwt>
Response: HTML page — "Verification Successful"
```

### Get profile
```
GET /api/devotee/profile?email=john@example.com
Response: { "profile": { "id": "...", "name": "...", "email": "...", "phone": "...", "address": "...", "place": "...", "role": "devotee", "memberSince": "..." } }
```

### Update profile
```
PUT /api/devotee/profile
Body: {
  "currentEmail": "john@example.com",
  "name": "John Updated",
  "email": "john@example.com",
  "phone": "9876543210",
  "address": "456 Oak Street",
  "place": "Bangalore"
}
```

### Create booking
```
POST /api/devotee/bookings
Body: {
  "devoteeName": "John Devotee",
  "devoteeEmail": "john@example.com",
  "devoteePhone": "9876543210",
  "service": "Archana",
  "datetime": "2026-06-15T10:00:00.000Z",
  "amount": 500,
  "paymentMethod": "UPI",
  "notes": "Special requirements"
}
Response: 201 { "booking": { ... } }
```
`datetime` must be a future date/time; `amount` must be > 0.

### Create donation
```
POST /api/devotee/donations
Body: {
  "donorName": "John Devotee",
  "donorEmail": "john@example.com",
  "donorPhone": "9876543210",
  "amount": 1000,
  "category": "Temple Maintenance",
  "paymentMethod": "UPI",
  "transactionId": "TXN123456"
}
```

### Create prasadam order
```
POST /api/devotee/prasadam-orders
Body: {
  "devoteeName": "John Devotee",
  "email": "john@example.com",
  "phone": "9876543210",
  "itemName": "Laddu Prasadam",
  "quantity": 2,
  "unitPrice": 100,
  "paymentMethod": "UPI"
}
```

## Notification Flow

### When a booking is created
1. Booking saved (PostgreSQL repository when the datasource gate selects it, otherwise Mongoose)
2. Ledger `Bill` created and `AccountTransaction` recorded when paid
3. In-app notification created for the devotee (by email) and for the `cashier` role
4. Email sent to `devoteeEmail`, with a PDF receipt attached
5. SMS call made to `devoteePhone` — **logs only**, no real delivery
6. Inventory requests generated for selected temple materials

### When a donation is received
1. Donation saved
2. Notification record created
3. Receipt email sent
4. SMS call made — **logs only**

### When a prasadam order is placed
1. Order saved
2. Notification record created
3. Confirmation email sent
4. SMS call made — **logs only**

## Frontend integration

```jsx
import DevoteeProfile from "../../components/DevoteeProfile";

// In a devotee dashboard/profile page:
<DevoteeProfile />
```

The registration form is served at `/register`; login is at `/auth-login`
(see `frontend/src/App.jsx`).

## Enabling real SMS delivery

`sendSMS` in `backend/src/utils/communicationService.js` is a logging stub:

```js
const sendSMS = async ({ to, message }) => {
  // TODO: Integrate with actual SMS service (Twilio, AWS SNS, etc.)
  console.log(`📱 SMS sent to ${to}`);
  ...
};
```

To make it real, install a provider SDK and replace the log call:

```bash
npm install twilio
```

```js
const twilio = require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
return twilio.messages.create({ body: message, from: process.env.TWILIO_PHONE, to });
```

## Data migration notes

The old guide suggested a MongoDB `updateMany` to backfill `phone`, `address`,
and `place` on existing users:

```javascript
db.users.updateMany(
  { phone: { $exists: false } },
  { $set: { phone: "", address: "", place: "" } }
);
```

Only run this if your database predates those fields; they are optional in the
schema and the app tolerates their absence.

For migrating entity data to PostgreSQL, use the migration runner documented in
[`docs/postgres-migration.md`](docs/postgres-migration.md) — it does not backfill
business rows by itself.

## Testing checklist

- [ ] Register a new devotee and receive the verification email
- [ ] Click the verification link and confirm registration completes
- [ ] Verify the profile shows all information
- [ ] Create a booking and check the email log for the receipt attachment
- [ ] Create a donation and check the receipt email
- [ ] Place a prasadam order and verify notifications
- [ ] Update the profile and verify changes persist
- [ ] Check `backend/src/logs/communications.log` for message records
- [ ] Run `npm test --workspace backend` (requires a test database)

## Files

**Backend**
- `src/models/User.js` — devotee fields (`phone`, `address`, `place`)
- `src/models/Booking.js` — `devoteeId`, `devoteePhone`, materials, history
- `src/models/Donation.js` — `donorPhone`
- `src/models/PrasadamOrder.js` — `devoteeId`, `phone`
- `src/controllers/authController.js` — verification-link registration
- `src/controllers/devoteeController.js` — bookings, donations, orders, profile, notifications
- `src/utils/communicationService.js` — email (real) + SMS (stub)
- `src/utils/notificationService.js` — in-app notifications, broadcasts, attachments
- `src/utils/pdfGenerator.js` — receipt PDFs
- `src/repositories/*.js` — PostgreSQL persistence for migrated entities
- `src/services/*Service.js` — datasource selection and validation

**Frontend**
- `src/pages/auth/RegisterPage.jsx` — registration form
- `src/services/authService.js` — `sendVerificationLink`, `register`
- `src/components/DevoteeProfile.jsx` — profile view/edit

## Security notes

1. Passwords are hashed with bcrypt (10 rounds).
2. Emails are normalised to lowercase and trimmed.
3. Phone numbers are validated as exactly 10 digits.
4. Validation runs on both the client and the server.
5. Direct devotee registration is rejected unless the caller is admin/cashier/accountant/staff.
6. Notification queries must be scoped to the requesting devotee — see
   [`NOTIFICATION_PROFILE_FIXES.md`](NOTIFICATION_PROFILE_FIXES.md).

## Support

For issues:
1. Check `backend/src/logs/communications.log`
2. Verify environment variables are set (email especially)
3. Ensure the database(s) are reachable — `GET /api/health` reports PostgreSQL status
4. Check the browser console for frontend errors