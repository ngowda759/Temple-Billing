const { query, getPool } = require("../config/postgres");
const { isDbConnected } = require("../config/db");
const PoojaBooking = require("../models/PoojaBooking");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/PoojaBooking.js.
const PAYMENT_METHODS = new Set(["UPI", "Cash", "Card"]);
const STATUSES = new Set(["Booked", "Completed", "Cancelled"]);
const MATERIAL_STATUSES = new Set(["N/A", "Pending", "Approved", "Reserved", "Ready", "Issued", "Consumed", "Cancelled"]);

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

const assertAmount = (amount) => {
  if (amount === undefined || amount === null) return;
  const num = Number(amount);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid amount: ${amount}. Amount must be a number >= 0.`);
  }
};

const assertRequired = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
};

const assertRequiredDate = (value, label) => {
  if (value === undefined || value === null || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`${label} is required`);
  }
};

const assertCreatedBy = (createdBy) => {
  if (createdBy === undefined || createdBy === null || String(createdBy).trim() === "") {
    throw new Error("createdBy is required");
  }
};

const POOJA_BOOKING_COLS = [
  "id", "booking_number", "customer_name", "service", "amount", "payment_method",
  "contact_number", "email", "address", "notes", "booking_date", "status",
  "created_by", "temple_arrangement", "temple_material_charge", "material_status",
  "priest_checklist", "created_at", "updated_at",
];

// Converts a pooja_bookings row into the shape the application receives from
// Mongoose (camelCase, Mongo _id).
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    bookingNumber: row.booking_number,
    customerName: row.customer_name,
    service: row.service,
    amount: row.amount === null || row.amount === undefined ? undefined : Number(row.amount),
    paymentMethod: row.payment_method,
    contactNumber: row.contact_number,
    email: row.email || undefined,
    address: row.address || undefined,
    notes: row.notes,
    bookingDate: row.booking_date,
    status: row.status,
    createdBy: row.created_by,
    templeArrangement: row.temple_arrangement,
    templeMaterialCharge: row.temple_material_charge === null || row.temple_material_charge === undefined ? 0 : Number(row.temple_material_charge),
    templeMaterialRequests: undefined,
    materialStatus: row.material_status,
    priestChecklist: row.priest_checklist || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  booking_number: data.bookingNumber,
  customer_name: String(data.customerName || "").trim(),
  service: String(data.service || "").trim(),
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  amount: data.amount,
  payment_method: data.paymentMethod || "UPI",
  contact_number: data.contactNumber === undefined || data.contactNumber === null ? null : String(data.contactNumber).trim(),
  email: data.email === undefined || data.email === null || String(data.email).trim() === "" ? null : String(data.email).trim(),
  address: data.address === undefined || data.address === null || String(data.address).trim() === "" ? null : String(data.address).trim(),
  notes: data.notes || "",
  booking_date: data.bookingDate || new Date(),
  status: data.status || "Booked",
  created_by: String(data.createdBy).trim(),
  temple_arrangement: data.templeArrangement ?? false,
  temple_material_charge: data.templeMaterialCharge ?? 0,
  material_status: data.materialStatus || "N/A",
  priest_checklist: JSON.stringify(data.priestChecklist || {}),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Mirrors the Mongo pre-validate hook (PB1001 onwards): next number = highest
// existing numeric PB + 1. The Mongo hook sorts by createdAt; the numeric max is
// used here because created_at has second-level precision in PostgreSQL and the
// DB UNIQUE constraint makes a deterministic next-value selection the only safe
// choice for concurrent/back-to-back creates.
const resolveGeneratedBookingNumber = async (client) => {
  const { rows } = await client.query(
    `SELECT booking_number FROM pooja_bookings
     WHERE booking_number ~ '^PB[0-9]+$'
     ORDER BY (substring(booking_number from 3)::bigint) DESC
     LIMIT 1`
  );
  let nextNumber = 1000;
  if (rows[0]) {
    const parsed = parseInt(String(rows[0].booking_number).replace("PB", "").trim(), 10);
    if (!Number.isNaN(parsed)) nextNumber = parsed;
  }
  return `PB${nextNumber + 1}`;
};

const materialRepository = {
  findByPoojaBookingId: async (poojaBookingId) => {
    if (!poojaBookingId) return [];
    const { rows } = await query(
      `SELECT id, item, item_name, qty, unit
       FROM pooja_booking_material_requests
       WHERE pooja_booking_id = $1 ORDER BY position ASC, id ASC`,
      [String(poojaBookingId)]
    );
    return rows.map((r) => ({
      _id: r.id,
      id: r.id,
      item: r.item || undefined,
      itemName: r.item_name || undefined,
      qty: r.qty || undefined,
      unit: r.unit || undefined,
    }));
  },
  replace: async (client, poojaBookingId, entries = []) => {
    await client.query("DELETE FROM pooja_booking_material_requests WHERE pooja_booking_id = $1", [String(poojaBookingId)]);
    for (const [index, entry] of entries.entries()) {
      if (!entry || typeof entry !== "object") continue;
      await client.query(
        `INSERT INTO pooja_booking_material_requests (id, pooja_booking_id, position, item, item_name, qty, unit)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          entry.id || newId(), String(poojaBookingId), index,
          entry.item ? String(entry.item) : null,
          entry.itemName ?? null,
          entry.qty ? String(entry.qty) : null,
          entry.unit ?? null,
        ]
      );
    }
  },
};

