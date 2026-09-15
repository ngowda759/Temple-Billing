# Temple Billing System

## Introduction
The Temple Billing System is a web-based application developed to automate and manage temple-related financial operations such as donation collection, pooja booking, prasadam billing, receipt generation, inventory management, and report generation. The system helps temple administrators, accountants, staff members, and devotees efficiently manage temple services through a centralized digital platform.

The application minimizes manual paperwork, improves transparency in temple accounting, simplifies billing processes, and enhances devotee service management.

## Objectives
- Automate temple billing operations
- Manage pooja and donation records efficiently
- Simplify receipt generation and payment tracking
- Maintain inventory of temple items and prasadam
- Generate financial and audit reports
- Improve transparency and operational efficiency

## Technology Stack

### Frontend
- React 19 (Vite 8)
- React Router 7
- Tailwind CSS 3
- Axios
- Recharts, `jspdf` / `jspdf-autotable`, `xlsx`, `html2canvas`, `qrcode.react`
- `@vladmandic/face-api` (staff face-recognition attendance)
- `react-toastify`, `framer-motion`, `react-icons`

### Backend
- Node.js
- Express 5
- JWT (`jsonwebtoken`) authentication with bcrypt password hashing
- `razorpay` (online payments)
- `nodemailer` (email notifications)
- `pdfkit` (server-side receipt/document generation)
- `node-cron` (scheduled notification jobs)

