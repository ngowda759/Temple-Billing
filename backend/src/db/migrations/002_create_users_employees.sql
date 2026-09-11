-- Phase 2A: users + employees (MongoDB → PostgreSQL migration).
-- Primary keys are 24-char hex strings so they remain compatible with the
-- existing MongoDB ObjectId-based references (Booking.devoteeId,
-- PrasadamOrder.devoteeId, Notification.audienceId, Attendance.staffId/employeeId,
-- ShiftAssignment.employeeId etc.) and can be relaxed to BIGINT identities later.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  username TEXT,
  employee_id TEXT,
  phone TEXT,
  address TEXT,
  place TEXT,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'devotee',
  photo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active',
  account_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  menu_access TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  last_login TIMESTAMPTZ,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  provider TEXT NOT NULL DEFAULT 'local',
  reset_password_token TEXT,
  reset_password_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_username_key UNIQUE (username),
  CONSTRAINT users_employee_id_key UNIQUE (employee_id),
  CONSTRAINT users_role_check CHECK (role IN ('admin', 'accountant', 'cashier', 'priest', 'staff', 'devotee')),
  CONSTRAINT users_status_check CHECK (status IN ('Active', 'On Leave', 'Inactive', 'Suspended', 'Resigned', 'Retired')),
  CONSTRAINT users_provider_check CHECK (provider IN ('local', 'google'))
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  employee_id TEXT,
  username TEXT,
  user_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  gender TEXT,
  dob TEXT,
  blood_group TEXT,
  aadhaar TEXT,
  phone TEXT,
  address TEXT,
  emergency_contact TEXT,
  shift TEXT,
  department TEXT,
  salary NUMERIC NOT NULL,
  joining_date DATE NOT NULL,
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  employment_type TEXT NOT NULL DEFAULT 'Full Time',
  default_shift TEXT,
  default_duty TEXT,
  duty_location TEXT,
  biometric_id TEXT,
  current_duty TEXT NOT NULL DEFAULT '{}',
  photo TEXT NOT NULL DEFAULT '',
  profile_photo TEXT NOT NULL DEFAULT '',
  face_registered BOOLEAN NOT NULL DEFAULT FALSE,
  face_descriptor DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
  face_photos TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  attendance_location TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  attendance_status TEXT NOT NULL DEFAULT 'Not Marked',
  leave_balance NUMERIC NOT NULL DEFAULT 0,
  experience TEXT,
  veda_shakha TEXT,
  specializations TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  languages TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  certification TEXT,
  created_by TEXT NOT NULL DEFAULT 'Admin',
  updated_by TEXT NOT NULL DEFAULT 'Admin',
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT NOT NULL DEFAULT '',
  weekly_off TEXT NOT NULL DEFAULT '',
  comp_off_balance NUMERIC NOT NULL DEFAULT 0,
  eligible_poojas TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT employees_employee_id_key UNIQUE (employee_id),
  CONSTRAINT employees_username_key UNIQUE (username),
  CONSTRAINT employees_email_key UNIQUE (email),
  CONSTRAINT employees_aadhaar_key UNIQUE (aadhaar),
  CONSTRAINT employees_role_check CHECK (role IN ('admin', 'priest', 'accountant', 'cashier', 'staff')),
  CONSTRAINT employees_status_check CHECK (status IN ('Active', 'On Leave', 'Inactive', 'Suspended', 'Resigned', 'Retired')),
  CONSTRAINT employees_employment_type_check CHECK (employment_type IN ('Full Time', 'Part Time', 'Contract')),
  CONSTRAINT employees_weekly_off_check CHECK (weekly_off IN ('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', ''))
);

-- Real relationship: employees.user_id → users.id (same logical person).
-- Kept as a plain indexed TEXT + FK so MongoDB-style ObjectId values keep matching.
 
CREATE INDEX IF NOT EXISTS idx_employees_user_id ON employees (user_id);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees (name);
CREATE INDEX IF NOT EXISTS idx_employees_role ON employees (role);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees (status);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees (department);
CREATE INDEX IF NOT EXISTS idx_employees_shift ON employees (shift);
CREATE INDEX IF NOT EXISTS idx_employees_default_shift ON employees (default_shift);
CREATE INDEX IF NOT EXISTS idx_employees_joining_date ON employees (joining_date);
CREATE INDEX IF NOT EXISTS idx_employees_salary ON employees (salary);
CREATE INDEX IF NOT EXISTS idx_employees_phone ON employees (phone);
CREATE INDEX IF NOT EXISTS idx_employees_created_at ON employees (created_at DESC);