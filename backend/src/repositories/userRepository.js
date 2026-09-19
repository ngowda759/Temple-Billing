const { query } = require("../config/postgres");
const { getEmailAliases } = require("../utils/email");
const dbConfig = require("../config/db");
const User = require("../models/User");
const {
  findUserByEmail: findFileUserByEmail,
  findUserById: findFileUserById,
  createUser: createFileUser,
  updateUser: updateFileUser,
  getAllUsers: getAllFileUsers,
} = require("../store/fileUserStore");
const crypto = require("crypto");

const now = () => new Date();

const newId = () => crypto.randomBytes(12).toString("hex");

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const ROW_COLS = [
  "id", "name", "email", "username", "employee_id", "phone", "address", "place",
  "password", "role", "photo", "status", "account_enabled", "permissions", "menu_access",
  "last_login", "must_change_password", "provider", "reset_password_token",
  "reset_password_expires_at", "created_at", "updated_at",
];

const fromDbToMongoLike = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    email: row.email,
    username: row.username || undefined,
    employeeId: row.employee_id || undefined,
    phone: row.phone || "",
    address: row.address || "",
    place: row.place || "",
    password: row.password,
    role: row.role,
    photo: row.photo || "",
    status: row.status,
    accountEnabled: row.account_enabled,
    permissions: row.permissions || [],
    menuAccess: row.menu_access || [],
    lastLogin: row.last_login,
    mustChangePassword: row.must_change_password,
    provider: row.provider,
    resetPasswordToken: row.reset_password_token || null,
    resetPasswordExpiresAt: row.reset_password_expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const fromDbToApi = (row) => {
  const doc = fromDbToMongoLike(row);
  if (!doc) return null;
  return {
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email,
    phone: doc.phone || "",
    address: doc.address || "",
    place: doc.place || "",
    role: doc.role,
    username: doc.username || "",
    employeeId: doc.employeeId || "",
    photo: doc.photo || "",
    status: doc.status || "Active",
    lastLogin: doc.lastLogin || null,
    permissions: doc.permissions || [],
    menuAccess: doc.menuAccess || [],
    createdAt: doc.createdAt?.toISOString?.(),
    mustChangePassword: Boolean(doc.mustChangePassword),
  };
};

const pickEmailAliases = (email) => {
  const aliases = getEmailAliases(email);
  return aliases.length ? aliases : [normalizeEmail(email)];
};

const pickCols = (cols, includePasswordImplicit = true) => cols.join(", ");

const findUserByEmail = async (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  if (dbConfig.isDbConnected()) {
    const aliases = pickEmailAliases(normalized);
    const { rows } = await query(
      `SELECT ${ROW_COLS.join(", ")} FROM users WHERE email IN (${aliases.map((_, i) => `$${i + 1}`).join(", ")}) ORDER BY created_at ASC LIMIT 1`,
      aliases
    );
    if (rows[0]) return fromDbToMongoLike(rows[0]);
    return null;
  }
  return findFileUserByEmail(normalized);
};

const findUserByPhone = async (phone) => {
  const trimmed = String(phone || "").trim();
  if (!trimmed) return null;
  if (dbConfig.isDbConnected()) {
    const { rows } = await query("SELECT id FROM users WHERE phone = $1 LIMIT 1", [trimmed]);
    if (rows[0]) return { id: rows[0].id };
    return null;
  }
  const users = await getAllFileUsers();
  return users.find((user) => String(user.phone || "").trim() === trimmed) || null;
};

const findUserById = async (id) => {
  if (!id) return null;
  if (dbConfig.isDbConnected()) {
    const { rows } = await query(
      `SELECT ${ROW_COLS.join(", ")} FROM users WHERE id = $1 LIMIT 1`,
      [String(id)]
    );
    return fromDbToMongoLike(rows[0]);
  }
  return findFileUserById(String(id));
};

const findByUsernameOrEmail = async (identifier) => {
  const normalized = normalizeEmail(identifier);
  if (!normalized) return Promise.resolve(null);
  if (dbConfig.isDbConnected()) {
    const aliases = pickEmailAliases(normalized);
    const { rows } = await query(
      `SELECT ${ROW_COLS.join(", ")} FROM users
       WHERE email IN (${aliases.map((_, i) => `$${i + 1}`).join(", ")}) OR username = $${aliases.length + 1}
       ORDER BY created_at ASC LIMIT 1`,
      [...aliases, normalized]
    );
    if (rows[0]) return fromDbToMongoLike(rows[0]);
    return null;
  }
  return findFileUserByEmail(normalized);
};

