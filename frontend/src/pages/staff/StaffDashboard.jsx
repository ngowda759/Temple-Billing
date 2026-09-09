import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  FiBell,
  FiBox,
  FiCalendar,
  FiCheckCircle,
  FiClipboard,
  FiClock,
  FiFileText,
  FiHome,
  FiLock,
  FiLogOut,
  FiMapPin,
  FiSave,
  FiSettings,
  FiUser,
} from "react-icons/fi";
import { FaCalendarCheck } from "react-icons/fa";
import { MdTempleHindu } from "react-icons/md";
import { TbChecklist, TbHourglassLow, TbProgressCheck } from "react-icons/tb";
import { MdLightMode, MdDarkMode } from "react-icons/md";
import { FaSignOutAlt } from "react-icons/fa";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import EmployeeProfileView from "../../components/shared/EmployeeProfileView";
import {
  changeEmployeePassword,
  getEmployeeProfile,
  updateEmployeeProfile,
} from "../../services/employeeService";
import Notifications from "./Notifications";
import Attendance from "./Attendance";
import StaffInventory from "./StaffInventory";
import templeBg from "../../assets/temple-bg.jpg";
import "./StaffDashboard.css";

const API_BASE = "http://localhost:5000/api";
const POLL_INTERVAL_MS = 10000;
const TASK_STATUSES = ["Pending", "In Progress", "Completed"];
const LEAVE_TYPES = ["Sick Leave", "Casual Leave", "Festival Leave", "Emergency Leave", "General"];
const BLOOD_GROUPS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];
const INVENTORY_UNITS = ["Kg", "Liter", "Pack", "Pieces"];
const STAFF_PROFILE_EDITABLE_FIELDS = ["name", "email", "bloodGroup", "dob", "phone", "emergencyContact", "address", "photo", "bankName", "accountNumber"];

const buildEditableProfilePayload = (profile = {}) =>
  STAFF_PROFILE_EDITABLE_FIELDS.reduce((payload, field) => {
    payload[field] = profile[field] ?? "";
    return payload;
  }, {});

const getStaffProfileDetails = (profile = {}) => {
  const details = [
    { label: "Role", value: profile.role || "-" },
    { label: "Status", value: profile.status || "-" },
    { label: "Gender", value: profile.gender || "-" },
    { label: "Aadhaar", value: profile.aadhaar || "-" },
    { label: "Joining Date", value: profile.joiningDate ? new Date(profile.joiningDate).toLocaleDateString("en-IN") : "-" },
    { label: "Shift", value: profile.currentDuty?.shift || profile.defaultShift || profile.shift || "-" },
    { label: "Department", value: profile.department || "-" },
    { label: "Employment Type", value: profile.employmentType || "-" },
    { label: "Salary", value: profile.salary || "-" },
    { label: "Current Duty", value: profile.currentDuty?.dutyName || profile.defaultDuty || "-" },
    { label: "Attendance Status", value: profile.attendanceStatus || "Not Marked" },
    { label: "Weekly Off", value: profile.weeklyOff || "None" },
    { label: "Leave Balance", value: `${profile.leaveBalance ?? 0} days` },
    { label: "Bank Name", value: profile.bankName || "-" },
    { label: "Account Number", value: profile.accountNumber || "-" },
  ];
  return details.filter(d => d.value !== "-" && d.value !== "");
};

const formatHeaderDate = () =>
  new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

const statusClassMap = {
  Pending: "pending",
  "In Progress": "progress",
  Completed: "completed",
  Approved: "approved",
  Rejected: "rejected",
};

const parseDate = (value) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const leaveDaysCount = (fromDate, toDate, weeklyOff = null) => {
  const from = parseDate(fromDate);
  const to = parseDate(toDate);
  if (!from || !to || to < from) {
    return 0;
  }
  let count = 0;
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
    if (weeklyOff !== dayName) {
      count++;
    }
  }
  return count;
};

const leavePeriod = (fromDate, toDate) => {
  const from = parseDate(fromDate);
  const to = parseDate(toDate);
  if (!from || !to) {
    return `${fromDate || "-"} to ${toDate || "-"}`;
  }
  const fromLabel = from.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const toLabel = to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return `${fromLabel} - ${toLabel}`;
};