### Database
- **MongoDB (Mongoose)** — the live source of truth for all business data today.
- **PostgreSQL (`pg`)** — an incremental, additive persistence layer being adopted entity by entity. See [PostgreSQL migration](#postgresql-migration).
- MySQL is **not** used anywhere in the system.

## System Modules
The backend is organised as one route file per feature area under
`backend/src/routes/`. The modules below correspond to those files.

### 1. Admin Module
Central control unit for temple services, donations, billing, inventory, staff, and reports.

Functions:
- Admin login/logout and role-based access
- Manage temple services, staff, and employees
- Monitor donations and collections
- Generate reports
- Configure system settings

Features:
- Dashboard analytics and revenue monitoring
- Billing, service, and staff management
- Inventory ERP (items, batches, suppliers, purchase orders, GRNs, assets, repairs)

Backend routes: `adminInventoryRoutes.js`, `adminPrasadamOrdersRoutes.js`, `auditLogRoutes.js`
Frontend pages: `frontend/src/pages/admin/`

### 2. Devotee Management Module
Manages devotee registration and records.

Functions:
- Register devotees (email-verification-link flow)
- Update devotee information
- Track booking and donation history
- Deliver personalised notifications

Devotee Details:
- Name, email, phone, address, place
- Booking history and donation history

Backend routes: `devoteeRoutes.js` (mounted at both `/api/devotee` and `/api/devotees`)
Frontend pages: `frontend/src/pages/devotee/`

### 3. Pooja Booking Module
Manages pooja and seva booking operations.

Functions:
- Book poojas
- Schedule sevas
- Generate booking receipts
- Track booking status

Features:
- Online pooja booking with slot scheduling
- QR code booking confirmation
- Material requirement snapshots and inventory request generation

Backend routes: `poojaRoutes.js`, `poojaBookingRoutes.js`, `poojaSettingsRoutes.js`
Backend models: `Pooja.js`, `PoojaBooking.js`, `PoojaMaterialRequirement.js`

### 4. Donation Management Module
Manages temple donations and sponsorships.

Functions:
- Accept donations (including Razorpay UPI/online)
- Generate donation receipts
- Track donation history
- Manage sponsorship/campaign metadata

Backend routes: `donationRoutes.js`
Backend models: `Donation.js`, `Event.js`

### 5. Billing & Payment Module
Handles billing and payment processing.

Functions:
- Generate bills and bill items
- Process payments (cash, UPI, card, bank transfer, Razorpay)
- Generate receipts
- Track transactions

Backend routes: `billRoutes.js`
Backend models: `Bill.js`
Ledger integration: `backend/src/services/accountingService.js`

### 6. Prasadam & Inventory ERP Module
Manages prasadam sales and temple inventory.

Functions:
- Add/edit/delete inventory items and suppliers
- Manage prasadam stock, batches, and consumption
- Raise and approve inventory requests
- Purchase orders, goods received notes, damage notes, assets, and repairs
- Generate inventory reports

Backend routes: `adminInventoryRoutes.js`, `prasadamRoutes.js`, `adminPrasadamOrdersRoutes.js`
Backend models: `InventoryItem.js`, `InventoryBatch.js`, `InventoryLog.js`,
`InventoryConsumption.js`, `InventoryRequest.js`, `InventoryIssue.js`,
`PurchaseOrder.js`, `GoodsReceivedNote.js`, `DamageNote.js`, `Asset.js`,
`RepairRequest.js`, `RepairTicket.js`, `Supplier.js`, `RestockHistory.js`,
`Prasadam.js`, `PrasadamOrder.js`, `Recipe.js`

### 7. Employee & Staff Management Module
Manages temple staff and employee records.

Functions:
- Add/edit/delete employees
- Manage attendance (including face-recognition and geo-location)
- Assign duties and shifts
- Leave and payroll management
- Task assignment and transfers

Backend routes: `employeeRoutes.js`, `attendanceRoutes.js`, `attendanceLocationRoutes.js`,
`attendanceSettingsRoutes.js`, `leaveRoutes.js`, `shiftRoutes.js`, `payrollRoutes.js`,
`staffRoutes.js`, `transferRoutes.js`
Backend models: `Employee.js`, `Attendance.js`, `AttendanceLocation.js`,
`AttendanceSetting.js`, `Leave.js`, `Shift.js`, `ShiftAssignment.js`,
`PayrollRecord.js`, `Task.js`, `TransferRequest.js`, `Instruction.js`

### 8. Festival & Event Management Module
Manages temple festivals and special events.

Functions:
- Create festival events
- Manage special bookings
- Track festival donations and registrations
- Generate event reports

Backend routes: `eventRoutes.js`
Backend models: `Event.js`

### 9. Notification Module
Sends alerts and notifications to devotees and staff.

Functions:
- Booking confirmations
- Payment notifications
- Festival announcements and invitations (with attachments)
- Reminder alerts

Features:
- Email delivery via Nodemailer (`backend/src/utils/communicationService.js`)
- In-app database notifications (`backend/src/models/Notification.js`)
- Scheduled daily jobs (warranty expiry, upcoming poojas) via `node-cron` in `backend/src/app.js`
- SMS is a stubbed channel — see [Known gaps](#known-gaps)

Backend routes: `notificationRoutes.js`
Backend services: `backend/src/utils/notificationService.js`

### 10. Report & Analytics Module
Generates financial and operational reports.

Functions:
- Donation, billing, festival, and inventory reports
- Financial statements and profit/loss
- Audit logs

Features:
- Charts and dashboards (Recharts)
- PDF/Excel export on the frontend

Backend routes: `accountRoutes.js`, `auditLogRoutes.js`,
`adminInventoryRoutes.js` (report endpoints), `priestRoutes.js` (completed-services reporting)

### 11. Authentication & Security Module
Provides secure access and protects temple financial data.

Functions:
- User authentication (email/password and Google login)
- Password encryption and reset
- Session management
- Role-based authorization

Features:
- JWT authentication (`Authorization: Bearer <token>`, 7-day expiry)
- bcrypt password hashing (10 rounds)
- Protected APIs via `authenticate` / `authorizeRoles` middleware
- Email-verification-link registration flow (15-minute token)
- Account status gating (`accountEnabled`, employee access status)

User Roles (`backend/src/models/User.js`): `admin`, `accountant`, `cashier`,
`priest`, `staff`, `devotee`. Some routers also accept `superadmin` / `manager`
role strings; keep this in mind when auditing role checks.

Backend routes: `authRoutes.js`
Backend middleware: `backend/src/middleware/authMiddleware.js`

### 12. Receipt & Document Management Module
Manages temple receipts and financial documents.

Functions:
- Generate receipts (booking, donation, bill)
- Store payment records
- Download reports
- Manage financial documents

Features:
- PDF receipt generation (`backend/src/utils/pdfGenerator.js` with `pdfkit`)
- Client-side PDF/Excel export (`jspdf`, `xlsx`)
- Receipt history tracking

## PostgreSQL Migration

The backend runs on MongoDB today and is migrating to PostgreSQL **entity by entity,
additively**, so that an unavailable PostgreSQL never takes the app down.

- Phase 1 established the connection pool, migration runner, and `/api/health` probe.
- Phases 2A–2Q have added PostgreSQL tables, repositories, and services for many entities.
- Each migrated entity keeps its Mongoose model as a **fallback**; there are **no dual writes**.

Start here: [`docs/postgres-migration.md`](docs/postgres-migration.md) — the migration
index with the full phase list, current status, and links to per-entity documentation.

## Project Structure
```
.
├── backend/                 # Node.js + Express API
│   ├── scripts/             # One-off data migration scripts (MongoDB)
│   ├── src/
│   │   ├── config/          # Mongo + PostgreSQL connection configuration
│   │   ├── controllers/     # Express request handlers
│   │   ├── db/              # SQL migrations and the migration runner
│   │   ├── middleware/      # Auth / role authorization
│   │   ├── models/          # Mongoose models (current source of truth)
│   │   ├── repositories/    # PostgreSQL data access (dual-path with Mongoose)
│   │   ├── routes/          # One router per feature area
│   │   ├── services/        # Datasource-aware business logic
│   │   ├── store/           # File-based fallback stores (offline mode)
│   │   └── utils/           # Email/SMS, PDF, notifications, accounting helpers
│   └── test/                # node:test PostgreSQL path/fallback tests
├── frontend/                # React + Vite SPA
│   └── src/
│       ├── components/      # Shared and feature components
│       ├── context/         # Auth and theme providers
│       ├── layouts/         # Admin / staff / priest / devotee layouts
│       ├── pages/           # Route-level screens per role
│       ├── services/        # Axios API clients
│       └── utils/
└── docs/                    # PostgreSQL migration documentation
```

## Run
1. Copy `backend/.env.example` to `backend/.env` and fill in the values.
   - `MONGODB_URI` is required.
   - `JWT_SECRET`, `EMAIL_*`, and Razorpay keys are used when present.
   - `DATABASE_URL` (or `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`) enables PostgreSQL.
     PostgreSQL is only attempted when real connection configuration is present.
2. Install dependencies (npm workspaces):
   - `npm run install:all`
3. Apply PostgreSQL migrations (only needed if PostgreSQL is configured):
   - `npm run db:migrate --workspace backend`
4. Start the backend:
   - `npm run dev:backend` (nodemon, port 5000)
5. Start the frontend:
   - `npm run dev:frontend` (Vite, port 5173)

Useful endpoints/scripts:
- `GET /api/health` →
  `{ "status": "ok", "service": "temple-billing-backend", "postgres": "connected" | "unavailable" }`
- `npm run db:verify --workspace backend` → checks PostgreSQL connectivity
- `npm test --workspace backend` → PostgreSQL path + fallback tests (requires a test database)

## Known gaps
Documented here so contributors do not assume capabilities that do not exist yet.

- **SMS delivery is stubbed.** `sendSMS` in `backend/src/utils/communicationService.js`
  only logs; there is no Twilio/SNS integration.
- **Email credentials are committed in source.** `communicationService.js` contains a
  hard-coded fallback Gmail address and app password. These should be removed and read
  from the environment only.
- Several API base URLs are hard-coded to `http://localhost:5000` in `frontend/src/services/`
  and in notification email templates rather than using an environment variable.
- Migration phases 2A–2H and 2N do not have dedicated `docs/` files; they are summarised
  in the migration index.

## Future Enhancements
- Mobile application integration
- Online live darshan support
- QR code temple entry system
- AI-based crowd management
- Online prasadam delivery
- Cloud-based temple accounting
- Multi-language support
- AI chatbot for devotee assistance

Face recognition for staff attendance is already implemented
(`frontend/src/components/admin/employee/FaceRegistration.jsx`,
`frontend/src/pages/staff/StaffAttendanceFlow.jsx`).