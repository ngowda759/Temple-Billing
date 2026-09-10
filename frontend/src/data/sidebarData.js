import {
  MdDashboard,
  MdTempleBuddhist,
  MdOutlinePayments,
  MdNotifications,
  MdReceiptLong,
  MdManageAccounts,
  MdOutlineSettings,
  MdOutlinePerson,
  MdLogout,
  MdPeopleAlt,
  MdFestival,
  MdVerified,
  MdFeedback,
  MdMeetingRoom,
} from "react-icons/md";
import { FaDonate, FaBoxes, FaCalendarAlt, FaListAlt, FaPlusCircle, FaBullhorn, FaUsers } from "react-icons/fa";
import { HiDocumentReport } from "react-icons/hi";
import { AiOutlinePieChart } from "react-icons/ai";
import { GiTakeMyMoney } from "react-icons/gi";
import { FiRepeat } from "react-icons/fi";
import { RiQrCodeLine } from "react-icons/ri";
import { BiRefresh } from "react-icons/bi";
import { TbReportAnalytics } from "react-icons/tb";

export const sidebarItems = [
  { title: "Dashboard", icon: MdDashboard, path: "/admin" },
  { title: "Devotees Management", icon: MdPeopleAlt, path: "/admin/devotees" },
  { title: "Pooja Booking", icon: MdTempleBuddhist, path: "/admin/pooja" },
  {
    title: "Donations",
    icon: FaDonate,
    path: "/admin/donations",
  },
  { title: "Billing & Payments", icon: MdOutlinePayments, path: "/admin/billing" },
  {
    title: "Prasada",
    icon: FaBoxes,
    path: "/admin/prasada/booked"
  },
  { title: "Inventory", icon: FaBoxes, path: "/admin/inventory" },
  { title: "Room Allotment", icon: MdMeetingRoom, path: "/admin/rooms" },
  {
    title: "Employee Management",
    icon: MdPeopleAlt,
    path: "/admin/employees",
    subItems: [
      { title: "All Employees", path: "/admin/employees" },
      { title: "Add Employee", path: "/admin/employees/add" },
      { title: "Attendance", path: "/admin/employees/attendance" },
      { title: "Payroll", path: "/admin/employees/payroll" },
      { title: "Leave Management", path: "/admin/employees/leave" },
      { title: "Performance", path: "/admin/employees/performance" },
      { title: "Duty, Shift & Transfers", path: "/admin/employees/shifts" },
    ],
  },
  {
    title: "Accounts & Finance",
    icon: TbReportAnalytics,
    path: "/admin/accounts/audit-logs",
    subItems: [
      { title: "Audit Logs", path: "/admin/accounts/audit-logs" },
      { title: "Income", path: "/admin/accounts/income" },
      { title: "Expenses", path: "/admin/accounts/expenses" },
      { title: "Reports", path: "/admin/accounts/reports" },
    ],
  },
  { title: "Events", icon: FaCalendarAlt, path: "/admin/events" },
  { title: "Feedback & Complaints", icon: MdFeedback, path: "/admin/feedback" },
  { title: "Notifications", icon: MdNotifications, path: "/admin/notifications" },
  { title: "Settings", icon: MdOutlineSettings, path: "/admin/settings" },
  { title: "Logout", icon: MdLogout, path: "/logout" },
];