const createUser = async (data) => {
  const user = {
    id: data.id || newId(),
    name: data.name,
    email: normalizeEmail(data.email),
    username: data.username || null,
    employeeId: data.employeeId || null,
    phone: data.phone || null,
    address: data.address || null,
    place: data.place || null,
    password: data.password,
    role: data.role || "devotee",
    photo: data.photo || "",
    status: data.status || "Active",
    accountEnabled: data.accountEnabled !== false,
    permissions: data.permissions || [],
    menuAccess: data.menuAccess || [],
    mustChangePassword: Boolean(data.mustChangePassword),
    provider: data.provider || "local",
    resetPasswordToken: data.resetPasswordToken || null,
    resetPasswordExpiresAt: data.resetPasswordExpiresAt || null,
    createdAt: data.createdAt || now(),
    updatedAt: data.updatedAt || now(),
  };

  if (dbConfig.isDbConnected()) {
    await query(
      `INSERT INTO users (${ROW_COLS.join(", ")})
       VALUES (${ROW_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING`,
      ROW_COLS.map((col) => {
        const snake = {
          account_enabled: user.accountEnabled,
          menu_access: user.menuAccess,
          must_change_password: user.mustChangePassword,
          reset_password_token: user.resetPasswordToken,
          reset_password_expires_at: user.resetPasswordExpiresAt,
          created_at: user.createdAt,
          updated_at: user.updatedAt,
        };
        return col in snake ? snake[col] : user[col];
      })
    );
    const existing = await findUserById(user.id);
    if (existing) return existing;
  } else {
    return createFileUser({
      id: user.id,
      name: user.name,
      email: user.email,
      password: user.password,
      role: user.role,
      phone: user.phone || "",
      address: user.address || "",
      place: user.place || "",
      mustChangePassword: user.mustChangePassword,
      provider: user.provider,
    });
  }

  return fromDbToMongoLike(user);
};

const updateUserById = async (id, updates) => {
  if (!id) return null;
  const existing = await findUserById(id);
  if (!existing?._id) return null;

  if (dbConfig.isDbConnected()) {
    const fields = [];
    const values = [];
    const apply = (dbCol, value) => {
      if (value !== undefined) {
        fields.push(`${dbCol} = $${fields.length + 1}`);
        values.push(value);
      }
    };

    if (updates.password !== undefined) apply("password", updates.password);
    if (updates.mustChangePassword !== undefined) apply("must_change_password", updates.mustChangePassword);
    if (updates.resetPasswordToken !== undefined) apply("reset_password_token", updates.resetPasswordToken ?? null);
    if (updates.resetPasswordExpiresAt !== undefined) apply("reset_password_expires_at", updates.resetPasswordExpiresAt ?? null);
    if (updates.lastLogin !== undefined) apply("last_login", updates.lastLogin);
    if (updates.name !== undefined) apply("name", updates.name);
    if (updates.email !== undefined) apply("email", normalizeEmail(updates.email));
    if (updates.username !== undefined) apply("username", updates.username ?? null);
    if (updates.employeeId !== undefined) apply("employee_id", updates.employeeId ?? null);
    if (updates.phone !== undefined) apply("phone", updates.phone ?? null);
    if (updates.address !== undefined) apply("address", updates.address ?? null);
    if (updates.place !== undefined) apply("place", updates.place ?? null);
    if (updates.role !== undefined) apply("role", updates.role);
    if (updates.photo !== undefined) apply("photo", updates.photo);
    if (updates.status !== undefined) apply("status", updates.status);
    if (updates.accountEnabled !== undefined) apply("account_enabled", updates.accountEnabled);
    if (updates.permissions !== undefined) apply("permissions", updates.permissions);
    if (updates.menuAccess !== undefined) apply("menu_access", updates.menuAccess);
    if (updates.provider !== undefined) apply("provider", updates.provider);

    if (values.length === 0) return fromDbToMongoLike(existing);

    fields.push(`updated_at = now()`);
    values.push(id);
    await query(`UPDATE users SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  } else {
    return updateFileUser(String(existing._id || existing.id), updates);
  }
  return findUserById(id);
};

const countUsers = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) {
    const users = await getAllFileUsers();
    return users.filter((u) => (!filter.role || u.role === filter.role)).length;
  }
  const conditions = [];
  const values = [];
  if (filter.role) { conditions.push(`role = $${values.length + 1}`); values.push(filter.role); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM users ${where}`, values);
  return rows[0]?.count || 0;
};

const listUsers = async ({ role, excludePassword = true } = {}) => {
  if (!dbConfig.isDbConnected()) {
    const users = (await getAllFileUsers()).filter((u) => (!role || u.role === role));
    return excludePassword
      ? users.map((u) => { const { password, ...rest } = u; return rest; })
      : users;
  }
  const conditions = [];
  const values = [];
  if (role) { conditions.push(`role = $${values.length + 1}`); values.push(role); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const cols = excludePassword ? ROW_COLS.filter((c) => c !== "password") : ROW_COLS;
  const { rows } = await query(
    `SELECT ${cols.join(", ")} FROM users ${where} ORDER BY created_at DESC`,
    values
  );
  return rows.map(fromDbToMongoLike);
};

const removeFromRole = async (role) => {
  if (!dbConfig.isDbConnected()) return;
  await query("UPDATE users SET account_enabled = FALSE WHERE role = $1", [role]);
};

const destroyUser = async (id) => {
  if (!id) return false;
  if (dbConfig.isDbConnected()) {
    const { rows } = await query("DELETE FROM users WHERE id = $1 RETURNING id", [String(id)]);
    return rows.length > 0;
  }
  return false;
};

module.exports = {
  findUserByEmail,
  findUserByPhone,
  findUserById,
  findByUsernameOrEmail,
  createUser,
  updateUserById,
  countUsers,
  listUsers,
  destroyUser,
  removeFromRole,
  fromDbToMongoLike,
  fromDbToApi,
};