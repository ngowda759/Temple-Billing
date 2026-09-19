const { query, getPool } = require("../config/postgres");
const dbConfig = require("../config/db");
const Booking = require("../models/Booking");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/Booking.js.
const PAYMENT_METHODS = new Set(["UPI", "Cash", "Card", "Bank Transfer", "Net Banking"]);
const PAYMENT_STATUSES = new Set(["Pending", "Paid", "Failed", "Refunded"]);
const STATUSES = new Set([
  "Booked", "Pending", "Approved", "Confirmed", "Assigned", "In Progress",
  "Completed", "Rejected", "Cancelled", "Upcoming", "Transfer Requested", "Transferred",
]);
const MATERIAL_STATUSES = new Set([
  "N/A", "Pending Approval", "Approved", "Ready for Collection", "Issued",
  "Acknowledged", "Consumed", "Cancelled", "Pending", "Reserved", "Ready",
]);

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

const assertEnumOrArray = (value, allowed, label) => {
  if (value === undefined || value === null) return;
  for (const item of Array.isArray(value) ? value : [value]) {
    assertEnum(item, allowed, label);
  }
};

const assertAmount = (amount) => {
  if (amount === undefined || amount === null) return;
  const num = Number(amount);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid amount: ${amount}. Amount must be a number >= 0 (Mongo schema min: 0).`);
  }
};

const assertDevoteeName = (devoteeName) => {
  if (devoteeName === undefined || devoteeName === null || String(devoteeName).trim() === "") {
    throw new Error("devoteeName is required");
  }
};

const assertService = (service) => {
  if (service === undefined || service === null || String(service).trim() === "") {
    throw new Error("service is required");
  }
};

const assertDatetime = (datetime) => {
  if (datetime === undefined || datetime === null || String(datetime).trim() === "") {
    throw new Error("datetime is required");
  }
};

const BOOKING_COLS = [
  "id", "devotee_id", "event_id", "devotee_name", "devotee_email", "devotee_phone",
  "service", "datetime", "amount", "gst", "payment_method", "payment_status",
  "transaction_id", "razorpay_order_id", "razorpay_payment_id", "razorpay_signature",
  "booking_number", "status", "contact_number", "notes", "counted", "assigned_priest",
  "priest_name", "started_at", "completed_at", "completion_remarks", "completion_duration",
  "approved_at", "rejected_at", "rejection_reason", "pending_reason", "pending_at",
  "temple_approval_required", "days", "checkin_date", "checkout_date",
  "temple_arrangement", "temple_material_charge", "material_status",
  "preparation_acknowledged", "priest_checklist", "pooja_duration", "pooja_rules",
  "pooja_dress_code", "priest_instructions", "snapshot_materials", "completed_by",
  "is_combined", "created_at", "updated_at",
];

const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    devoteeId: row.devotee_id || undefined,
    eventId: row.event_id || undefined,
    devoteeName: row.devotee_name,
    devoteeEmail: row.devotee_email || undefined,
    devoteePhone: row.devotee_phone || undefined,
    service: row.service,
    // datetime is TEXT in PostgreSQL (the Mongo String field) — pass it through
    // verbatim so `2026-09-10T06:30:00.000Z` and `2026-09-10T06:30` round-trip.
    datetime: row.datetime,
    amount: row.amount === null || row.amount === undefined ? undefined : Number(row.amount),
    gst: row.gst === null || row.gst === undefined ? 0 : Number(row.gst),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    transactionId: row.transaction_id,
    razorpayOrderId: row.razorpay_order_id || undefined,
    razorpayPaymentId: row.razorpay_payment_id || undefined,
    razorpaySignature: row.razorpay_signature || undefined,
    bookingNumber: row.booking_number || undefined,
    status: row.status,
    contactNumber: row.contact_number || undefined,
    notes: row.notes || undefined,
    counted: row.counted,
    assignedPriest: row.assigned_priest || undefined,
    priestName: row.priest_name,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
    completionRemarks: row.completion_remarks,
    completionDuration: Number(row.completion_duration),
    approvedAt: row.approved_at || undefined,
    rejectedAt: row.rejected_at || undefined,
    rejectionReason: row.rejection_reason,
    pendingReason: row.pending_reason || undefined,
    pendingAt: row.pending_at || undefined,
    templeApprovalRequired: row.temple_approval_required,
    days: row.days === null || row.days === undefined ? undefined : Number(row.days),
    checkinDate: row.checkin_date || undefined,
    checkoutDate: row.checkout_date || undefined,
    templeArrangement: row.temple_arrangement,
    templeMaterialCharge: row.temple_material_charge === null || row.temple_material_charge === undefined ? 0 : Number(row.temple_material_charge),
    materialStatus: row.material_status,
    preparationAcknowledged: row.preparation_acknowledged,
    priestChecklist: row.priest_checklist || {},
    poojaDuration: row.pooja_duration,
    poojaRules: row.pooja_rules || [],
    poojaDressCode: row.pooja_dress_code,
    priestInstructions: row.priest_instructions || "",
    snapshotMaterials: row.snapshot_materials || [],
    completedBy: row.completed_by,
    isCombined: row.is_combined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const attachChildren = async (doc) => {
  if (!doc) return doc;
  const [history, materials, items] = await Promise.all([
    historyRepository.findByBookingId(doc._id),
    materialRepository.findByBookingId(doc._id),
    itemRepository.findByBookingId(doc._id),
  ]);
  doc.bookingHistory = history;
  doc.templeMaterialRequests = materials;
  doc.items = items;
  return doc;
};

const toRow = (data, id = newId()) => ({
  id,
  devotee_id: data.devoteeId ? String(data.devoteeId) : null,
  event_id: data.eventId ? String(data.eventId) : null,
  devotee_name: String(data.devoteeName || "").trim(),
  devotee_email: data.devoteeEmail ? String(data.devoteeEmail).trim().toLowerCase() : null,
  devotee_phone: data.devoteePhone ? String(data.devoteePhone).trim() : null,
  service: String(data.service || "").trim(),
  // The Mongo schema declares `trim: true` for datetime; the value itself stays
  // text so the exact ISO form the callers wrote round-trips.
  datetime: data.datetime === undefined || data.datetime === null ? null : String(data.datetime).trim(),
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  amount: data.amount,
  gst: data.gst ?? 0,
  payment_method: data.paymentMethod || "UPI",
  payment_status: data.paymentStatus || "Paid",
  transaction_id: data.transactionId || "",
  razorpay_order_id: data.razorpayOrderId ? String(data.razorpayOrderId).trim() : null,
  razorpay_payment_id: data.razorpayPaymentId ? String(data.razorpayPaymentId).trim() : null,
  razorpay_signature: data.razorpaySignature ? String(data.razorpaySignature).trim() : null,
  booking_number: data.bookingNumber ? String(data.bookingNumber).trim() : null,
  status: data.status || "Completed",
  contact_number: data.contactNumber ? String(data.contactNumber).trim() : null,
  notes: data.notes === undefined || data.notes === null ? null : String(data.notes).trim(),
  counted: data.counted ?? false,
  assigned_priest: data.assignedPriest ? String(data.assignedPriest) : null,
  priest_name: data.priestName || "",
  started_at: data.startedAt || null,
  completed_at: data.completedAt || null,
  completion_remarks: data.completionRemarks || "",
  completion_duration: data.completionDuration ?? 0,
  approved_at: data.approvedAt || null,
  rejected_at: data.rejectedAt || null,
  rejection_reason: data.rejectionReason || "",
  pending_reason: data.pendingReason ? String(data.pendingReason).trim() : null,
  pending_at: data.pendingAt || null,
  temple_approval_required: data.templeApprovalRequired ?? false,
  days: data.days === undefined || data.days === null ? null : data.days,
  checkin_date: data.checkinDate || null,
  checkout_date: data.checkoutDate || null,
  temple_arrangement: data.templeArrangement ?? false,
  temple_material_charge: data.templeMaterialCharge ?? 0,
  material_status: data.materialStatus || "N/A",
  preparation_acknowledged: data.preparationAcknowledged ?? false,
  // JSONB columns must be JSON strings so the pg driver binds them correctly.
  priest_checklist: JSON.stringify(data.priestChecklist || {}),
  pooja_duration: data.poojaDuration || "",
  pooja_rules: Array.isArray(data.poojaRules) ? data.poojaRules : [],
  pooja_dress_code: data.poojaDressCode || "",
  // devoteeController joins priestInstructions into one string before saving;
  // tolerate an array input (the Mongoose [String] shape) by joining it.
  priest_instructions: Array.isArray(data.priestInstructions)
    ? data.priestInstructions.join("\n")
    : (data.priestInstructions || ""),
  // JSONB column — stringified below.
  snapshot_materials: JSON.stringify(Array.isArray(data.snapshotMaterials) ? data.snapshotMaterials : []),
  completed_by: data.completedBy || "",
  is_combined: data.isCombined ?? false,
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns:
// getAllBookings/getBookings/dashboard sort by createdAt DESC,
// getAssignedPoojas sorts by datetime ASC, getCompletedBookings sorts by
// completedAt + createdAt, and findMany opens the door to amount-based sorting.
const SORT_COLUMNS = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  datetime: "datetime",
  completedAt: "completed_at",
  amount: "amount",
  bookingNumber: "booking_number",
  status: "status",
  assignedPriest: "assigned_priest",
};

const resolveOrderBy = (sort) => {
  const defaultOrder = "created_at DESC";
  let key; let direction;
  if (typeof sort === "string") {
    key = sort; direction = 1;
  } else {
    const entry = Object.entries(sort || {})[0] || [];
    key = entry[0]; direction = entry[1];
  }
  const col = SORT_COLUMNS[key];
  if (!col) return defaultOrder;
  const dir = direction === "DESC" || Number(direction) === -1 ? "DESC" : (direction === "ASC" || Number(direction) === 1 ? "ASC" : null);
  if (!dir) return defaultOrder;
  return `${col} ${dir}`;
};

// Normalizes a search string like the Mongo controllers do:
// getAllBookings searches devoteeName/service/devoteePhone/bookingNumber (+ id
// prefix); priest flows search devoteeName/service (+ exact ObjectId). A
// flexible ILIKE-based term is used (parameterized) to preserve both behaviours.
const buildSearch = (search, values) => {
  const term = String(search || "").trim();
  if (!term) return null;
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const paramIdx = values.length + 1;
  const like = `%${escaped}%`;
  const sql = `(devotee_name ILIKE $${paramIdx} ESCAPE '\\' OR service ILIKE $${paramIdx} ESCAPE '\\'
    OR COALESCE(devotee_phone, '') ILIKE $${paramIdx} ESCAPE '\\'
    OR COALESCE(booking_number, '') ILIKE $${paramIdx} ESCAPE '\\'
    OR id ILIKE $${paramIdx} ESCAPE '\\')`;
  return { sql, param: like };
};

const buildBookingFilter = (filter = {}) => {
  const conditions = [];
  const values = [];
  const pushCond = (col, op, value) => {
    conditions.push(`${col} ${op} $${values.length + 1}`);
    values.push(value);
  };
  const pushIn = (col, list) => {
    const vals = (Array.isArray(list) ? list : [list])
      .filter((v) => v !== undefined && v !== null)
      .map((v) => String(v));
    if (vals.length) {
      conditions.push(`${col} IN (${vals.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
      values.push(...vals);
    }
  };

  // Status $in before plain equality (Mongo operators only apply to status).
  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    assertEnumOrArray(filter.status.$in, STATUSES, "status.$in");
    pushIn("status", filter.status.$in);
  } else {
    assertEnum(filter.status, STATUSES, "status");
    if (filter.status) pushCond("status", "=", filter.status);
  }

  assertEnum(filter.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(filter.paymentStatus, PAYMENT_STATUSES, "paymentStatus");
  assertEnum(filter.materialStatus, MATERIAL_STATUSES, "materialStatus");

  if (filter.paymentMethod) pushCond("payment_method", "=", filter.paymentMethod);
  if (filter.paymentStatus) pushCond("payment_status", "=", filter.paymentStatus);
  if (filter.materialStatus) pushCond("material_status", "=", filter.materialStatus);
  if (filter.service) pushCond("service", "=", filter.service);
  if (filter.counted !== undefined && filter.counted !== null) pushCond("counted", "=", Boolean(filter.counted));
  if (filter.isCombined !== undefined && filter.isCombined !== null) pushCond("is_combined", "=", Boolean(filter.isCombined));
  if (filter.bookingNumber) pushCond("booking_number", "=", String(filter.bookingNumber).trim());
  if (filter.razorpayOrderId) pushCond("razorpay_order_id", "=", String(filter.razorpayOrderId).trim());

  // Mongo-style { devoteeEmail: { $in: [...] } } (buildEmailLookup aliases).
  if (typeof filter.devoteeEmail === "object" && !Array.isArray(filter.devoteeEmail) && filter.devoteeEmail.$in) {
    pushIn("devotee_email", filter.devoteeEmail.$in.map((v) => String(v).trim().toLowerCase()));
  } else if (filter.devoteeEmail) {
    pushCond("devotee_email", "=", String(filter.devoteeEmail).trim().toLowerCase());
  }

  // Devotee id/phone exact filters (devoteeController: getBookings by email;
  // admin/priest rows also use these).
  if (filter.devoteeName) pushCond("devotee_name", "=", String(filter.devoteeName).trim());
  if (typeof filter.devoteePhone === "object" && !Array.isArray(filter.devoteePhone) && filter.devoteePhone.$in) {
    pushIn("devotee_phone", filter.devoteePhone.$in);
  } else if (filter.devoteePhone) {
    pushCond("devotee_phone", "=", String(filter.devoteePhone).trim());
  }

  // $in / array-style id filters (assignedPriest $in, eventId $in, devoteeId $in).
  if (typeof filter.assignedPriest === "object" && !Array.isArray(filter.assignedPriest) && filter.assignedPriest.$in) {
    pushIn("assigned_priest", filter.assignedPriest.$in);
  } else if (filter.assignedPriest) {
    pushCond("assigned_priest", "=", String(filter.assignedPriest));
  }
  if (typeof filter.eventId === "object" && !Array.isArray(filter.eventId) && filter.eventId.$in) {
    pushIn("event_id", filter.eventId.$in);
  } else if (filter.eventId) {
    pushCond("event_id", "=", String(filter.eventId));
  }
  if (typeof filter.devoteeId === "object" && !Array.isArray(filter.devoteeId) && filter.devoteeId.$in) {
    pushIn("devotee_id", filter.devoteeId.$in);
  } else if (filter.devoteeId) {
    pushCond("devotee_id", "=", String(filter.devoteeId));
  }

  // Admin list date presets: dateRange Today / Last 7 Days / This Month map to
  // createdAt range filters; Upcoming maps to a status set (handled above as
  // status $in by getAllBookings).
  const dateRange = filter.createdAt || {};
  const rangeGte = dateRange.$gte ?? filter.dateFrom;
  const rangeLte = dateRange.$lte ?? filter.dateTo;
  if (rangeGte) pushCond("created_at", ">=", new Date(rangeGte));
  if (rangeLte) pushCond("created_at", "<=", new Date(rangeLte));

  // completedAt range for the priest completed-services history.
  const completedRange = filter.completedAt || {};
  const cGte = completedRange.$gte ?? filter.completedFrom;
  const cLte = completedRange.$lte ?? filter.completedTo;
  if (cGte) pushCond("completed_at", ">=", new Date(cGte));
  if (cLte) pushCond("completed_at", "<=", new Date(cLte));

  if (filter.statusIn) {
    assertEnumOrArray(filter.statusIn, STATUSES, "statusIn");
    pushIn("status", filter.statusIn);
  }

  if (filter.search) {
    const built = buildSearch(filter.search, values);
    if (built) {
      conditions.push(built.sql);
      values.push(built.param);
    }
  }

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id) => {
  if (!id) return null;
  if (dbConfig.isDbConnected()) {
    const { rows } = await query(`SELECT ${BOOKING_COLS.join(", ")} FROM bookings WHERE id = $1 LIMIT 1`, [String(id)]);
    return await attachChildren(toDoc(rows[0]));
  }
  return Booking.findById(String(id));
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Booking.findOne(filter);
  const { where, values } = buildBookingFilter(filter);
  if (!where) return null;
  const { rows } = await query(`SELECT ${BOOKING_COLS.join(", ")} FROM bookings ${where} ORDER BY created_at DESC, id DESC LIMIT 1`, values);
  return await attachChildren(toDoc(rows[0]));
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Booking.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildBookingFilter(filter);
  const orderBy = resolveOrderBy(sort);
  // Append id as a stable final tiebreaker so repeated pagination never
  // skips or repeats rows with identical sort values.
  const finalOrder = `${orderBy}, id DESC`;
  let sql = `SELECT ${BOOKING_COLS.join(", ")} FROM bookings ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return Promise.all(rows.map(async (row) => attachChildren(toDoc(row))));
};

// Child repositories (normalized embedded arrays). Kept here so the booking
// repository owns the booking write/read path but each child has clear methods.
const historyRepository = {
  findByBookingId: async (bookingId) => {
    if (!bookingId) return [];
    const { rows } = await query(
      `SELECT id, previous_status, new_status, updated_by, note, updated_at
       FROM booking_history WHERE booking_id = $1 ORDER BY position ASC, id ASC`,
      [String(bookingId)]
    );
    return rows.map((r) => ({
      _id: r.id,
      id: r.id,
      previousStatus: r.previous_status || undefined,
      newStatus: r.new_status,
      updatedBy: r.updated_by,
      note: r.note,
      updatedAt: r.updated_at,
    }));
  },
  replace: async (client, bookingId, entries = []) => {
    await client.query("DELETE FROM booking_history WHERE booking_id = $1", [String(bookingId)]);
    for (const [index, entry] of entries.entries()) {
      if (!entry || typeof entry !== "object") continue;
      await client.query(
        `INSERT INTO booking_history (id, booking_id, position, previous_status, new_status, updated_by, note, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          entry.id || newId(), String(bookingId), index,
          entry.previousStatus ?? null, entry.newStatus ?? null,
          entry.updatedBy ?? "Admin", entry.note ?? "",
          entry.updatedAt || new Date(),
        ]
      );
    }
  },
};

