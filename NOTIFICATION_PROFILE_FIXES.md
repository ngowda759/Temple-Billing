# Devotee Notifications & Profile

This document describes how devotee notification scoping and profile display
actually work. It supersedes the earlier "bug fixes" write-up, whose code samples
no longer matched the implementation.

## 1. Notification scoping

Devotees see their **own** notifications plus general broadcast announcements
addressed to the devotee audience. They do **not** see other devotees'
notifications.

The filter lives in `getNotifications` in
`backend/src/controllers/devoteeController.js`:

```js
const filters = [
  buildEmailLookup("audienceEmail", email),
  // General broadcast announcements not addressed to an individual devotee
  {
    audienceRole: { $in: ["devotee", "all"] },
    audienceEmail: { $in: [null, "", undefined] },
    audienceId: { $in: [null, "", undefined] },
  },
];

if (userId) {
  filters.push({ audienceId: userId });
}

const notifications = await Notification.find({ $or: filters }).sort({ createdAt: -1 });
```

Key points the earlier document got wrong:

- It is **not** a strict `audienceEmail: email` equality filter. It is an `$or`
  across personal email, personal user id, and devotee-audience broadcasts.
- The email match uses `buildEmailLookup` (`backend/src/utils/email.js`), which
  expands an address to aliases. A legacy `@temple.local` address is canonicalised
  to `@gmail.com`, and lookups match both forms via `{ $in: [...] }`.
- When **no** email is supplied, the endpoint returns only the general broadcasts —
  it does not return every notification in the system.
- When MongoDB is unavailable, it falls back to
  `backend/src/store/fileNotificationStore.js`, which filters the local
  `backend/src/data/notifications.json` file by `audienceEmail`.

`audienceRole`, `audienceEmail`, and `audienceId` are all declared on the
`Notification` model (`backend/src/models/Notification.js`), along with
`viewed`/`viewedAt` and `read`/`readAt` flags.

## 2. Profile display and editing

`frontend/src/components/DevoteeProfile.jsx` loads the devotee's details from
`GET /api/devotee/profile?email=...` and keeps them in state:

```jsx
const [profile, setProfile] = useState({
  id: "",
  name: "",
  email: "",
  phone: "",
  address: "",
  place: "",
  memberSince: "",
});
```

Supported behaviour:

- ✏️ "Edit Profile" enables editing
- 📝 Editable fields: Name, Email, Phone, Address, Place
- 💾 "Save Changes" calls `PUT /api/devotee/profile` and shows a success message
- ❌ "Cancel" exits edit mode without saving
- 🔴 Client-side validation with per-field error messages
- 🔒 `Member Since` is read-only
- Separate `loading` and `saving` states

Validation rules enforced in the component:

| Field | Rule |
|---|---|
| Email | matches a standard email pattern |
| Phone | exactly 10 digits, numbers only |
| Address | non-empty |
| Place | letters and spaces only |

## 3. Notification channels shown in the profile

The profile displays where notifications will be delivered:

```
🔔 Your Notification Channels

📧 Email: john@example.com
📱 SMS/WhatsApp: +919876543210
```

> Note: email delivery is real (Nodemailer). SMS delivery is currently a
> logging stub — see `sendSMS` in `backend/src/utils/communicationService.js`.
> The profile labels the channel as SMS/WhatsApp; no WhatsApp integration exists.

## Security properties

- Each devotee can only retrieve notifications addressed to their email, their
  user id, or the general devotee audience.
- Email lookups are normalised (trimmed, lowercased) before matching, and legacy
  domain aliases are handled explicitly.
- Phone, address, and place are validated on both the client and the server.
- `getNotifications` returns generic error messages and logs details server-side.

## Testing checklist

- [ ] Register as a new devotee with all details
- [ ] View profile — all details displayed
- [ ] Click Edit Profile — fields become editable
- [ ] Update a field and save, then confirm the success message
- [ ] Reload and confirm the updated data persisted
- [ ] Make a booking and confirm a notification appears
- [ ] Confirm general broadcast announcements are visible
- [ ] Register a second devotee; confirm the first devotee's view is unchanged
- [ ] Confirm the first devotee never sees the second devotee's personal notifications
- [ ] Make a donation; confirm the receipt email is sent only to the donor's address

## Files involved

**Backend**
- `src/controllers/devoteeController.js` — `getNotifications`, `getProfile`, `updateProfile`
- `src/utils/email.js` — `normalizeEmail`, `getEmailAliases`, `buildEmailLookup`
- `src/models/Notification.js` — notification schema
- `src/store/fileNotificationStore.js` — offline fallback store

**Frontend**
- `src/components/DevoteeProfile.jsx` — profile display and editing