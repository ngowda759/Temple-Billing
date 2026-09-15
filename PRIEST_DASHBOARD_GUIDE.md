# Priest Dashboard - Setup & Implementation Guide

## Overview

A priest dashboard for the Sri Shanti Mahadev Mandir temple billing system. It
appears after a priest logs in and displays information scoped to that priest.

The dashboard is backed by **live API calls**, not demo data.

## Features

### 1. Welcome header
- Personalised greeting: `Welcome back, {user?.name}! 🙏`
- Current date rendered client-side

### 2. Statistics cards
Cards are clickable and navigate to the matching section:
- **Today's Poojas** → `/priest/my-duties`
- **Upcoming Poojas** → `/priest/my-duties`
- **Completed Today** → `/priest/completed-services`
- Other cards (pending services, total devotees) render as metrics

### 3. Today's Schedule
Table of services for today with Time, Pooja/Service, Devotee, and Status.
Colour-coded statuses: Completed (green), In Progress (amber), Upcoming (blue),
Pending (rose), with a neutral fallback.

### 4. Today's Seva Duties
List of duties with time slots, descriptions, and icons.

### 5. Upcoming Poojas
Next scheduled poojas with date/time and devotee name, linking to the full list.

### 6. Completed Services
Historical completed services with search, status filter, sort, date range, and
pagination (`CompletedServices` component inside `PriestDashboard.jsx`).

### 7. Announcements
Important announcements and notifications. A "view all" link navigates to
`/priest/notifications`.

### 8. Quick Actions
Shortcuts to duties and other common functions.

### 9. Additional sections

Sidebar entries (`frontend/src/data/priestSidebarData.js`): Dashboard, My Duties,
Duty Transfer Requests, Inventory Requests, Attendance, Leave Requests,
Apply Leave, Notifications, Profile, Logout.

Additional sections reachable by route/dashboard links but **not** listed in the
sidebar (see the "Hidden routes" branch in `PriestLayout.findActiveItem`):
**Seva Schedule**, **Completed Services**, **Special Duties**, **Festival Duties**,
and **Settings**. `PriestLayout` still resolves their active sidebar item from
`location.pathname`.

## File structure

```
frontend/
├── src/
│   ├── pages/priest/
│   │   ├── PriestDashboard.jsx       # Entry component; switches sections
│   │   ├── PriestDashboard.css       # Dashboard styling
│   │   ├── MyDuties.jsx
│   │   ├── CompletedServices.jsx
│   │   ├── SevaSchedule.jsx
│   │   ├── SpecialDuties.jsx
│   │   ├── FestivalDuties.jsx
│   │   ├── DutyTransferRequests.jsx
│   │   ├── PriestInventory.jsx
│   │   ├── PriestNotifications.jsx
│   │   └── PriestProfile.jsx
│   ├── layouts/PriestLayout.jsx      # Sidebar + topbar shell
│   ├── components/common/
│   │   ├── PriestSidebar.jsx
│   │   └── PriestTopbar.jsx
│   ├── data/priestSidebarData.js     # Sidebar items → route paths
│   └── services/priestService.js     # API client
└── App.jsx                           # Routing for all /priest/* paths
```

`PriestDashboard.jsx` is a single entry component that reads the active sidebar
item from `PriestLayout` and switches between section components. Every
`/priest/*` route in `App.jsx` renders the same `PriestDashboard` component, and
`PriestLayout` derives the active section from `location.pathname` via
`findActiveItem`.

## How it works

### Authentication flow
1. Priest logs in at `/auth-login` (`AuthLoginPage`).
2. Backend returns a JWT and user data including `role: "priest"`.
3. The frontend redirects to `/priest`.
4. `ProtectedRoute allowedRoles={["priest"]}` guards every `/priest/*` route;
   a non-priest is redirected to `/{their-role}`, an unauthenticated visitor to `/`.
5. `PriestDashboard` calls `GET /api/priest/dashboard` with the stored JWT.

### User data
- User information comes from `useAuth()` (`frontend/src/context/AuthContext.jsx`).
- Name is shown in the header.
- The backend derives the priest's identity from the JWT (`authenticate` middleware
  sets `req.user`) and `authorizeRoles("priest")` is applied to the entire router
  in `backend/src/routes/priestRoutes.js`.

### Data display
The dashboard fetches real data on mount:

```jsx
const fetchDashboardData = async () => {
  try {
    setLoading(true);
    setError(null);
    const data = await getPriestDashboard();
    if (data) {
      if (data.stats) setStats(data.stats);
      if (data.todaySchedule) setTodaySchedule(data.todaySchedule);
      if (data.upcomingPoojas) setUpcomingPoojas(data.upcomingPoojas);
      if (data.completedServices) setCompletedServices(data.completedServices);
      if (data.sevaDuties) setSevaDuties(data.sevaDuties);
      if (data.announcements) setAnnouncements(data.announcements);
    }
  } catch (err) {
    console.error("Error fetching dashboard data:", err);
    setError("Failed to load dashboard data. Please try again.");
  } finally {
    setLoading(false);
  }
};

useEffect(() => {
  fetchDashboardData();
}, []);
```

`getPriestDashboard()` takes **no arguments** — `priestService.js` reads the JWT
from `authService.getStoredToken()` and sends it as a bearer token. The earlier
version of this guide showed `getPriestDashboard(user.id)`, which is not the
current signature.

## Backend endpoints

All are under `/api/priest` and require authentication plus the `priest` role.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/dashboard` | Stats, schedule, upcoming, completed, duties, announcements |
| GET | `/today-schedule` | Today's services |
| GET | `/upcoming-poojas` | Upcoming poojas |
| GET | `/completed-today` | Services completed today |
| PATCH | `/bookings/:id/status` | Change a booking status |
| GET | `/my-duties` | Assigned duties |
| PUT | `/my-duties/start` | Start a duty |
| PUT | `/my-duties/complete` | Complete a duty |
| POST | `/my-duties/transfer` | Request a duty transfer |
| GET | `/my-duties/incoming-transfers` | Incoming transfer requests |
| GET | `/my-duties/transfers` | Own transfer requests |
| POST | `/my-duties/transfer/:id/respond` | Accept/reject a transfer |
| GET | `/my-duties/available-priests` | Priests available for transfer |
| GET | `/priests-list` | Priest list |
| GET | `/assigned-poojas` | Assigned poojas (filter/search) |
| PUT | `/start-pooja/:id` | Start a pooja |
| PUT | `/complete-pooja/:id` | Complete a pooja |
| PUT | `/pending-pooja/:id` | Mark a pooja pending |
| GET | `/seva-schedule` | Seva schedule |
| GET | `/seva-instructions` | Seva instructions |
| GET | `/material-checklist` | Material checklist |
| GET | `/completed-services` | Completed services (query-param filtering) |
| GET | `/special-duties` | Special duties |
| PUT | `/accept-duty/:id` | Accept a special duty |
| PUT | `/reject-duty/:id` | Reject a special duty |
| PUT | `/complete-duty/:id` | Complete a special duty |
| GET | `/festival-duties` | Festival duties |
| PUT | `/festival-duty-attendance/:id` | Mark festival duty attendance |
| PUT | `/festival-duty-complete/:id` | Complete a festival duty |
| GET | `/notifications` | Priest notifications |
| PUT | `/notifications/read/:id` | Mark one notification read |
| PUT | `/notifications/read-all` | Mark all read |
| GET/PUT | `/profile` | Read/update priest profile |
| GET/PUT | `/settings` | Read/update priest settings |
| GET | `/inventory/catalog` | Inventory catalog for requests |
| POST/GET | `/inventory-requests` | Create/list own inventory requests |
| GET | `/inventory-requests/:userId` | Requests for a user |
| GET | `/inventory-issues`, `/inventory-issues/:userId` | Issued inventory |
| POST | `/inventory-issues/:id/complete` | Complete usage of an issue |

## Frontend routes

Defined in `frontend/src/App.jsx`, all guarded by
`<ProtectedRoute allowedRoles={["priest"]}>` and all rendering `PriestDashboard`:

`/priest`, `/priest/attendance`, `/priest/apply-leave`, `/priest/leave-requests`,
`/priest/seva-schedule`, `/priest/completed-services`, `/priest/special-duties`,
`/priest/festival-duties`, `/priest/notifications`, `/priest/profile`,
`/priest/settings`, `/priest/my-duties`, `/priest/transfer-requests`,
`/priest/inventory-requests`.

## Setup

```bash
cd frontend
npm install     # react-icons, axios, react-router-dom, etc.
npm run dev     # Vite dev server on port 5173
```

Test the dashboard:
1. Start the backend (`npm run dev:backend`, port 5000).
2. Start the frontend (`npm run dev:frontend`, port 5173).
3. Open `http://localhost:5173/auth-login` and log in with priest credentials.
4. You are redirected to `/priest`.

