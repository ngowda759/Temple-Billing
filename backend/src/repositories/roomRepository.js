const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const Room = require("../models/Room");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enum declared in backend/src/models/Room.js exactly.
const STATUSES = new Set(["Available", "Occupied", "Maintenance"]);

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

// Mirrors Mongo's `required: true` on a trimmed String path: missing, null and
// whitespace-only values are all rejected (trim runs before the required check,
// so an all-whitespace String fails validation in Mongo too).
const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

// price is { required: true, min: 0 }. Mongoose casts numeric-looking strings
// and rejects non-finite input ("Cast to Number failed"), so the repository
// mirrors that: required + finite + >= 0.
const assertRequiredMoney = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  if (num < 0) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be >= 0`);
  }
  return value;
};

// capacity / days are bare Numbers with no min in Mongo; only finiteness is
// checked (a fractional capacity is legal).
const assertNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

const ROOM_COLS = [
  "id", "number", "type", "block", "floor", "price", "capacity", "bed_type",
  "amenities", "status", "devotee", "phone", "days", "pay_mode", "checkin_date",
  "checkout_date", "created_at", "updated_at",
];

// Mongo stores optional trimmed Strings as absent (undefined) rather than empty;
// the write paths also explicitly unset the guest fields on checkout. Empty
// strings therefore collapse to NULL so an unset field reads back as undefined.
const nullIfEmpty = (value) =>
  value === undefined || value === null || String(value).trim() === "" ? null : String(value).trim();

const toDate = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a date`);
  }
  return date;
};

// Mirrors the Mongoose [String] cast: keeps the supplied order, and keeps
// Mongo's habit of allowing empty entries (Mongoose casts null/undefined to
// null inside a [String] array and validates it without error), so nothing is
// silently dropped from the array.
const normalizeAmenities = (value) => {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => (entry === undefined || entry === null ? null : String(entry)));
};

// Converts a rooms row into the shape the application receives from Mongoose
// (camelCase, Mongo _id, unset optionals as undefined).
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    number: row.number,
    type: row.type,
    block: row.block === null || row.block === undefined ? undefined : row.block,
    floor: row.floor === null || row.floor === undefined ? undefined : row.floor,
    price: row.price === null || row.price === undefined ? undefined : Number(row.price),
    capacity: row.capacity === null || row.capacity === undefined ? undefined : Number(row.capacity),
    bedType: row.bed_type,
    amenities: row.amenities || [],
    status: row.status,
    devotee: row.devotee === null || row.devotee === undefined ? undefined : row.devotee,
    phone: row.phone === null || row.phone === undefined ? undefined : row.phone,
    days: row.days === null || row.days === undefined ? undefined : Number(row.days),
    payMode: row.pay_mode === null || row.pay_mode === undefined ? undefined : row.pay_mode,
    checkinDate: row.checkin_date === null || row.checkin_date === undefined ? undefined : row.checkin_date,
    checkoutDate: row.checkout_date === null || row.checkout_date === undefined ? undefined : row.checkout_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  number: assertId(data.number, "number"),
  type: assertId(data.type, "type"),
  block: nullIfEmpty(data.block),
  floor: nullIfEmpty(data.floor),
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale.
  price: assertRequiredMoney(data.price, "price"),
  capacity: data.capacity === undefined || data.capacity === null || String(data.capacity).trim() === "" ? 2 : data.capacity,
  bed_type: data.bedType === undefined || data.bedType === null ? "Double" : String(data.bedType).trim(),
  amenities: normalizeAmenities(data.amenities),
  status: data.status || "Available",
  devotee: nullIfEmpty(data.devotee),
  phone: nullIfEmpty(data.phone),
  days: data.days === undefined || data.days === null || String(data.days).trim() === "" ? null : data.days,
  pay_mode: nullIfEmpty(data.payMode),
  checkin_date: toDate(data.checkinDate, "checkinDate"),
  checkout_date: toDate(data.checkoutDate, "checkoutDate"),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns. The only