const attachChildren = async (doc) => {
  if (!doc) return doc;
  doc.templeMaterialRequests = await materialRepository.findByPoojaBookingId(doc._id);
  return doc;
};

// Whitelisted sort columns so dynamic ordering can never inject SQL.
const SORT_COLUMNS = {
  bookingNumber: "booking_number",
  customerName: "customer_name",
  service: "service",
  amount: "amount",
  bookingDate: "booking_date",
  status: "status",
  createdAt: "created_at",
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

// Normalizes a search string like poojaBookingController.getMyBookings does:
// { $or: [customerName $regex i, service $regex i, bookingNumber $regex i] }.
// A single parameterized ILIKE term preserves the case-insensitive substring
// behaviour for all three fields.
const buildSearch = (search, values) => {
  const term = String(search || "").trim();
  if (!term) return null;
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const paramIdx = values.length + 1;
  const like = `%${escaped}%`;
  const sql = `(customer_name ILIKE $${paramIdx} ESCAPE '\\' OR service ILIKE $${paramIdx} ESCAPE '\\'
    OR booking_number ILIKE $${paramIdx} ESCAPE '\\')`;
  return { sql, param: like };
};

const buildPoojaBookingFilter = (filter = {}) => {
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
  assertEnum(filter.materialStatus, MATERIAL_STATUSES, "materialStatus");

  if (filter.createdBy) pushCond("created_by", "=", String(filter.createdBy));
  if (filter.paymentMethod) pushCond("payment_method", "=", filter.paymentMethod);
  if (filter.materialStatus) pushCond("material_status", "=", filter.materialStatus);
  if (filter.service) pushCond("service", "=", String(filter.service).trim());
  if (filter.bookingNumber) pushCond("booking_number", "=", String(filter.bookingNumber).trim());
  if (typeof filter.customerName === "object" && !Array.isArray(filter.customerName) && filter.customerName.$in) {
    pushIn("customer_name", filter.customerName.$in);
  } else if (filter.customerName) {
    pushCond("customer_name", "=", String(filter.customerName).trim());
  }
  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn("id", filter.id.$in);
  } else if (filter.id) {
    pushCond("id", "=", String(filter.id));
  }

  // bookingDate range filters (the app.js daily cron boundary; cashier date
  // browsing). Mirrors the Mongo { bookingDate: { $gte, $lt } } shape.
  const dateRange = filter.bookingDate || {};
  if (dateRange.$gte || filter.bookingDateFrom) pushCond("booking_date", ">=", new Date(dateRange.$gte ?? filter.bookingDateFrom));
  if (dateRange.$lte || filter.bookingDateTo) pushCond("booking_date", "<=", new Date(dateRange.$lte ?? filter.bookingDateTo));
  if (dateRange.$gt) pushCond("booking_date", ">", new Date(dateRange.$gt));
  if (dateRange.$lt) pushCond("booking_date", "<", new Date(dateRange.$lt));

  // createdAt range filters (admin/cashier list presets).
  const createdRange = filter.createdAt || {};
  const cGte = createdRange.$gte ?? filter.dateFrom;
  const cLte = createdRange.$lte ?? filter.dateTo;
  if (cGte) pushCond("created_at", ">=", new Date(cGte));
  if (cLte) pushCond("created_at", "<=", new Date(cLte));

  if (filter.search) {
    const built = buildSearch(filter.search, values);
    if (built) {
      conditions.push(built.sql);
      values.push(built.param);
    }
  }

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const assertEnumOrArray = (value, allowed, label) => {
  if (value === undefined || value === null) return;
  for (const item of Array.isArray(value) ? value : [value]) {
    assertEnum(item, allowed, label);
  }
};

const findById = async (id) => {
  if (!id) return null;
  if (isDbConnected()) {
    const { rows } = await query(`SELECT ${POOJA_BOOKING_COLS.join(", ")} FROM pooja_bookings WHERE id = $1 LIMIT 1`, [String(id)]);
    return await attachChildren(toDoc(rows[0]));
  }
  return PoojaBooking.findById(String(id));
};

const findOne = async (filter = {}) => {
  if (!isDbConnected()) return PoojaBooking.findOne(filter);
  const { where, values } = buildPoojaBookingFilter(filter);
  if (!where) return null;
  const { rows } = await query(`SELECT ${POOJA_BOOKING_COLS.join(", ")} FROM pooja_bookings ${where} ORDER BY created_at DESC, id DESC LIMIT 1`, values);
  return await attachChildren(toDoc(rows[0]));
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!isDbConnected()) {
    let q = PoojaBooking.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildPoojaBookingFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id DESC`;
  let sql = `SELECT ${POOJA_BOOKING_COLS.join(", ")} FROM pooja_bookings ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return Promise.all(rows.map(async (row) => attachChildren(toDoc(row))));
};

const findOneByBookingNumber = async (bookingNumber) =>
  isDbConnected()
    ? findOne({ bookingNumber: String(bookingNumber).trim() })
    : PoojaBooking.findOne({ bookingNumber: String(bookingNumber).trim() });

/**
 * Creates a pooja booking together with its normalized child rows
 * (pooja_booking_material_requests) inside a single PostgreSQL transaction.
 * Either the booking row and every child row persist, or none do.
 */
const create = async (data) => {
  assertRequired(data.customerName, "customerName");
  assertRequired(data.service, "service");
  // The Mongo model declares amount/paymentMethod/contactNumber as required:
  // true; the PostgreSQL columns mirror that with NOT NULL.
  assertRequired(data.amount, "amount");
  assertAmount(data.amount);
  assertAmount(data.templeMaterialCharge);
  assertRequired(data.paymentMethod, "paymentMethod");
  assertEnum(data.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(data.status, STATUSES, "status");
  assertEnum(data.materialStatus, MATERIAL_STATUSES, "materialStatus");
  assertCreatedBy(data.createdBy);
  assertRequiredDate(data.bookingDate, "bookingDate");

  const materialEntries = Array.isArray(data.templeMaterialRequests) ? data.templeMaterialRequests : [];

  if (!isDbConnected()) {
    return PoojaBooking.create(data);
  }

  const id = data.id || newId();
  const row = toRow(data, id);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Mirror the Mongo pre-validate hook: when no explicit bookingNumber was
    // supplied, derive PB1001+ from the most recent booking. Resolved inside
    // the transaction so the look-up and insert stay atomic.
    if (!row.booking_number) {
      row.booking_number = await resolveGeneratedBookingNumber(client);
    }
    await client.query(
      `INSERT INTO pooja_bookings (${POOJA_BOOKING_COLS.join(", ")})
       VALUES (${POOJA_BOOKING_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING`,
      POOJA_BOOKING_COLS.map((col) => row[col])
    );
    await materialRepository.replace(client, id, materialEntries);
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
  assertEnum(updates.status, STATUSES, "status");
  assertEnum(updates.materialStatus, MATERIAL_STATUSES, "materialStatus");
  if (updates.amount !== undefined) assertAmount(updates.amount);
  if (updates.templeMaterialCharge !== undefined) assertAmount(updates.templeMaterialCharge);

  if (!isDbConnected()) {
    return PoojaBooking.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
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

  if (updates.bookingNumber !== undefined) apply("booking_number", String(updates.bookingNumber).trim());
  if (updates.customerName !== undefined) apply("customer_name", String(updates.customerName).trim());
  if (updates.service !== undefined) apply("service", String(updates.service).trim());
  if (updates.amount !== undefined) apply("amount", updates.amount);
  if (updates.paymentMethod !== undefined) apply("payment_method", updates.paymentMethod || "UPI");
  if (updates.contactNumber !== undefined) apply("contact_number", updates.contactNumber === undefined || updates.contactNumber === null ? null : String(updates.contactNumber).trim());
  if (updates.email !== undefined) apply("email", updates.email === undefined || updates.email === null || String(updates.email).trim() === "" ? null : String(updates.email).trim());
  if (updates.address !== undefined) apply("address", updates.address === undefined || updates.address === null || String(updates.address).trim() === "" ? null : String(updates.address).trim());
  if (updates.notes !== undefined) apply("notes", updates.notes || "");
  if (updates.bookingDate !== undefined) apply("booking_date", updates.bookingDate || null);
  if (updates.status !== undefined) apply("status", updates.status || "Booked");
  if (updates.createdBy !== undefined) apply("created_by", String(updates.createdBy).trim());
  if (updates.templeArrangement !== undefined) apply("temple_arrangement", Boolean(updates.templeArrangement));
  if (updates.templeMaterialCharge !== undefined) apply("temple_material_charge", updates.templeMaterialCharge ?? 0);
  if (updates.materialStatus !== undefined) apply("material_status", updates.materialStatus || "N/A");
  // JSONB columns must be stringified so the node-pg driver does not try to
  // bind a JS object as a single parameter.
  if (updates.priestChecklist !== undefined) apply("priest_checklist", JSON.stringify(updates.priestChecklist || {}));

  const replaceMaterials = updates.templeMaterialRequests !== undefined && isDbConnected();

  if (values.length === 0 && !replaceMaterials) {
    return existing;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (values.length > 0) {
      fields.push(`updated_at = now()`);
      values.push(id);
      await client.query(`UPDATE pooja_bookings SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
    }
    if (replaceMaterials) {
      await materialRepository.replace(client, id, Array.isArray(updates.templeMaterialRequests) ? updates.templeMaterialRequests : []);
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
  if (!isDbConnected()) return PoojaBooking.countDocuments(filter);
  const { where, values } = buildPoojaBookingFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM pooja_bookings ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!isDbConnected()) return Boolean(await PoojaBooking.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM pooja_bookings WHERE id = $1 RETURNING id`, [String(id)]);
  return rows.length > 0;
};

module.exports = {
  findById,
  findOne,
  findMany,
  findOneByBookingNumber,
  create,
  updateById,
  count,
  destroy,
};