## Using the service layer

```javascript
import { getPriestDashboard, getPriestTodaySchedule } from "../../services/priestService";

useEffect(() => {
  const fetchData = async () => {
    try {
      const dashboardData = await getPriestDashboard();
      setStats(dashboardData.stats);
      const schedule = await getPriestTodaySchedule();
      setTodaySchedule(schedule);
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };
  fetchData();
}, []);
```

`priestService.js` exposes roughly 40 functions covering the endpoints above
(`getPriestDashboard`, `getPriestTodaySchedule`, `getMyDuties`, `startMyDuty`,
`requestTransfer`, `getSevaSchedule`, `getSpecialDuties`, `getFestivalDuties`,
`getProfile`, `updateProfile`, `getSettings`, `updateSettings`, and so on).

## Customisation

### Colours
Adjust Tailwind classes in `PriestDashboard.jsx`:
- Primary: `orange-500` → your preferred colour
- Secondary: `purple-500`
- Stat-card accent colours

### Adding sections
Create a component and add a `case` to the `switch (activeItem)` block in
`PriestDashboard.jsx`, plus a matching item in
`frontend/src/data/priestSidebarData.js` and a route in `App.jsx`.

### Dark mode
Provided by `ThemeContext` and toggled through `PriestTopbar`. `PriestLayout`
applies the `dark` class and the section components receive a `darkMode` prop.

### Responsive design
Single-column on mobile, 2–3 columns on tablet, full multi-column on desktop.
The sidebar collapses and has a mobile drawer.

## Styling details

Tailwind classes used by the shell and cards:
- `bg-[#f5f3ef]` — light background
- `bg-[#0f172a]` — dark background
- `border-[#ece8e1]` — light border
- `border-[#374151]` — dark border
- `text-[#1d1b19]` — light text
- `text-slate-100` — dark text

`PriestDashboard.css` also defines `.stat-card`, `.schedule-table`,
`.status-badge`, `.quick-action-btn`, and `.fade-in`, plus a `.dark-mode`
variant set. Note that the components primarily use Tailwind utilities; the
CSS classes are supplementary.

## Security considerations

1. `/priest/*` routes are wrapped in `ProtectedRoute`.
2. The backend applies `authenticate` and `authorizeRoles("priest")` to the
   entire priest router, so role checks cannot be bypassed by calling the API directly.
3. The backend derives priest identity from the JWT rather than trusting a
   client-supplied `priestId`, so one priest cannot read another's schedule or duties.
4. API calls include the bearer token via the `priestService` helper.

## Future enhancements

1. Real-time notifications (WebSocket)
2. Charts and analytics for priest performance
3. Expanded task assignment and tracking
4. Deeper leave-management integration
5. Performance and duty reports
6. Personal dashboard preferences

## Troubleshooting

**Dashboard not showing the priest name**
Verify `useAuth()` supplies user data from the persisted session.

**Data not loading**
Check the browser console and confirm the backend is running on port 5000 and
that the JWT is present and unexpired.

**Styling broken**
Confirm Tailwind is configured (`frontend/tailwind.config.js`,
`frontend/postcss.config.js`).

**Dark mode not working**
Confirm `ThemeProvider` wraps the app and `useTheme()` resolves; check that
`PriestLayout` applies the `dark` class.

**Redirected away from `/priest`**
`ProtectedRoute` redirects non-priest roles. Confirm the logged-in account has
`role: "priest"` and an active status.

## File references

- `frontend/src/pages/priest/PriestDashboard.jsx`
- `frontend/src/pages/priest/PriestDashboard.css`
- `frontend/src/services/priestService.js`
- `frontend/src/layouts/PriestLayout.jsx`
- `frontend/src/components/common/PriestSidebar.jsx`, `PriestTopbar.jsx`
- `frontend/src/data/priestSidebarData.js`
- `frontend/src/App.jsx`
- `frontend/src/context/AuthContext.jsx`, `ThemeContext.jsx`
- `frontend/src/components/common/ProtectedRoute.jsx`
- `backend/src/routes/priestRoutes.js`
- `backend/src/controllers/priestController.js`