// standing room sort in the codebase is GET /api/rooms →
// Room.find().sort({ number: 1 }), so `number ASC` is the default here.
const SORT_COLUMNS = {
  number: "number",
  type: "type",
  block: "block",
  floor: "floor",
  price: "price",
  capacity: "capacity",
  bedType: "bed_type",
  status: "status",
  devotee: "devotee",
  days: "days",
  payMode: "pay_mode",
  checkinDate: "checkin_date",
  checkoutDate: "checkout_date",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

const resolveOrderBy = (sort) => {
  const defaultOrder = "number ASC";
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

const pushCond = (conditions, values, col, op, value) => {
  conditions.push(`${col} ${op} $${values.length + 1}`);
  values.push(value);
};

const pushIn = (conditions, values, col, list) => {
  const vals = (Array.isArray(list) ? list : [list])
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v));
  if (vals.length) {
    conditions.push(`${col} IN (${vals.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
    values.push(...vals);
  } else {
    // Mongo $in: [] matches no documents (it is an instant-false predicate).
    conditions.push("1 = 0");
  }
};

// Applies a Mongo comparison operator object ({ $gte/$gt/$lte/$lt/$ne })
// to a column, or an exact equality for a plain value. $exists/$ne are
// supported for TEXT columns, which is what the app.js scheduler needs
// ({ devotee: { $exists: true, $ne: null } }).
const pushComparison = (conditions, values, col, input, dateCol = false) => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [op, opVal] of Object.entries(input)) {
      if (["$gte", "$gt", "$lte", "$lt"].includes(op) && opVal !== undefined && opVal !== null) {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        pushCond(conditions, values, col, sqlOp, dateCol ? new Date(opVal) : opVal);
      } else if (op === "$ne") {
        if (opVal === null) {
          // The app.js auto-checkin query uses { devotee: { $exists: true,
          // $ne: null } } — rewrites to a parameterless IS NOT NULL.
          conditions.push(`${col} IS NOT NULL`);
        } else {
          pushCond(conditions, values, col, "<>", dateCol ? new Date(opVal) : opVal);
        }
      } else if (op === "$exists") {
        // In PostgreSQL every column exists on every row; Mongo's "field is
        // absent" state is represented here by NULL, so $exists: false means
        // IS NULL.
        if (opVal === false) {
          conditions.push(`${col} IS NULL`);
        }
      }
    }
  } else if (input !== undefined && input !== null) {
    pushCond(conditions, values, col, "=", dateCol ? new Date(input) : input);
  } else if (input === null) {
    // Mongo `{ field: null }` matches documents where the field is null OR
    // missing.
    conditions.push(`${col} IS NULL`);
  }
};

// Supports the standard CRUD filter surface plus the Mongo-style operator
// filters the application uses against Room:
//   * { id } / { id: { $in: [...] } }
//   * { number } / { number: { $in: [...] } } — every roomRoutes lookup and
//     the POST /api/rooms duplicate guard (unique column)
//   * { type } / { status } — the admin grid's server-side equivalents
//   * { devotee } / { devotee: { $exists: true, $ne: null } } — the app.js
//     auto-checkin scheduler
//   * { checkinDate } / { checkoutDate } range filters — the app.js auto
//     checkout ({ checkoutDate: { $lte: now } }) and auto check-in
//     ({ checkinDate: { $lte: now }, checkoutDate: { $gt: now } }) paths
//   * { createdAt } / { updatedAt } / { price } / { capacity } / { days }
//     range filters
const buildRoomFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    assertEnumOrArray(filter.status.$in, STATUSES, "status.$in");
    pushIn(conditions, values, "status", filter.status.$in);
  } else if (filter.status) {
    assertEnum(filter.status, STATUSES, "status");
    pushCond(conditions, values, "status", "=", filter.status);
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  if (typeof filter.number === "object" && !Array.isArray(filter.number) && filter.number.$in) {
    pushIn(conditions, values, "number", filter.number.$in);
  } else if (filter.number !== undefined && filter.number !== null) {
    pushCond(conditions, values, "number", "=", String(filter.number).trim());
  }

  if (typeof filter.type === "object" && !Array.isArray(filter.type) && filter.type.$in) {
    pushIn(conditions, values, "type", filter.type.$in);
  } else if (filter.type) {
    pushCond(conditions, values, "type", "=", String(filter.type).trim());
  }

  if (typeof filter.block === "object" && !Array.isArray(filter.block) && filter.block.$in) {
    pushIn(conditions, values, "block", filter.block.$in);
  } else if (filter.block) {
    pushCond(conditions, values, "block", "=", String(filter.block).trim());
  }

  if (typeof filter.floor === "object" && !Array.isArray(filter.floor) && filter.floor.$in) {
    pushIn(conditions, values, "floor", filter.floor.$in);
  } else if (filter.floor) {
    pushCond(conditions, values, "floor", "=", String(filter.floor).trim());
  }

  if (typeof filter.bedType === "object" && !Array.isArray(filter.bedType) && filter.bedType.$in) {
    pushIn(conditions, values, "bed_type", filter.bedType.$in);
  } else if (filter.bedType) {
    pushCond(conditions, values, "bed_type", "=", String(filter.bedType).trim());
  }

  if (typeof filter.devotee === "object" && !Array.isArray(filter.devotee) && filter.devotee.$in) {
    pushIn(conditions, values, "devotee", filter.devotee.$in);
  } else if (typeof filter.devotee === "object" && !Array.isArray(filter.devotee)) {
    // The app.js auto-checkin scheduler passes { $exists: true, $ne: null }.
    pushComparison(conditions, values, "devotee", filter.devotee, false);
  } else if (filter.devotee) {
    pushCond(conditions, values, "devotee", "=", String(filter.devotee).trim());
  }

  pushComparison(conditions, values, "price", filter.price, false);
  pushComparison(conditions, values, "capacity", filter.capacity, false);
  pushComparison(conditions, values, "days", filter.days, false);
  pushComparison(conditions, values, "checkin_date", filter.checkinDate, true);
  pushComparison(conditions, values, "checkout_date", filter.checkoutDate, true);
  pushComparison(conditions, values, "created_at", filter.createdAt, true);
  pushComparison(conditions, values, "updated_at", filter.updatedAt, true);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Room.findById(String(id));
  const { rows } = await query(`SELECT ${ROOM_COLS.join(", ")} FROM rooms WHERE id = $1 LIMIT 1`, [String(id)]);
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Room.findOne(filter);
  const { where, values } = buildRoomFilter(filter);
  const { rows } = await query(`SELECT ${ROOM_COLS.join(", ")} FROM rooms ${where} ORDER BY number ASC, id ASC LIMIT 1`, values);
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { number: 1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Room.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildRoomFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${ROOM_COLS.join(", ")} FROM rooms ${where} ORDER BY ${orderBy}, id ASC`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const create = async (data) => {
  assertId(data.number, "number");
  assertId(data.type, "type");
  assertEnum(data.status, STATUSES, "status");
  assertRequiredMoney(data.price, "price");
  assertNumber(data.capacity, "capacity");
  assertNumber(data.days, "days");

  if (!dbConfig.isDbConnected()) {
    return Room.create(data);
  }

  const id = data.id || newId();
  const row = toRow(data, id);
  await query(
    `INSERT INTO rooms (${ROOM_COLS.join(", ")})
     VALUES (${ROOM_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    ROOM_COLS.map((col) => row[col])
  );
  return findById(id);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (updates.number !== undefined) assertId(updates.number, "number");
  if (updates.type !== undefined) assertId(updates.type, "type");
  assertEnum(updates.status, STATUSES, "status");
  if (updates.price !== undefined) assertRequiredMoney(updates.price, "price");
  assertNumber(updates.capacity, "capacity");
  assertNumber(updates.days, "days");

  if (!dbConfig.isDbConnected()) {
    return Room.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
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
  const applyNullable = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(nullIfEmpty(value));
    }
  };
  const applyRequiredText = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(assertId(value, dbCol));
    }
  };
  const applyNumber = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? null : value);
    }
  };
  const applyDate = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(toDate(value, dbCol));
    }
  };

  if (updates.number !== undefined) applyRequiredText("number", updates.number);
  if (updates.type !== undefined) applyRequiredText("type", updates.type);
  if (updates.block !== undefined) applyNullable("block", updates.block);
  if (updates.floor !== undefined) applyNullable("floor", updates.floor);
  if (updates.price !== undefined) apply("price", updates.price);
  if (updates.capacity !== undefined) applyNumber("capacity", updates.capacity);
  if (updates.bedType !== undefined) apply("bed_type", String(updates.bedType).trim());
  if (updates.amenities !== undefined) apply("amenities", normalizeAmenities(updates.amenities));
  if (updates.status !== undefined) apply("status", updates.status);
  if (updates.devotee !== undefined) applyNullable("devotee", updates.devotee);
  if (updates.phone !== undefined) applyNullable("phone", updates.phone);
  if (updates.days !== undefined) applyNumber("days", updates.days);
  if (updates.payMode !== undefined) applyNullable("pay_mode", updates.payMode);
  if (updates.checkinDate !== undefined) applyDate("checkin_date", updates.checkinDate);
  if (updates.checkoutDate !== undefined) applyDate("checkout_date", updates.checkoutDate);

  if (values.length > 0) {
    fields.push(`updated_at = now()`);
    values.push(id);
    await query(`UPDATE rooms SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  }
  return findById(id);
};

// Clears the guest fields and returns the room to 'Available'. Mirrors the
// checkout / auto-checkout semantics in roomRoutes.js and app.js exactly:
// devotee / phone / days / payMode / checkinDate / checkoutDate are unset and
// only status + updated_at are written.
const release = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) {
    const room = await Room.findById(String(id));
    if (!room) return null;
    room.status = "Available";
    room.devotee = undefined;
    room.phone = undefined;
    room.days = undefined;
    room.payMode = undefined;
    room.checkinDate = undefined;
    room.checkoutDate = undefined;
    await room.save();
    return room;
  }
  const { rows } = await query(
    `UPDATE rooms
        SET status = 'Available', devotee = NULL, phone = NULL, days = NULL,
            pay_mode = NULL, checkin_date = NULL, checkout_date = NULL,
            updated_at = now()
      WHERE id = $1
      RETURNING ${ROOM_COLS.join(", ")}`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Room.countDocuments(filter);
  const { where, values } = buildRoomFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM rooms ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await Room.findByIdAndDelete(String(id)));
  const { rows } = await query("DELETE FROM rooms WHERE id = $1 RETURNING id", [String(id)]);
  return rows.length > 0;
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  updateById,
  release,
  count,
  destroy,
  STATUSES,
};