const materialRepository = {
  findByBookingId: async (bookingId) => {
    if (!bookingId) return [];
    const { rows } = await query(
      `SELECT id, item, item_name, qty, inventory_request_id
       FROM booking_material_requests WHERE booking_id = $1 ORDER BY position ASC, id ASC`,
      [String(bookingId)]
    );
    return rows.map((r) => ({
      _id: r.id,
      id: r.id,
      item: r.item || undefined,
      itemName: r.item_name || undefined,
      qty: r.qty || undefined,
      inventoryRequestId: r.inventory_request_id || undefined,
    }));
  },
  replace: async (client, bookingId, entries = []) => {
    await client.query("DELETE FROM booking_material_requests WHERE booking_id = $1", [String(bookingId)]);
    for (const [index, entry] of entries.entries()) {
      if (!entry || typeof entry !== "object") continue;
      await client.query(
        `INSERT INTO booking_material_requests (id, booking_id, position, item, item_name, qty, inventory_request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          entry.id || newId(), String(bookingId), index,
          entry.item ? String(entry.item) : null,
          entry.itemName ?? null,
          entry.qty ? String(entry.qty) : null,
          entry.inventoryRequestId ? String(entry.inventoryRequestId) : null,
        ]
      );
    }
  },
};

const itemRepository = {
  findByBookingId: async (bookingId) => {
    if (!bookingId) return [];
    const { rows } = await query(
      `SELECT id, item_type, item_name, description, quantity, price, amount, date, data
       FROM booking_items WHERE booking_id = $1 ORDER BY position ASC, id ASC`,
      [String(bookingId)]
    );
    return rows.map(toItem);
  },
  replace: async (client, bookingId, entries = []) => {
    await client.query("DELETE FROM booking_items WHERE booking_id = $1", [String(bookingId)]);
    for (const [index, entry] of entries.entries()) {
      if (!entry || typeof entry !== "object") continue;
      const row = toItemRow(entry, index);
      await client.query(
        `INSERT INTO booking_items (id, booking_id, position, item_type, item_name, description, quantity, price, amount, date, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [row.id, String(bookingId), row.position, row.item_type, row.item_name, row.description,
         row.quantity, row.price, row.amount, row.date, row.data]
      );
    }
  },
};

const toItem = (row) => {
  if (!row) return null;
  const base = {
    _id: row.id,
    id: row.id,
    itemType: row.item_type || undefined,
    itemName: row.item_name || undefined,
    description: row.description || undefined,
    quantity: row.quantity === null || row.quantity === undefined ? undefined : Number(row.quantity),
    price: row.price === null || row.price === undefined ? undefined : Number(row.price),
    amount: row.amount === null || row.amount === undefined ? undefined : Number(row.amount),
    date: row.date || undefined,
  };
  // Re-attach fields persisted via the catch-all JSONB data column (type, name,
  // service, selectedTempleMaterials and any other Mongo mixed fields), without
  // overriding the typed columns above.
  const extra = row.data && typeof row.data === "object" ? row.data : {};
  const typed = new Set(["_id", "id", "itemType", "itemName", "description", "quantity", "price", "amount", "date"]);
  for (const [key, value] of Object.entries(extra)) {
    if (!typed.has(key)) base[key] = value;
  }
  return base;
};

const toItemRow = (entry, position = 0) => {
  const { itemType, itemName, description, quantity, price, amount, date, type, name, service, selectedTempleMaterials, ...rest } = entry || {};
  const data = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) data[key] = value;
  }
  // Keep the fields the receipt generator and PoojaManagement actually read in
  // their Mongo-embedded shapes too.
  if (type !== undefined) data.type = type;
  if (name !== undefined) data.name = name;
  if (service !== undefined) data.service = service;
  if (selectedTempleMaterials !== undefined) data.selectedTempleMaterials = selectedTempleMaterials;
  return {
    id: entry.id || newId(),
    position,
    item_type: itemType ?? null,
    item_name: itemName ?? null,
    description: description ?? null,
    quantity: quantity === undefined || quantity === null ? null : quantity,
    price: price === undefined || price === null ? null : price,
    amount: amount === undefined || amount === null ? null : amount,
    date: date === undefined || date === null ? null : String(date),
    data,
  };
};