const formatTaskDate = (value) => {
  if (!value) return "-";
  const normalizedValue = String(value);
  const date = new Date(normalizedValue.includes("T") ? normalizedValue : `${normalizedValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return normalizedValue;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const parseTaskTime = (value) => {
  if (!value) return 0;
  const timeValue = String(value).trim();
  if (/\d+:\d+\s*(AM|PM)/i.test(timeValue)) {
    const [timePart, meridiem] = timeValue.split(/\s+/);
    const [hours, minutes] = timePart.split(":").map(Number);
    const normalizedHours = hours % 12 + (meridiem.toUpperCase() === "PM" ? 12 : 0);
    return normalizedHours * 60 + (minutes || 0);
  }
  if (/\d+:\d+/.test(timeValue)) {
    const [hours, minutes] = timeValue.split(":").map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  }
  return 0;
};

const sortTasksByDateTime = (a, b) => {
  const dateA = a.dueDate ? new Date(a.dueDate) : null;
  const dateB = b.dueDate ? new Date(b.dueDate) : null;
  if (dateA && dateB) {
    const dayDiff = dateA.getTime() - dateB.getTime();
    if (dayDiff !== 0) return dayDiff;
  }
  const timeA = parseTaskTime(a.time);
  const timeB = parseTaskTime(b.time);
  return timeA - timeB;
};

const toProfileForm = (profile = {}) => ({
  name: profile.name || "",
  email: profile.email || "",
  role: profile.role || "staff",
  gender: profile.gender || "Male",
  dob: profile.dob || "",
  bloodGroup: profile.bloodGroup || "O+",
  aadhaar: profile.aadhaar || "",
  phone: profile.phone || "",
  emergencyContact: profile.emergencyContact || "",
  address: profile.address || "",
  shift: profile.shift || "Morning",
  department: profile.department || "",
  salary: profile.salary || "",
  joiningDate: profile.joiningDate || "",
  employmentType: profile.employmentType || "Full-time",
  defaultShift: profile.defaultShift || "",
  defaultDuty: profile.defaultDuty || "",
  dutyLocation: profile.dutyLocation || "",
  currentDuty: profile.currentDuty || {},
  attendanceStatus: profile.attendanceStatus || "Not Marked",
  leaveBalance: profile.leaveBalance ?? 0,
  status: profile.status || "Active",
  weeklyOff: profile.weeklyOff || "None",
  photo: profile.photo || "",
  createdAt: profile.createdAt || "",
  updatedAt: profile.updatedAt || "",
  createdBy: profile.createdBy || "",
  lastLogin: profile.lastLogin || "",
});

const StaffDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logoutUser, updateUser } = useAuth();
  const storedUser = JSON.parse(localStorage.getItem("user") || "null");
  const staff = user || storedUser;
  const updateUserRef = useRef(updateUser);
  const { darkMode, toggleDarkMode } = useTheme();

  const [activeSection, setActiveSection] = useState("dashboard");
  const [tasks, setTasks] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submittingLeave, setSubmittingLeave] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState("");
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [error, setError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedSupportTask, setSelectedSupportTask] = useState(null);
  const [filteredStatus, setFilteredStatus] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [detailStatus, setDetailStatus] = useState("Pending");
  const [leaveForm, setLeaveForm] = useState({
    leaveType: "General",
    reason: "",
    fromDate: "",
    toDate: "",
  });
  const [profileForm, setProfileForm] = useState(toProfileForm());
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  // Removed inline inventory state - now handled by StaffInventory component

  useEffect(() => {
    updateUserRef.current = updateUser;
  }, [updateUser]);

  const staffId = staff?.id || staff?._id || "";
  const displayName = profileForm.name || staff?.name || "Staff";
  const sectionFromQuery = new URLSearchParams(location.search).get("section");

  const fetchUnreadCount = useCallback(async () => {
    if (!staffId) return;
    try {
      const response = await axios.get(`${API_BASE}/staff/notifications/${staffId}/unread-count`);
      setNotificationUnreadCount(Number(response.data?.unreadCount || 0));
    } catch (apiError) {
      console.warn("Failed to load staff notification count", apiError);
    }
  }, [staffId]);

  const fetchDashboardData = useCallback(async () => {
    if (!staffId) {
      setError("Staff user not found. Please login again.");
      setLoading(false);
      return;
    }

    try {
      setError("");
      const [taskRes, leaveRes] = await Promise.all([
        axios.get(`${API_BASE}/staff/tasks/${staffId}`),
        axios.get(`${API_BASE}/leaves/${staffId}`),
      ]);
      setTasks(Array.isArray(taskRes.data) ? taskRes.data : []);
      setLeaves(Array.isArray(leaveRes.data) ? leaveRes.data : []);
    } catch (apiError) {
      setError(apiError.response?.data?.message || "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [staffId]);

  const fetchProfileData = useCallback(async () => {
    if (!staffId) return;
    try {
      setProfileLoading(true);
      setProfileMessage("");
      const response = await getEmployeeProfile(staffId);
      setProfileForm(toProfileForm(response.profile));
      if (response.authUser) {
        updateUserRef.current?.(response.authUser);
      }
    } catch (apiError) {
      setProfileMessage(apiError.response?.data?.message || "Failed to load profile details");
    } finally {
      setProfileLoading(false);
    }
  }, [staffId]);

  useEffect(() => {
    fetchDashboardData();
    const timer = setInterval(fetchDashboardData, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchDashboardData]);

  useEffect(() => {
    fetchProfileData();
  }, [fetchProfileData]);

  useEffect(() => {
    if (activeSection === "profile") {
      fetchProfileData();
    }
  }, [activeSection, fetchProfileData]);

  // Removed inline inventory hooks

  useEffect(() => {
    fetchUnreadCount();
    const timer = setInterval(fetchUnreadCount, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchUnreadCount]);

  useEffect(() => {
    const validSections = new Set(["dashboard", "duties", "attendance", "leaveRequests", "applyLeave", "notifications", "profile", "inventory"]);
    if (sectionFromQuery && validSections.has(sectionFromQuery)) {
      setActiveSection(sectionFromQuery);
    } else if (location.pathname === "/staff" && !sectionFromQuery) {
      setActiveSection("dashboard");
    }
  }, [location.pathname, sectionFromQuery]);

  const taskSummary = useMemo(() => {
    return tasks.reduce(
      (acc, task) => {
        acc.total += 1;
        if (task.status === "Completed") acc.completed += 1;
        if (task.status === "In Progress") acc.inProgress += 1;
        if (task.status === "Pending") acc.pending += 1;
        return acc;
      },
      { total: 0, completed: 0, inProgress: 0, pending: 0 }
    );
  }, [tasks]);

  const latestDuties = useMemo(() => {
    return tasks.slice().sort(sortTasksByDateTime).slice(0, 5);
  }, [tasks]);

  const filteredDuties = useMemo(() => {
    return tasks
      .slice()
      .sort(sortTasksByDateTime)
      .filter((task) => {
        const matchesStatus = filteredStatus === "all" || task.status === filteredStatus;
        const matchesSearch = searchQuery
          ? `${task.title || task.duty || ""} ${task.area || task.description || ""}`
            .toLowerCase()
            .includes(searchQuery.toLowerCase())
          : true;
        return matchesStatus && matchesSearch;
      });
  }, [tasks, filteredStatus, searchQuery]);

  const todayDuty = latestDuties.length > 0 ? latestDuties[0] : null;

  const timelineItems = useMemo(() => {
    return tasks.slice().sort(sortTasksByDateTime);
  }, [tasks]);
  useEffect(() => {
    if (selectedTask) {
      setDetailStatus(selectedTask.status || "Pending");
    }
  }, [selectedTask]);

  useEffect(() => {
    if (selectedSupportTask) {
      setDetailStatus(selectedSupportTask.status || "Pending");
    }
  }, [selectedSupportTask]);

  const leaveSummary = useMemo(() => {
    const approvedDays = leaves
      .filter((l) => l.status === "Approved")
      .reduce((acc, l) => acc + leaveDaysCount(l.fromDate, l.toDate, profileForm?.weeklyOff), 0);
    const pendingCount = leaves.filter((l) => l.status === "Pending").length;
    const totalQuota = 14;
    return {
      totalQuota,
      used: approvedDays,
      remaining: totalQuota - approvedDays,
      pending: pendingCount
    };
  }, [leaves, profileForm?.weeklyOff]);

  const latestLeaveDecision = useMemo(() => {
    return leaves.find((leave) => leave.status === "Approved" || leave.status === "Rejected");
  }, [leaves]);

  const formatDateTime = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };



  const handleTaskStatusChange = async (taskId, status) => {
    try {
      setUpdatingTaskId(taskId);
      await axios.put(`${API_BASE}/staff/task-status/${taskId}`, { status });
      setTasks((prev) => prev.map((task) => (task._id === taskId ? { ...task, status } : task)));
      setSelectedTask((prev) => (prev && prev._id === taskId ? { ...prev, status } : prev));
      setSelectedSupportTask((prev) => (prev && prev._id === taskId ? { ...prev, status } : prev));
      if (selectedTask && selectedTask._id === taskId) {
        setDetailStatus(status);
      }
      if (selectedSupportTask && selectedSupportTask._id === taskId) {
        setDetailStatus(status);
      }
    } catch (apiError) {
      alert(apiError.response?.data?.message || "Failed to update task status");
    } finally {
      setUpdatingTaskId("");
    }
  };

  const handleLeaveSubmit = async (event) => {
    event.preventDefault();
    if (!leaveForm.reason.trim() || !leaveForm.fromDate || !leaveForm.toDate) {
      alert("Please fill all leave details");
      return;
    }
    if (leaveForm.fromDate > leaveForm.toDate) {
      alert("From date cannot be after To date");
      return;
    }

    try {
      setSubmittingLeave(true);
      const res = await axios.post(`${API_BASE}/leaves/apply`, {
        ...leaveForm,
        staffId,
        staffName: displayName,
      });
      setLeaveForm({
        leaveType: "General",
        reason: "",
        fromDate: "",
        toDate: "",
      });
      await fetchDashboardData();
      setActiveSection("leaveRequests");
      if (res.data.quotaExceeded) {
        alert(res.data.message);
      } else {
        alert("Leave request sent to admin");
      }
    } catch (apiError) {
      alert(apiError.response?.data?.message || "Failed to submit leave request");
    } finally {
      setSubmittingLeave(false);
    }
  };

  const handleProfileInputChange = (field, value) => {
    setProfileForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleProfilePhotoChange = (file) => {
    if (!file) {
      setProfileForm((prev) => ({ ...prev, photo: "" }));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setProfileForm((prev) => ({ ...prev, photo: String(reader.result || "") }));
    };
    reader.readAsDataURL(file);
  };

  const handleProfileSave = async (event) => {
    event.preventDefault();
    if (!profileForm.name.trim() || !profileForm.email.trim()) {
      setProfileMessage("Name and email are required");
      return;
    }

    try {
      setProfileSaving(true);
      setProfileMessage("");
      const response = await updateEmployeeProfile(staffId, buildEditableProfilePayload(profileForm));
      setProfileForm(toProfileForm(response.profile));
      if (response.authUser) {
        updateUser(response.authUser);
      }
      setProfileMessage("Profile updated successfully");
    } catch (apiError) {
      setProfileMessage(apiError.response?.data?.message || "Failed to update profile");
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordSave = async (event) => {
    event.preventDefault();
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordMessage("Please fill all password fields");
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setPasswordMessage("New password must be at least 6 characters");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMessage("New password and confirm password do not match");
      return;
    }

    try {
      setPasswordSaving(true);
      setPasswordMessage("");
      await changeEmployeePassword(staffId, {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setPasswordMessage("Password changed successfully");
    } catch (apiError) {
      setPasswordMessage(apiError.response?.data?.message || "Failed to change password");
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleLogout = () => {
    logoutUser();
    navigate("/login");
  };

  return (
    <div className="staff-dashboard-page">
      <aside 
        className="staff-sidebar border-none shadow-[0_0_0_1px_rgba(228,190,142,0.55),0_28px_60px_rgba(104,62,30,0.14)]"
        style={{
          backgroundImage: darkMode
            ? `linear-gradient(180deg, rgba(30,41,59,0.95) 0%, rgba(15,23,42,0.98) 100%), url(${templeBg})`
            : `linear-gradient(180deg, rgba(255, 247, 231, 0.93) 0%, rgba(255, 242, 216, 0.88) 42%, rgba(96, 59, 26, 0.76) 100%), url(${templeBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="staff-brand">
          <div className="brand-icon">
            <MdTempleHindu />
          </div>
          <div>
            <h2>Sri Shanti</h2>
            <p>Mahadev Mandir</p>
          </div>
        </div>

        <nav className="staff-nav">
          <button
            type="button"
            className={activeSection === "dashboard" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveSection("dashboard")}
          >
            <FiHome /> Dashboard
          </button>
          <button
            type="button"
            className={activeSection === "duties" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveSection("duties")}
          >
            <TbChecklist /> My Duties
          </button>
          <button
            type="button"
            className={activeSection === "attendance" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveSection("attendance")}
          >
            <FaCalendarCheck /> Attendance
          </button>
          <button
            type="button"
            className={activeSection === "leaveRequests" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveSection("leaveRequests")}
          >
            <FiFileText /> Leave Requests
          </button>
          <button
            type="button"
            className={activeSection === "inventory" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveSection("inventory")}
          >
            <FiBox /> Inventory Requests
          </button>
          <button
            type="button"
            className={activeSection === "applyLeave" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveSection("applyLeave")}
          >
            <FiCalendar /> Apply Leave
          </button>
          <button
            type="button"
            className={activeSection === "notifications" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveSection("notifications")}
          >
            <FiBell /> Notifications
            {notificationUnreadCount > 0 ? <span className="nav-count">{notificationUnreadCount}</span> : null}
          </button>
          <button
            type="button"
            className={activeSection === "profile" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setActiveSection("profile");
              fetchProfileData();
            }}
          >
            <FiSettings /> Profile
          </button>
          <button type="button" className="nav-item" onClick={handleLogout}>
            <FiLogOut /> Logout
          </button>
        </nav>

      </aside>

      <main className="staff-main">
        <header className="staff-header">
          <div>
            <h1>Welcome back, {displayName}</h1>
            <p>Manage daily temple activities and assigned services.</p>
          </div>
          <div className="header-right">
            <button
              type="button"
              onClick={toggleDarkMode}
              className="notif-button"
              aria-label="Toggle Theme"
              style={{ color: darkMode ? "#fbbf24" : "#d97706" }}
            >
              {darkMode ? <MdLightMode /> : <MdDarkMode />}
            </button>
            <span className="header-date">
              <FiCalendar /> {formatHeaderDate()}
            </span>
            <button
              type="button"
              className="notif-button"
              aria-label="Notifications"
              onClick={() => setActiveSection("notifications")}
            >
              <FiBell />
              {notificationUnreadCount > 0 ? <span>{notificationUnreadCount}</span> : null}
            </button>
            <div 
              className="avatar" 
              style={{ width: '44px', height: '44px', fontSize: '18px', cursor: 'pointer', margin: '0 8px' }}
              onClick={() => {
                setActiveSection("profile");
                fetchProfileData();
              }}
            >
              {profileForm.photo ? (
                <img src={profileForm.photo} alt={displayName} className="avatar-image" />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </div>
            <button
              type="button"
              className="notif-button"
              style={{ color: '#ef4444' }}
              aria-label="Logout"
              onClick={handleLogout}
            >
              <FaSignOutAlt />
            </button>
          </div>
        </header>

        {error ? <div className="staff-error">{error}</div> : null}

        {loading ? <div className="staff-loading">Loading dashboard...</div> : null}

        {!loading && activeSection === "dashboard" ? (
          <>
            <section className="top-cards">
              <article className="info-card">
                <div className="icon-bg orange">
                  <TbChecklist />
                </div>
                <div>
                  <h3>Today's Duties</h3>
                  <strong>{taskSummary.total.toString().padStart(2, "0")}</strong>
                  <p>
                    {taskSummary.total > 1 
                      ? `Includes ${taskSummary.total - 1} extra ${taskSummary.total - 1 === 1 ? 'duty' : 'duties'}` 
                      : taskSummary.total === 1 
                        ? "Regular duty only" 
                        : "No duties assigned"}
                  </p>
                </div>
              </article>
              <article className="info-card">
                <div className="icon-bg red">
                  <TbHourglassLow />
                </div>
                <div>
                  <h3>Today's Duty</h3>
                  <strong>{todayDuty ? todayDuty.dutyName || todayDuty.title || todayDuty.duty || "--" : (profileForm.defaultDuty || "--")}</strong>
                  <p>{todayDuty ? todayDuty.dutyArea || todayDuty.area || "" : (profileForm.dutyLocation || "Default duty location")}</p>
                </div>
              </article>
              <article className="info-card">
                <div className="icon-bg red">
                  <TbHourglassLow />
                </div>
                <div>
                  <h3>Today's Shift</h3>
                  <strong>{todayDuty ? todayDuty.shiftName || "--" : (profileForm.defaultShift || profileForm.shift || "--")}</strong>
                  <p>{todayDuty ? todayDuty.reportingTime || todayDuty.time || "--" : "Default shift"}</p>
                </div>
              </article>
            </section>

            <section className="dashboard-grid">
              <div className="recent-duties-card">
                <div className="card-heading">
                  <div>
                    <h2>Recent Duties</h2>
                    <p>Latest assigned duties for today.</p>
                  </div>
                  <button type="button" className="secondary-btn" onClick={() => setActiveSection("duties")}>View All Duties →</button>
                </div>

                <div className="duties-list">
                  {latestDuties.length === 0 ? (
                    <div className="empty-cell">No duties assigned yet.</div>
                  ) : (
                    latestDuties.map((task) => (
                      <div key={task._id} className="duty-item">
                        <div>
                          <p className="duty-title">{task.shiftName || task.title || task.duty || "Untitled Duty"}</p>
                          <p className="duty-meta">{task.dutyName || task.title || task.duty || "General duty"}</p>
                        </div>
                        <div className="duty-right">
                          <span className="duty-time">{task.reportingTime || task.time || "-"}</span>
                          <span className={`status-chip ${statusClassMap[task.status] || ""}`}>
                            {task.status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="profile-card">
                <h2>Staff Profile</h2>
                <div className="profile-meta">
                  <div className="avatar">
                    {profileForm.photo ? (
                      <img src={profileForm.photo} alt={displayName} className="avatar-image" />
                    ) : (
                      displayName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div>
                    <h3>{displayName}</h3>
                    <p className="role-badge">Temple Staff</p>
                  </div>
                </div>
                <ul>
                  <li>
                    <FiUser /> Employee ID: {staffId || "N/A"}
                  </li>
                  <li>
                    <FiMapPin /> Temple Area Service
                  </li>
                  <li>
                    <FiClock /> Shift: Morning / Evening
                  </li>
                </ul>
                <button type="button" onClick={() => setActiveSection("profile")}>Open Profile Settings</button>
              </div>
            </section>

            <section className="bottom-grid">
              <div className="leave-summary-card">
                <div className="card-heading">
                  <h2>Leave Requests</h2>
                  <button type="button" onClick={() => setActiveSection("leaveRequests")}>
                    View All
                  </button>
                </div>
                <div className="mini-stats">
                  <span>Total Quota: {leaveSummary.totalQuota}</span>
                  <span>Used: {leaveSummary.used}</span>
                  <span>Remaining: {leaveSummary.remaining}</span>
                  <span>Pending: {leaveSummary.pending}</span>
                </div>
                <p className="latest-leave">
                  {latestLeaveDecision
                    ? `Latest decision: ${latestLeaveDecision.status}${latestLeaveDecision.adminReason ? ` (${latestLeaveDecision.adminReason})` : ""}`
                    : "No leave decision yet"}
                </p>
              </div>

              <div className="quick-actions-card">
                <h2>Quick Actions</h2>
                <div className="quick-actions">
                  <button type="button" onClick={() => setActiveSection("duties")}>
                    <FiClipboard />
                    <span>Duty List</span>
                  </button>
                  <button type="button" onClick={() => setActiveSection("applyLeave")}>
                    <FiCalendar />
                    <span>Apply Leave</span>
                  </button>
                  <button type="button" onClick={() => setActiveSection("leaveRequests")}>
                    <FiFileText />
                    <span>Leave Status</span>
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {!loading && activeSection === "duties" ? (
          <section className="duties-page">
            <div className="duties-head">
              <div>
                <h2>My Duties</h2>
                <p>Full duty management for today's staff assignments.</p>
              </div>
              <div className="duties-head-actions">
                <button type="button" onClick={() => setActiveSection("dashboard")}>
                  Back to Overview
                </button>
              </div>
            </div>

            <div className="w-full">
                <div className="card-heading">
                  <h2>All Duties Assigned for Today</h2>
                  <p>{filteredDuties.length} temporary duties found</p>
                </div>

                {/* Default Duty Section */}
                {(profileForm.defaultDuty || profileForm.defaultShift) && (
                  <div className={`mb-4 p-4 rounded-xl border ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-amber-50 border-amber-200'}`}>
                    <h3 className={`font-bold mb-2 ${darkMode ? 'text-amber-500' : 'text-amber-800'}`}>Default Duty (Permanent)</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className={darkMode ? 'text-slate-400' : 'text-slate-600'}>Default Shift:</span>
                        <span className={`ml-2 font-semibold ${darkMode ? 'text-slate-200' : ''}`}>{profileForm.defaultShift || profileForm.shift || "Not assigned"}</span>
                      </div>
                      <div>
                        <span className={darkMode ? 'text-slate-400' : 'text-slate-600'}>Default Duty:</span>
                        <span className={`ml-2 font-semibold ${darkMode ? 'text-slate-200' : ''}`}>{profileForm.defaultDuty || "Not assigned"}</span>
                      </div>
                      <div className="col-span-2">
                        <span className={darkMode ? 'text-slate-400' : 'text-slate-600'}>Duty Location:</span>
                        <span className={`ml-2 font-semibold ${darkMode ? 'text-slate-200' : ''}`}>{profileForm.dutyLocation || "Not assigned"}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="table-wrap duties-table">
                  <table className="task-table">
                    <thead>
                      <tr>
                        <th>Duty Type</th>
                        <th>Shift</th>
                        <th>Duty</th>
                        <th>Area</th>
                        <th>Time</th>
                        <th>Priority</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDuties.length === 0 && !(profileForm.defaultDuty || profileForm.defaultShift) ? (
                        <tr>
                          <td colSpan="7" className="empty-cell">
                            No duties assigned for today.
                          </td>
                        </tr>
                      ) : filteredDuties.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="empty-cell">
                            No temporary duties assigned today. Only default duty is active.
                          </td>
                        </tr>
                      ) : (
                        filteredDuties.map((task) => (
                          <tr
                            key={task._id}
                            className={selectedTask?._id === task._id ? "selected-row" : ""}
                            onClick={() => setSelectedTask(task)}
                          >
                            <td>
                              <span className="bg-violet-100 text-violet-700 px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase">
                                {task.assignmentType || "Extra Duty"}
                              </span>
                            </td>
                            <td>{task.shiftName || "-"}</td>
                            <td>{task.dutyName || task.title || task.duty}</td>
                            <td>{task.dutyArea || task.area || task.description}</td>
                            <td>{task.reportingTime || task.time || "-"}</td>
                            <td>
                              <span className={`px-2 py-1 rounded text-[10px] font-semibold ${
                                task.priority === "Urgent" || task.priority === "High" ? "bg-red-100 text-red-700" :
                                task.priority === "Low" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                              }`}>
                                {task.priority || "Medium"}
                              </span>
                            </td>
                            <td>
                              <span className={`px-2 py-1 rounded text-[10px] font-semibold ${
                                task.status === "Completed" ? "bg-green-100 text-green-700" :
                                task.status === "Cancelled" ? "bg-gray-100 text-gray-700" :
                                "bg-blue-100 text-blue-700"
                              }`}>
                                {task.status || "Assigned"}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
            </div>
          </section>
        ) : null}

        {!loading && activeSection === "leaveRequests" ? (
          <section className="leave-request-page">
            <div className="leave-head">
              <h2>My Leave Requests</h2>
              <button type="button" onClick={() => setActiveSection("applyLeave")}>
                Apply Leave
              </button>
            </div>

            <div className="leave-stat-grid">
              <article>
                <h3>{leaveSummary.totalQuota}</h3>
                <p>Total Quota (12+2)</p>
              </article>
              <article className="approved-box">
                <h3>{leaveSummary.used}</h3>
                <p>Used Leaves (Days)</p>
              </article>
              <article className="pending-box">
                <h3>{leaveSummary.remaining}</h3>
                <p>Remaining Balance</p>
              </article>
              <article className="rejected-box">
                <h3>{leaveSummary.pending}</h3>
                <p>Pending Requests</p>
              </article>
            </div>

            <div className="table-card">
              <div className="table-wrap">
                <table className="task-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Reason</th>
                      <th>Days</th>
                      <th>Period</th>
                      <th>Status</th>
                      <th>Admin Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaves.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="empty-cell">
                          No leave request submitted
                        </td>
                      </tr>
                    ) : (
                      leaves.map((leave) => (
                        <tr key={leave._id}>
                          <td>{leave.leaveType || "General"}</td>
                          <td>{leave.reason}</td>
                          <td>{leaveDaysCount(leave.fromDate, leave.toDate, profileForm?.weeklyOff)}</td>
                          <td>{leavePeriod(leave.fromDate, leave.toDate)}</td>
                          <td>
                            <span className={`status-chip ${statusClassMap[leave.status] || ""}`}>
                              {leave.status}
                            </span>
                          </td>
                          <td>{leave.adminReason || "-"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}

        {!loading && activeSection === "inventory" ? (
          <StaffInventory />
        ) : null}

        {!loading && activeSection === "profile" ? (
          <section className="profile-settings-page" style={{ padding: "0" }}>
            <EmployeeProfileView
              profile={staff}
              user={user}
              profileForm={profileForm}
              passwordForm={passwordForm}
              errors={{}}
              message={profileMessage || passwordMessage}
              messageType={profileMessage === "Profile updated successfully" || passwordMessage === "Password changed successfully" ? "success" : profileMessage || passwordMessage ? "error" : "info"}
              loading={profileLoading}
              savingProfile={profileSaving}
              savingPassword={passwordSaving}
              onFieldChange={handleProfileInputChange}
              onPasswordChange={(field, value) => setPasswordForm((prev) => ({ ...prev, [field]: value }))}
              onSaveProfile={handleProfileSave}
              onChangePassword={handlePasswordSave}
              adminManagedDetails={getStaffProfileDetails(profileForm)}
            />
          </section>
        ) : null}

        {!loading && activeSection === "notifications" ? (
          <Notifications
            staffId={staffId}
            onUnreadCountChange={setNotificationUnreadCount}
            onQuickAction={(section) => setActiveSection(section)}
          />
        ) : null}

        {!loading && activeSection === "attendance" ? (
          <Attendance />
        ) : null}

        {!loading && activeSection === "applyLeave" ? (
          <section className="apply-leave-page">
            <h2>Apply Leave</h2>
            <p>Submit your leave request to admin.</p>

            <form onSubmit={handleLeaveSubmit} className="leave-form">
              <label htmlFor="leaveType">Leave Type</label>
              <select
                id="leaveType"
                value={leaveForm.leaveType}
                onChange={(e) => setLeaveForm((prev) => ({ ...prev, leaveType: e.target.value }))}
              >
                {LEAVE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>

              <label htmlFor="reason">Reason</label>
              <input
                id="reason"
                type="text"
                placeholder="Enter leave reason"
                value={leaveForm.reason}
                onChange={(e) => setLeaveForm((prev) => ({ ...prev, reason: e.target.value }))}
              />

              <div className="date-grid">
                <div>
                  <label htmlFor="fromDate">From Date</label>
                  <input
                    id="fromDate"
                    type="date"
                    value={leaveForm.fromDate}
                    onChange={(e) => setLeaveForm((prev) => ({ ...prev, fromDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="toDate">To Date</label>
                  <input
                    id="toDate"
                    type="date"
                    value={leaveForm.toDate}
                    onChange={(e) => setLeaveForm((prev) => ({ ...prev, toDate: e.target.value }))}
                  />
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" disabled={submittingLeave}>
                  {submittingLeave ? "Submitting..." : "Send Leave Request"}
                </button>
                <button type="button" className="secondary-btn" onClick={() => setActiveSection("dashboard")}>
                  Back to Dashboard
                </button>
              </div>
            </form>
          </section>
        ) : null}
      </main>
    </div>
  );
};

export default StaffDashboard;
