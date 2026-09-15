# Temple Billing System - TODO

## Booking 500 Internal Server Error (Devotee) — resolved

All items below have been implemented in `backend/src/controllers/devoteeController.js`
(`createBooking`). Kept for reference.

- [x] Add server-side error details for devotee booking creation (log actual error, return message).
      The `catch` block logs the full error and responds with
      `"Unable to create booking. Details: " + (error.message || error)`.
- [x] Make booking creation resilient to notification/bill failures by not failing the whole request.
      `createLedgerBill` swallows and warns; `createStaffNotification` and
      `sendBookingConfirmation` are `.catch()`-guarded; event aggregation runs in
      its own `try/catch`.
- [x] Align devotee booking API payload validation with Booking model requirements.
      `amount` must be a positive number, `datetime` must parse to a future
      time, and `paymentMethod` (when supplied) must be one of `UPI`, `Cash`,
      `Card`, `Bank Transfer`, `Net Banking`.
- [ ] (Optional) Add frontend payload normalization for `createDevoteeBooking`.
      Not done — `frontend/src/services/devoteeService.js` posts the payload
      as-is, so validation currently happens server-side only.
- [ ] Run backend tests: create booking request and verify a 201 response.
      Requires a test database; see `docs/postgres-migration.md` for setup.