const normalizeItemsArray = (items) => {
  if (items === undefined || items === null) return [];
  return (Array.isArray(items) ? items : [items]).filter((item) => item && typeof item === "object");
};

/**
 * Creates a booking together with its normalized child rows (booking_history,
 * booking_material_requests, booking_items) inside a single PostgreSQL
 * transaction. Either the booking row and every child row persist, or none do.
 */
const create = async (data) => {
  assertDevoteeName(data.devoteeName);
  assertService(data.service);
  assertDatetime(data.datetime);
  assertAmount(data.amount);
  assertAmount(data.gst);
  assertAmount(data.templeMaterialCharge);
  assertEnum(data.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(data.paymentStatus, PAYMENT_STATUSES, "paymentStatus");
  assertEnum(data.status, STATUSES, "status");
  assertEnum(data.materialStatus, MATERIAL_STATUSES, "materialStatus");

  const historyEntries = Array.isArray(data.bookingHistory) ? data.bookingHistory : [];
  const materialEntries = Array.isArray(data.templeMaterialRequests) ? data.templeMaterialRequests : [];
  const itemEntries = normalizeItemsArray(data.items);

  if (!dbConfig.isDbConnected()) {
    return Booking.create(data);
  }

  const id = data.id || newId();
  const row = toRow(data, id);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO bookings (${BOOKING_COLS.join(", ")})
       VALUES (${BOOKING_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING`,
      BOOKING_COLS.map((col) => row[col])
    );
    await historyRepository.replace(client, id, historyEntries);
    await materialRepository.replace(client, id, materialEntries);
    await itemRepository.replace(client, id, itemEntries);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return findById(id);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  assertEnum(updates.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(updates.paymentStatus, PAYMENT_STATUSES, "paymentStatus");
  assertEnum(updates.status, STATUSES, "status");
  assertEnum(updates.materialStatus, MATERIAL_STATUSES, "materialStatus");
  if (updates.amount !== undefined) assertAmount(updates.amount);
  if (updates.gst !== undefined) assertAmount(updates.gst);
  if (updates.templeMaterialCharge !== undefined) assertAmount(updates.templeMaterialCharge);

  if (!dbConfig.isDbConnected()) {
    return Booking.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
  }

  const existing = await findById(id);
  if (!existing?._id) return null;

  const fields = [];
  const values = [];
  const apply = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value);
    }
  };

  if (updates.devoteeId !== undefined) apply("devotee_id", updates.devoteeId ? String(updates.devoteeId) : null);
  if (updates.eventId !== undefined) apply("event_id", updates.eventId ? String(updates.eventId) : null);
  if (updates.devoteeName !== undefined) apply("devotee_name", String(updates.devoteeName).trim());
  if (updates.devoteeEmail !== undefined) apply("devotee_email", updates.devoteeEmail ? String(updates.devoteeEmail).trim().toLowerCase() : null);
  if (updates.devoteePhone !== undefined) apply("devotee_phone", updates.devoteePhone ? String(updates.devoteePhone).trim() : null);
  if (updates.service !== undefined) apply("service", String(updates.service).trim());
  if (updates.datetime !== undefined) apply("datetime", updates.datetime === undefined || updates.datetime === null ? null : String(updates.datetime).trim());
  if (updates.amount !== undefined) apply("amount", updates.amount);
  if (updates.gst !== undefined) apply("gst", updates.gst ?? 0);
  if (updates.paymentMethod !== undefined) apply("payment_method", updates.paymentMethod || "UPI");
  if (updates.paymentStatus !== undefined) apply("payment_status", updates.paymentStatus || "Paid");
  if (updates.transactionId !== undefined) apply("transaction_id", updates.transactionId || "");
  if (updates.razorpayOrderId !== undefined) apply("razorpay_order_id", updates.razorpayOrderId ? String(updates.razorpayOrderId).trim() : null);
  if (updates.razorpayPaymentId !== undefined) apply("razorpay_payment_id", updates.razorpayPaymentId ? String(updates.razorpayPaymentId).trim() : null);
  if (updates.razorpaySignature !== undefined) apply("razorpay_signature", updates.razorpaySignature ? String(updates.razorpaySignature).trim() : null);
  if (updates.bookingNumber !== undefined) apply("booking_number", updates.bookingNumber ? String(updates.bookingNumber).trim() : null);
  if (updates.status !== undefined) apply("status", updates.status || "Completed");
  if (updates.contactNumber !== undefined) apply("contact_number", updates.contactNumber ? String(updates.contactNumber).trim() : null);
  if (updates.notes !== undefined) apply("notes", updates.notes === undefined || updates.notes === null ? null : String(updates.notes).trim());
  if (updates.counted !== undefined) apply("counted", Boolean(updates.counted));
  if (updates.assignedPriest !== undefined) apply("assigned_priest", updates.assignedPriest ? String(updates.assignedPriest) : null);
  if (updates.priestName !== undefined) apply("priest_name", updates.priestName || "");
  if (updates.startedAt !== undefined) apply("started_at", updates.startedAt || null);
  if (updates.completedAt !== undefined) apply("completed_at", updates.completedAt || null);
  if (updates.completionRemarks !== undefined) apply("completion_remarks", updates.completionRemarks || "");
  if (updates.completionDuration !== undefined) apply("completion_duration", updates.completionDuration ?? 0);
  if (updates.approvedAt !== undefined) apply("approved_at", updates.approvedAt || null);
  if (updates.rejectedAt !== undefined) apply("rejected_at", updates.rejectedAt || null);
  if (updates.rejectionReason !== undefined) apply("rejection_reason", updates.rejectionReason || "");
  if (updates.pendingReason !== undefined) apply("pending_reason", updates.pendingReason ? String(updates.pendingReason).trim() : null);
  if (updates.pendingAt !== undefined) apply("pending_at", updates.pendingAt || null);
  if (updates.templeApprovalRequired !== undefined) apply("temple_approval_required", Boolean(updates.templeApprovalRequired));
  if (updates.days !== undefined) apply("days", updates.days === undefined || updates.days === null ? null : updates.days);
  if (updates.checkinDate !== undefined) apply("checkin_date", updates.checkinDate || null);
  if (updates.checkoutDate !== undefined) apply("checkout_date", updates.checkoutDate || null);
  if (updates.templeArrangement !== undefined) apply("temple_arrangement", Boolean(updates.templeArrangement));
  if (updates.templeMaterialCharge !== undefined) apply("temple_material_charge", updates.templeMaterialCharge ?? 0);
  if (updates.materialStatus !== undefined) apply("material_status", updates.materialStatus || "N/A");
  if (updates.preparationAcknowledged !== undefined) apply("preparation_acknowledged", Boolean(updates.preparationAcknowledged));
  // JSONB / PG-array columns must be stringified so the node-pg driver does not
  // try to bind a JS object/array as a single parameter.
  if (updates.priestChecklist !== undefined) apply("priest_checklist", JSON.stringify(updates.priestChecklist || {}));
  if (updates.poojaDuration !== undefined) apply("pooja_duration", updates.poojaDuration || "");
  if (updates.poojaRules !== undefined) apply("pooja_rules", Array.isArray(updates.poojaRules) ? updates.poojaRules : []);
  if (updates.poojaDressCode !== undefined) apply("pooja_dress_code", updates.poojaDressCode || "");
  if (updates.priestInstructions !== undefined) {
    apply("priest_instructions", Array.isArray(updates.priestInstructions)
      ? updates.priestInstructions.join("\n")
      : (updates.priestInstructions || ""));
  }
  if (updates.snapshotMaterials !== undefined) apply("snapshot_materials", JSON.stringify(Array.isArray(updates.snapshotMaterials) ? updates.snapshotMaterials : []));
  if (updates.completedBy !== undefined) apply("completed_by", updates.completedBy || "");
  if (updates.isCombined !== undefined) apply("is_combined", Boolean(updates.isCombined));

  // Child arrays: when provided, replace the normalized rows atomically.
  const replaceHistory = updates.bookingHistory !== undefined && dbConfig.isDbConnected();
  const replaceMaterials = updates.templeMaterialRequests !== undefined && dbConfig.isDbConnected();
  const replaceItems = updates.items !== undefined && dbConfig.isDbConnected();

  if (values.length === 0 && !replaceHistory && !replaceMaterials && !replaceItems) {
    return existing;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (values.length > 0) {
      fields.push(`updated_at = now()`);
      values.push(id);
      await client.query(`UPDATE bookings SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
    }
    if (replaceHistory) {
      await historyRepository.replace(client, id, Array.isArray(updates.bookingHistory) ? updates.bookingHistory : []);
    }
    if (replaceMaterials) {
      await materialRepository.replace(client, id, Array.isArray(updates.templeMaterialRequests) ? updates.templeMaterialRequests : []);
    }
    if (replaceItems) {
      await itemRepository.replace(client, id, normalizeItemsArray(updates.items));
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Booking.countDocuments(filter);
  const { where, values } = buildBookingFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM bookings ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await Booking.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM bookings WHERE id = $1 RETURNING id`, [String(id)]);
  return rows.length > 0;
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  updateById,
  count,
  destroy,
};