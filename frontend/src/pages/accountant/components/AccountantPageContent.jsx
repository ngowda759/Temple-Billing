import { useState, useEffect, useMemo } from "react";
import { getEmployeeProfile, updateEmployeeProfile, changeEmployeePassword } from "../../../services/employeeService";
import { fetchBills, fetchRoomBookings } from "../../../services/cashierService";
import { useAuth } from "../../../context/AuthContext";
import { getCashClosings, verifyCashClosing, getTransactions, createManualExpense, getProfitLoss, getExpenseCategories, getDashboardMetrics } from "../../../services/accountService";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  FaBell,
  FaCalendarAlt,
  FaCamera,
  FaCheckCircle,
  FaDownload,
  FaEdit,
  FaEye,
  FaFileExcel,
  FaFilePdf,
  FaFileInvoice,
  FaFilter,
  FaHistory,
  FaLock,
  FaPaperPlane,
  FaPlus,
  FaPrint,
  FaSearch,
  FaShieldAlt,
  FaTrash,
  FaUser,
  FaRupeeSign,
  FaWallet,
  FaDonate,
  FaBed,
  FaClock,
} from "react-icons/fa";
import { MdTempleBuddhist, MdOutlineVolunteerActivism } from "react-icons/md";
import AccountantDonutCard from "./AccountantDonutCard";
import AccountantRevenueChart from "./AccountantRevenueChart";
import Attendance from "../../staff/Attendance";
import LeaveHistory from "../../staff/LeaveHistory";
import LeaveRequest from "../../staff/LeaveRequest";
import StaffInventory from "../../staff/StaffInventory";
import AccountantInventory from "../AccountantInventory";
import EmployeeProfileView from "../../../components/shared/EmployeeProfileView";
import EmailNotificationsView from "../../../components/shared/EmailNotificationsView";
import axios from "axios";
import ManualEntriesView from "./ManualEntriesView";
import ProfitLossView from "./ProfitLossView";
import AccountLedgersView from "./AccountLedgersView";
import {
  accountantStats,
  billingRows,
  billingStats,
  categorySegments,
  collectionTrend,
  dashboardQuickActions,
  devoteePaymentRows,
  devoteePaymentStats,
  donationRows,
  donationSummaryStats,
  inventoryExpenseSegments,
  inventoryRows,
  inventoryStats,
  inventoryTrend,
  monthlySummary,
  notificationRows,
  notificationTabs,
  paymentDailyTrend,
  paymentRows,
  paymentSegments,
  paymentStats,
  pendingBills,
  poojaMonthlyTrend,
  poojaRevenueRows,
  poojaRevenueStats,
  poojaRevenueTypeSegments,
  prasadamItemSegments,
  prasadamRows,
  prasadamStats,
  prasadamTrend,
  profileDetails,
  receiptRows,
  receiptTabs,
  reportCategories,
  reportDonationSegments,
  reportExpenseSegments,
  reportRevenueGrowth,
} from "../accountantDashboardData";

const slugifyStatus = (value) => String(value || "").toLowerCase().replace(/\s+/g, "-");
const titleCase = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const ViewHero = ({ eyebrow, title, description, right }) => (
  <section className="accountant-view__hero">
    <div>
      {eyebrow ? <p className="accountant-view__eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
    {right ? <div className="accountant-view__heroActions">{right}</div> : null}
  </section>
);

const IconStatGrid = ({ items }) => (
  <section className="accountant-stats">
    {items.map((card) => {
      const Icon = card.icon;
      return (
        <article className="accountant-stat-card" key={card.title}>
          <div className="accountant-stat-card__icon" aria-hidden="true">
            <Icon />
          </div>
          <div>
            <p className="accountant-stat-card__title">{card.title}</p>
            <div className="accountant-stat-card__value">{card.value}</div>
            {card.change ? (
              <div className={`accountant-stat-card__change ${card.tone === "down" ? "is-down" : "is-up"}`}>
                <span>{card.change}</span>
              </div>
            ) : null}
          </div>
        </article>
      );
    })}
  </section>
);

const SummaryGrid = ({ items, stacked = false }) => (
  <div className={`accountant-summaryGrid ${stacked ? "accountant-summaryGrid--stacked" : ""}`}>
    {items.map((item) => (
      <article className={`accountant-summaryCard ${item.tone ? `is-${item.tone}` : ""}`} key={item.label}>
        <p className="accountant-summaryCard__label">{item.label}</p>
        <strong className="accountant-summaryCard__value">{item.value}</strong>
        <span className="accountant-summaryCard__note">{item.note}</span>
      </article>
    ))}
  </div>
);

const Toolbar = ({ children }) => <div className="accountant-toolbar">{children}</div>;

const TabsRow = ({ tabs, activeTab, onChange }) => (
  <div className="accountant-tabs" role="tablist" aria-label="Accountant view tabs">
    {tabs.map((tab) => (
      <button
        key={tab}
        type="button"
        role="tab"
        aria-selected={activeTab === tab}
        className={`accountant-tab ${activeTab === tab ? "is-active" : ""}`}
        onClick={() => onChange(tab)}
      >
        {tab}
      </button>
    ))}
  </div>
);

const DataTable = ({ columns, rows, renderRow, emptyText = "No records found." }) => (
  <div className="accountant-tableWrap">
    <table className="accountant-table accountant-table--wide">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column}>{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((row) => renderRow(row))
        ) : (
          <tr>
            <td className="accountant-emptyState" colSpan={columns.length}>
              {emptyText}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

const StatusBadge = ({ value }) => <span className={`accountant-status ${slugifyStatus(value)}`}>{value}</span>;

const RowActions = ({ actions }) => (
  <div className="accountant-actionGroup">
    {actions.map((action) => {
      const Icon = action.icon;
      return (
        <button key={action.label} type="button" className={`accountant-actionButton ${action.tone ? `is-${action.tone}` : ""}`}>
          <Icon />
          <span>{action.label}</span>
        </button>
      );
    })}
  </div>
);

const ProfileField = ({ label, value }) => (
  <div className="accountant-profileField">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const DashboardView = ({ user, currentDate, currentWeekday }) => {
  const [bills, setBills] = useState([]);
  const [roomBookings, setRoomBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });
  
  const [dashMetrics, setDashMetrics] = useState({
    todayIncome: 0,
    todayExpense: 0,
    todayProfit: 0,
    cashInHand: 0,
    pendingPayments: 0
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [billsData, roomData, dashMetricsRes] = await Promise.allSettled([
        fetchBills(),
        fetchRoomBookings(),
        getDashboardMetrics(),
      ]);
      setBills(billsData.status === "fulfilled" ? billsData.value : []);
      setRoomBookings(roomData.status === "fulfilled" ? roomData.value : []);
      if (dashMetricsRes.status === "fulfilled") {
        setDashMetrics(dashMetricsRes.value);
      }
    } catch (err) {
      console.error("Failed to load dashboard data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filter bills by date range
  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      const bDate = new Date(b.billDate || b.createdAt).toISOString().split("T")[0];
      return (!fromDate || bDate >= fromDate) && (!toDate || bDate <= toDate);
    });
  }, [bills, fromDate, toDate]);

  const metrics = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    let todayCollection = 0;
    let todayPooja = 0;
    let todayDonation = 0;
    let todayPrasadam = 0;
    let rangeTotal = 0;
    let totalDonations = 0;
    let poojaRevenue = 0;
    let prasadamRevenue = 0;

    let globalTotalRevenue = 0;
    let globalTotalDonations = 0;
    let globalPoojaRevenue = 0;
    let globalPrasadamRevenue = 0;
    let globalEventRevenue = 1089250;
    let globalEventCount = 0;

    // Payment methods mapping for donut chart
    const methods = { Cash: 0, UPI: 0, Card: 0, "Bank Transfer": 0, "Net Banking": 0 };
    // Category mapping for donut chart
    const categories = { Pooja: 0, Donation: 0, Prasadam: 0, Other: 0 };

    bills.forEach((b) => {
      const bDate = new Date(b.billDate || b.createdAt).toISOString().split("T")[0];
      const amt = Number(b.amount || 0);
      const type = String(b.billType || "Other").toLowerCase();
      const isPaid = String(b.status).toLowerCase() === "paid";

      // Today's collection
      if (bDate === todayStr && isPaid) {
        todayCollection += amt;
        if (type.includes("pooja") || type.includes("booking")) todayPooja += amt;
        else if (type.includes("donation")) todayDonation += amt;
        else if (type.includes("prasadam") || type.includes("sale")) todayPrasadam += amt;
      }

      // Global lifetime stats
      if (isPaid) {
        globalTotalRevenue += amt;
        if (type.includes("event")) {
          globalEventRevenue += amt;
          globalEventCount += 1;
        } else if (type.includes("donation")) {
          globalTotalDonations += amt;
        } else if (type.includes("pooja") || type.includes("booking")) {
          globalPoojaRevenue += amt;
        } else if (type.includes("prasadam") || type.includes("sale")) {
          globalPrasadamRevenue += amt;
        }
      }

      // Range metrics
      if ((!fromDate || bDate >= fromDate) && (!toDate || bDate <= toDate)) {
        if (isPaid) {
          rangeTotal += amt;

          if (type.includes("donation")) {
            totalDonations += amt;
            categories.Donation += amt;
          } else if (type.includes("pooja") || type.includes("booking")) {
            poojaRevenue += amt;
            categories.Pooja += amt;
          } else if (type.includes("prasadam") || type.includes("sale")) {
            prasadamRevenue += amt;
            categories.Prasadam += amt;
          } else {
            categories.Other += amt;
          }

          const mode = b.paymentMode || "Cash";
          if (methods[mode] !== undefined) {
            methods[mode] += amt;
          } else {
            methods.Cash += amt;
          }
        }
      }
    });

    // Today's room bookings
    const todayRoomBookings = roomBookings
      .filter((b) => {
        const bDate = new Date(b.datetime || b.createdAt).toISOString().split("T")[0];
        return bDate === todayStr;
      })
      .reduce((sum, b) => sum + Number(b.amount || 0), 0);

    const paymentSegments = Object.entries(methods)
      .filter(([_, val]) => val > 0)
      .map(([name, value]) => ({ name, value }));

    const categorySegments = Object.entries(categories)
      .filter(([_, val]) => val > 0)
      .map(([name, value]) => ({ name, value }));

    return {
      todayCollection,
      todayPooja,
      todayDonation,
      todayPrasadam,
      todayRoomBookings,
      todayGrandTotal: todayCollection + todayRoomBookings,
      rangeTotal,
      totalDonations,
      poojaRevenue,
      prasadamRevenue,
      globalTotalRevenue,
      globalTotalDonations,
      globalPoojaRevenue,
      globalPrasadamRevenue,
      globalEventRevenue,
      globalEventCount,
      roomBookingTotal: roomBookings
        .filter(b => ["paid", "completed", "active"].includes(String(b.status || "").toLowerCase()))
        .reduce((sum, b) => sum + Number(b.amount || 0), 0),
      roomBookingCount: roomBookings.filter(b => ["paid", "completed", "active"].includes(String(b.status || "").toLowerCase())).length,
      paymentSegments,
      categorySegments,
    };
  }, [bills, roomBookings, fromDate, toDate]);

  // Generate PDF Report
  const handleDownloadReport = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(242, 140, 24); // Temple Orange
    doc.text("SRI SHANTI MAHADEV MANDIR", 40, 55);

    doc.setFontSize(14);
    doc.setTextColor(51, 65, 85);
    doc.text("Accountant Ledger & Transaction Report", 40, 78);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Selected Range: ${fromDate} to ${toDate}`, 40, 98);
    doc.text(`Generated at: ${new Date().toLocaleString("en-IN")}`, 40, 112);

    // Divider
    doc.setDrawColor(242, 140, 24);
    doc.setLineWidth(1.5);
    doc.line(40, 122, 550, 122);

    // Summary Section
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Financial Range Summary", 40, 145);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`- Total Range Collections: Rs ${metrics.rangeTotal.toLocaleString("en-IN")}`, 50, 165);
    doc.text(`- Total Pooja Bookings Value: Rs ${metrics.poojaRevenue.toLocaleString("en-IN")}`, 50, 180);
    doc.text(`- Total Donations Value: Rs ${metrics.totalDonations.toLocaleString("en-IN")}`, 50, 195);
    doc.text(`- Total Prasadam Sales Value: Rs ${metrics.prasadamRevenue.toLocaleString("en-IN")}`, 50, 210);

    // Table of transactions
    const tableData = filteredBills.map((b, index) => [
      new Date(b.billDate || b.createdAt).toLocaleDateString("en-IN"),
      b.referenceNo || `TXN-${String(index + 1).padStart(4, "0")}`,
      b.devoteeName || "-",
      b.billType || "Other",
      b.sevaType || "-",
      `Rs ${Number(b.amount || 0).toLocaleString("en-IN")}`,
      b.paymentMode || "Cash",
      b.status || "Paid",
    ]);

    autoTable(doc, {
      startY: 235,
      head: [["Date", "Receipt No", "Devotee Name", "Type", "Service", "Amount", "Mode", "Status"]],
      body: tableData,
      theme: "striped",
      headStyles: { fillColor: [242, 140, 24] },
      styles: { fontSize: 8 },
    });

    doc.save(`Financial_Report_${fromDate}_to_${toDate}.pdf`);
  };

  const statCards = [
    { title: "Today's Income", value: `Rs ${dashMetrics.todayIncome?.toLocaleString("en-IN") || '0'}`, icon: FaRupeeSign },
    { title: "Today's Expense", value: `Rs ${dashMetrics.todayExpense?.toLocaleString("en-IN") || '0'}`, icon: FaFileInvoice },
    { title: "Cash In Hand", value: `Rs ${dashMetrics.cashInHand?.toLocaleString("en-IN") || '0'}`, icon: FaWallet },
    { title: "Total Revenue", value: `Rs ${metrics.globalTotalRevenue.toLocaleString("en-IN")}`, icon: FaWallet },
    { title: "Pooja Revenue", value: `Rs ${metrics.globalPoojaRevenue.toLocaleString("en-IN")}`, icon: MdTempleBuddhist },
    { title: "Total Donations", value: `Rs ${metrics.globalTotalDonations.toLocaleString("en-IN")}`, icon: FaDonate },
    { title: "Prasadam Revenue", value: `Rs ${metrics.globalPrasadamRevenue.toLocaleString("en-IN")}`, icon: MdOutlineVolunteerActivism },
    { title: "Room Booked Revenue", value: `Rs ${metrics.roomBookingTotal.toLocaleString("en-IN")}`, icon: FaBed },
  ];

  if (loading) {
    return (
      <div className="accountant-view flex items-center justify-center py-20">
        <p className="text-slate-500 dark:text-slate-400 font-semibold">Loading ledger transactions...</p>
      </div>
    );
  }

  return (
    <div className="accountant-view">
      <ViewHero
        eyebrow="Accountant Workspace"
        title="Welcome Accountant"
        description={`Overview of temple financial activities.`}
        right={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 bg-temple-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl">
              <span className="font-bold">From:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 bg-temple-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl">
              <span className="font-bold">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="outline-none"
              />
            </div>
            <button
              type="button"
              onClick={handleDownloadReport}
              className="accountant-primaryButton"
            >
              <FaDownload /> Download Range Report
            </button>
          </div>
        }
      />

      <IconStatGrid items={statCards} />

      <section className="accountant-panels accountant-panels--top">
        <article className="accountant-panel">
          <div className="accountant-panel__header">
            <div>
              <p className="accountant-panel__eyebrow">Overview</p>
              <h3 className="accountant-panel__title">Transactions ledger ({filteredBills.length} records)</h3>
            </div>
          </div>

          <div className="accountant-tableWrap mt-4">
            <table className="accountant-table accountant-table--wide">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Receipt No.</th>
                  <th>Devotee Name</th>
                  <th>Type</th>
                  <th>Service</th>
                  <th>Amount</th>
                  <th>Payment Mode</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredBills.length ? (
                  filteredBills.slice(0, 10).map((bill, index) => (
                    <tr key={bill._id || index}>
                      <td>{new Date(bill.billDate || bill.createdAt).toLocaleDateString("en-IN")}</td>
                      <td className="font-bold text-slate-900 dark:text-slate-100">{bill.referenceNo || `TXN-${String(index + 1).padStart(4, "0")}`}</td>
                      <td className="font-semibold text-slate-800 dark:text-slate-200">{bill.devoteeName}</td>
                      <td>{bill.billType}</td>
                      <td>{bill.sevaType}</td>
                      <td className="font-bold text-slate-900 dark:text-slate-100">Rs {Number(bill.amount || 0).toLocaleString("en-IN")}</td>
                      <td>{bill.paymentMode}</td>
                      <td>
                        <StatusBadge value="Paid" />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="8" className="accountant-emptyState text-center py-8 text-slate-500 dark:text-slate-400">
                      No ledger transactions found in the selected range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="accountant-panels accountant-panels--bottom">
        <article className="accountant-panel">
          <div className="accountant-panel__header">
            <div>
              <p className="accountant-panel__eyebrow">Today's Summary</p>
              <h3 className="accountant-panel__title">Today's Revenue</h3>
            </div>
          </div>
          <div className="accountant-summary">
            <div className="accountant-summary__row">
              <span>Pooja Bookings</span>
              <strong>Rs {metrics.todayPooja.toLocaleString("en-IN")}</strong>
            </div>
            <div className="accountant-summary__row">
              <span>Donations</span>
              <strong>Rs {metrics.todayDonation.toLocaleString("en-IN")}</strong>
            </div>
            <div className="accountant-summary__row">
              <span>Prasadam Sales</span>
              <strong>Rs {metrics.todayPrasadam.toLocaleString("en-IN")}</strong>
            </div>
            <div className="accountant-summary__row">
              <span>Room Bookings</span>
              <strong>Rs {metrics.todayRoomBookings.toLocaleString("en-IN")}</strong>
            </div>
            <div className="accountant-summary__row is-positive">
              <span>Today's Total</span>
              <strong>Rs {metrics.todayGrandTotal.toLocaleString("en-IN")}</strong>
            </div>
          </div>
        </article>
      </section>


    </div>
  );
};

const DonationsView = ({ bills, loading }) => {
  const [search, setSearch] = useState("");
  const donationBills = useMemo(() => {
    return bills.filter((b) => {
      const isDon = String(b.billType || "").toLowerCase().includes("donation");
      const nameMatch = String(b.devoteeName || "").toLowerCase().includes(search.toLowerCase());
      const refMatch = String(b.referenceNo || "").toLowerCase().includes(search.toLowerCase());
      return isDon && (nameMatch || refMatch);
    });
  }, [bills, search]);

  const totalDonations = useMemo(() => {
    return donationBills.reduce((sum, b) => sum + Number(b.amount || 0), 0);
  }, [donationBills]);

  const donationSummaryStats = [
    { label: "Total Donations", value: donationBills.length, note: "All categories" },
    { label: "Donation Value", value: `Rs ${totalDonations.toLocaleString("en-IN")}`, note: "Settled revenue" }
  ];

  if (loading) {
    return <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading donations ledger...</div>;
  }

  return (
    <div className="accountant-view">
      <ViewHero
        eyebrow="Donation Management"
        title="Donations"
        description="Track donation receipts, donor details, payment methods and settlement status."
        right={
          <span className="accountant-chip">
            <MdOutlineVolunteerActivism /> Real-time Ledger
          </span>
        }
      />

      <Toolbar>
        <label className="accountant-field accountant-field--search">
          <FaSearch />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by devotee name or receipt..."
          />
        </label>
      </Toolbar>

      <div className="accountant-twoColumn">
        <section className="accountant-panel">
          <div className="accountant-panel__header">
            <div>
              <p className="accountant-panel__eyebrow">Donation Ledger</p>
              <h3 className="accountant-panel__title">Donation Table</h3>
            </div>
          </div>

          <DataTable
            columns={["Receipt Number", "Donor Name", "Amount", "Payment Method", "Date", "Status"]}
            rows={donationBills}
            renderRow={(row, idx) => (
              <tr key={row._id || idx}>
                <td className="font-bold text-slate-900 dark:text-slate-100">{row.referenceNo || `TXN-${String(idx + 1).padStart(4, "0")}`}</td>
                <td className="font-semibold text-slate-800 dark:text-slate-200">{row.devoteeName}</td>
                <td className="font-bold text-slate-900 dark:text-slate-100">Rs {Number(row.amount || 0).toLocaleString("en-IN")}</td>
                <td>{row.paymentMode}</td>
                <td>{new Date(row.billDate || row.createdAt).toLocaleDateString("en-IN")}</td>
                <td>
                  <StatusBadge value={row.status || "Paid"} />
                </td>
              </tr>
            )}
          />
        </section>

        <aside className="accountant-sideRail">
          <SummaryGrid items={donationSummaryStats} stacked />
        </aside>
      </div>
    </div>
  );
};

const BillingView = ({ bills, loading }) => {
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtered = useMemo(() => {
    return bills.filter((b) => {
      const bDate = new Date(b.billDate || b.createdAt || Date.now()).toISOString().split("T")[0];
      const dateMatch = (!fromDate || bDate >= fromDate) && (!toDate || bDate <= toDate);
      const nameMatch = String(b.devoteeName || "").toLowerCase().includes(search.toLowerCase());
      const refMatch = String(b.referenceNo || "").toLowerCase().includes(search.toLowerCase());
      const sevaMatch = String(b.sevaType || "").toLowerCase().includes(search.toLowerCase());
      return dateMatch && (nameMatch || refMatch || sevaMatch);
    });
  }, [bills, search, fromDate, toDate]);

  const paidCount = filtered.filter(b => String(b.status).toLowerCase() === "paid").length;
  const pendingCount = filtered.filter(b => String(b.status).toLowerCase() === "pending").length;
  const totalRevenue = filtered.filter(b => String(b.status).toLowerCase() === "paid").reduce((sum, b) => sum + Number(b.amount || 0), 0);

  const billingStats = [
    { label: "Total Bills", value: filtered.length, note: "All generated bills" },
    { label: "Paid Bills", value: paidCount, note: "Settled payments" },
    { label: "Total Billing Revenue", value: `Rs ${totalRevenue.toLocaleString("en-IN")}`, note: "Paid cycles" },
  ];

  if (loading) {
    return <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading bills directory...</div>;
  }

  const handleDownloadReport = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(`Billing Report`, 40, 40);

    const head = [["Bill Number", "Devotee Name", "Service Name", "Amount", "Status", "Date"]];
    const body = filtered.map((row, idx) => [
      row.referenceNo || `TXN-${String(idx + 1).padStart(4, "0")}`,
      row.devoteeName || "-",
      row.sevaType || "-",
      `Rs ${Number(row.amount || 0).toLocaleString("en-IN")}`,
      "Paid",
      new Date(row.billDate || row.createdAt).toLocaleDateString("en-IN")
    ]);

    autoTable(doc, {
      startY: 60,
      head: head,
      body: body,
      theme: "grid",
    });

    doc.save(`Billing_Report.pdf`);
  };

  return (
    <div className="accountant-view">
      <ViewHero
        eyebrow="Billing Management"
        title="Billing"
        description="Auditing workspace for all generated temple bills."
        right={
          <button type="button" className="accountant-primaryButton" onClick={handleDownloadReport}>
            <FaDownload /> Download Report
          </button>
        }
      />

      <Toolbar>
        <label className="accountant-field accountant-field--search" style={{ flex: 1 }}>
          <FaSearch />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by devotee, receipt, or service..."
          />
        </label>
        <div style={{ display: "flex", gap: "1rem" }}>
          <label className="accountant-field">
            <span style={{ fontSize: "0.75rem", color: "#64748b", position: "absolute", top: "-18px", left: "4px", fontWeight: "600" }}>From Date</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="accountant-field">
            <span style={{ fontSize: "0.75rem", color: "#64748b", position: "absolute", top: "-18px", left: "4px", fontWeight: "600" }}>To Date</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
        </div>
      </Toolbar>

      <SummaryGrid items={billingStats} />

      <section className="accountant-panel">
        <div className="accountant-panel__header">
          <div>
            <p className="accountant-panel__eyebrow">Bills</p>
            <h3 className="accountant-panel__title">Billing Table</h3>
          </div>
        </div>

        <DataTable
          columns={["Bill Number", "Devotee Name", "Service Name", "Amount", "Status", "Date"]}
          rows={filtered}
          renderRow={(row, idx) => (
            <tr key={row._id || idx}>
              <td className="font-bold text-slate-900 dark:text-slate-100">{row.referenceNo || `TXN-${String(idx + 1).padStart(4, "0")}`}</td>
              <td className="font-semibold text-slate-800 dark:text-slate-200">{row.devoteeName}</td>
              <td>{row.sevaType}</td>
              <td className="font-bold text-slate-900 dark:text-slate-100">Rs {Number(row.amount || 0).toLocaleString("en-IN")}</td>
              <td>
                <StatusBadge value="Paid" />
              </td>
              <td>{new Date(row.billDate || row.createdAt).toLocaleDateString("en-IN")}</td>
            </tr>
          )}
        />
      </section>
    </div>
  );
};

const PaymentsView = ({ bills, loading }) => {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    return bills.filter((b) => {
      const nameMatch = String(b.devoteeName || "").toLowerCase().includes(search.toLowerCase());
      const refMatch = String(b.referenceNo || "").toLowerCase().includes(search.toLowerCase());
      return nameMatch || refMatch;
    });
  }, [bills, search]);

  const verifiedCount = filtered.filter(b => String(b.status).toLowerCase() === "paid").length;
  const pendingCount = filtered.filter(b => String(b.status).toLowerCase() === "pending").length;
  const totalAmount = filtered.reduce((sum, b) => sum + Number(b.amount || 0), 0);

  const paymentStats = [
    { label: "Total Transactions", value: filtered.length, note: "All logged payments" },
    { label: "Verified / Paid", value: verifiedCount, note: "Settled successfully" },
    { label: "Pending Verification", value: pendingCount, note: "Awaiting Razorpay/ledger validation" },
    { label: "Transaction Value", value: `Rs ${totalAmount.toLocaleString("en-IN")}`, note: "Accumulated volume" },
  ];

  const paymentSegments = useMemo(() => {
    const modes = {};
    filtered.forEach((b) => {
      const mode = b.paymentMode || "Cash";
      modes[mode] = (modes[mode] || 0) + Number(b.amount || 0);
    });
    return Object.entries(modes).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  if (loading) {
    return <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading payments...</div>;
  }

  return (
    <div className="accountant-view">
      <ViewHero
        eyebrow="Payment Management"
        title="Payments"
        description="Monitor daily payments, verify settlements and review channel-wise collections."
        right={
          <span className="accountant-chip">
            <FaShieldAlt /> Transaction Ledger
          </span>
        }
      />

      <Toolbar>
        <label className="accountant-field accountant-field--search">
          <FaSearch />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transactions..."
          />
        </label>
      </Toolbar>

      <SummaryGrid items={paymentStats} />

      <div className="accountant-twoColumn accountant-twoColumn--charts">
        <section className="accountant-panel">
          <div className="accountant-panel__header">
            <div>
              <p className="accountant-panel__eyebrow">Transactions</p>
              <h3 className="accountant-panel__title">Payment Table</h3>
            </div>
          </div>

          <DataTable
            columns={["Transaction ID", "Devotee Name", "Amount", "Payment Method", "Payment Status", "Date"]}
            rows={filtered}
            renderRow={(row, idx) => (
              <tr key={row._id || idx}>
                <td className="font-bold text-slate-900 dark:text-slate-100">{row.referenceNo || `TXN-${String(idx + 1).padStart(4, "0")}`}</td>
                <td className="font-semibold text-slate-800 dark:text-slate-200">{row.devoteeName}</td>
                <td className="font-bold text-slate-900 dark:text-slate-100">Rs {Number(row.amount || 0).toLocaleString("en-IN")}</td>
                <td>{row.paymentMode}</td>
                <td>
                  <StatusBadge value={row.status || "Paid"} />
                </td>
                <td>{new Date(row.billDate || row.createdAt).toLocaleDateString("en-IN")}</td>
              </tr>
            )}
          />
        </section>

        <aside className="accountant-sideRail accountant-sideRail--chart">
          <AccountantDonutCard
            title="Payment Method Distribution"
            subtitle="Charts"
            segments={paymentSegments.length ? paymentSegments : [{ name: "No Data", value: 1 }]}
            centerValue={`Rs ${totalAmount.toLocaleString("en-IN")}`}
            centerLabel="Total payments"
          />
        </aside>
      </div>
    </div>
  );
};

const ReceiptsView = ({ bills, roomBookings = [], loading }) => {
  const [activeTab, setActiveTab] = useState("Pooja Booking");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtered = useMemo(() => {
    if (activeTab === "Room Booked Collection") {
      return roomBookings.filter((b) => {
        const bDate = new Date(b.datetime || b.createdAt || Date.now()).toISOString().split("T")[0];
        const dateMatch = (!fromDate || bDate >= fromDate) && (!toDate || bDate <= toDate);
        const nameMatch = String(b.devoteeName || b.devoteePhone || "").toLowerCase().includes(search.toLowerCase());
        const serviceMatch = String(b.service || "").toLowerCase().includes(search.toLowerCase());
        return dateMatch && (nameMatch || serviceMatch);
      });
    }
    return bills.filter((b) => {
      const bDate = new Date(b.billDate || b.createdAt || Date.now()).toISOString().split("T")[0];
      const dateMatch = (!fromDate || bDate >= fromDate) && (!toDate || bDate <= toDate);
      const type = String(b.billType || "").toLowerCase();
      let matchTab = false;
      if (activeTab === "Pooja Booking") {
        matchTab = type.includes("pooja") || type.includes("booking");
      } else if (activeTab === "Donation") {
        matchTab = type.includes("donation");
      } else if (activeTab === "Prasadam") {
        matchTab = type.includes("prasadam") || type.includes("sale");
      }
      const nameMatch = String(b.devoteeName || "").toLowerCase().includes(search.toLowerCase());
      const refMatch = String(b.referenceNo || "").toLowerCase().includes(search.toLowerCase());
      return dateMatch && matchTab && (nameMatch || refMatch);
    });
  }, [bills, roomBookings, activeTab, search, fromDate, toDate]);

  // Room booking summary
  const roomTotal = useMemo(() => roomBookings.reduce((sum, b) => sum + Number(b.amount || 0), 0), [roomBookings]);
  const roomCount = roomBookings.length;
  const roomAvg = roomCount > 0 ? Math.round(roomTotal / roomCount) : 0;
  const roomSummaryStats = [
    { label: "Total Room Bookings", value: roomCount, note: "All time" },
    { label: "Total Collected", value: `Rs ${roomTotal.toLocaleString("en-IN")}`, note: "Room booking revenue" },
    { label: "Average Per Booking", value: `Rs ${roomAvg.toLocaleString("en-IN")}`, note: "Per room stay" },
  ];

  const receiptTabs = ["Pooja Booking", "Donation", "Prasadam", "Room Booked Collection"];

  const handleDownloadReport = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(`${activeTab} Report`, 40, 40);

    let head = [];
    let body = [];

    if (activeTab === "Room Booked Collection") {
      head = [["Booking ID", "Devotee Name", "Room / Service", "Days", "Amount", "Payment Mode", "Date"]];
      body = filtered.map((row, idx) => [
        row._id ? `RM-${String(row._id).slice(-6).toUpperCase()}` : `RM-${String(idx + 1).padStart(4, "0")}`,
        row.devoteeName || row.devoteePhone || "-",
        String(row.service || "").replace("Room Allotment: ", "") || "-",
        row.days || "-",
        `Rs ${Number(row.amount || 0).toLocaleString("en-IN")}`,
        row.paymentMethod || row.payMode || "-",
        row.datetime ? new Date(row.datetime).toLocaleDateString("en-IN") : new Date(row.createdAt || Date.now()).toLocaleDateString("en-IN")
      ]);
    } else {
      head = [["Receipt ID", "Receipt Type", "Name", "Amount", "Date"]];
      body = filtered.map((row, idx) => [
        row.referenceNo || `TXN-${String(idx + 1).padStart(4, "0")}`,
        row.billType || "-",
        row.devoteeName || "-",
        `Rs ${Number(row.amount || 0).toLocaleString("en-IN")}`,
        new Date(row.billDate || row.createdAt).toLocaleDateString("en-IN")
      ]);
    }

    autoTable(doc, {
      startY: 60,
      head: head,
      body: body,
      theme: "grid",
    });

    doc.save(`${activeTab.replace(/\s+/g, "_")}_Report.pdf`);
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading receipts...</div>;
  }

  return (
    <div className="accountant-view">
      <ViewHero
        eyebrow="Receipt Center"
        title="Receipts"
        description="Browse all system receipts across donations, poojas, payments, bills, and room bookings."
        right={
          <button type="button" className="accountant-primaryButton" onClick={handleDownloadReport}>
            <FaDownload /> Download Report
          </button>
        }
      />

      <TabsRow tabs={receiptTabs} activeTab={activeTab} onChange={setActiveTab} />

      <Toolbar>
        <label className="accountant-field accountant-field--search" style={{ flex: 1 }}>
          <FaSearch />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={activeTab === "Room Booked Collection" ? "Search by devotee name or room..." : "Search by devotee name or receipt no..."}
          />
        </label>
        <div style={{ display: "flex", gap: "1rem" }}>
          <label className="accountant-field">
            <span style={{ fontSize: "0.75rem", color: "#64748b", position: "absolute", top: "-18px", left: "4px", fontWeight: "600" }}>From Date</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="accountant-field">
            <span style={{ fontSize: "0.75rem", color: "#64748b", position: "absolute", top: "-18px", left: "4px", fontWeight: "600" }}>To Date</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
        </div>
      </Toolbar>

      {activeTab === "Room Booked Collection" ? (
        <div>
          <SummaryGrid items={roomSummaryStats} />
          <section className="accountant-panel" style={{ marginTop: "14px" }}>
            <div className="accountant-panel__header">
              <div>
                <p className="accountant-panel__eyebrow">Room Bookings</p>
                <h3 className="accountant-panel__title">Room Booking Collection History</h3>
              </div>
            </div>
            <DataTable
              columns={["Booking ID", "Devotee Name", "Room / Service", "Days", "Amount", "Payment Mode", "Date"]}
              rows={filtered}
              emptyText="No room bookings found."
              renderRow={(row, idx) => (
                <tr key={row._id || idx}>
                  <td className="font-bold text-slate-900 dark:text-slate-100">
                    {row._id ? `RM-${String(row._id).slice(-6).toUpperCase()}` : `RM-${String(idx + 1).padStart(4, "0")}`}
                  </td>
                  <td className="font-semibold text-slate-800 dark:text-slate-200">{row.devoteeName || row.devoteePhone || "-"}</td>
                  <td>{String(row.service || "").replace("Room Allotment: ", "") || "-"}</td>
                  <td>{row.days || "-"}</td>
                  <td className="font-bold text-slate-900 dark:text-slate-100">Rs {Number(row.amount || 0).toLocaleString("en-IN")}</td>
                  <td>{row.paymentMethod || row.payMode || "-"}</td>
                  <td>
                    {row.datetime
                      ? new Date(row.datetime).toLocaleDateString("en-IN")
                      : new Date(row.createdAt || Date.now()).toLocaleDateString("en-IN")}
                  </td>
                </tr>
              )}
            />
          </section>
        </div>
      ) : (
        <section className="accountant-panel">
          <div className="accountant-panel__header">
            <div>
              <p className="accountant-panel__eyebrow">{activeTab}</p>
              <h3 className="accountant-panel__title">System Receipts</h3>
            </div>
          </div>
          <DataTable
            columns={["Receipt ID", "Receipt Type", "Name", "Amount", "Date"]}
            rows={filtered}
            renderRow={(row, idx) => (
              <tr key={row._id || idx}>
                <td className="font-bold text-slate-900 dark:text-slate-100">{row.referenceNo || `TXN-${String(idx + 1).padStart(4, "0")}`}</td>
                <td>{row.billType}</td>
                <td className="font-semibold text-slate-800 dark:text-slate-200">{row.devoteeName}</td>
                <td className="font-bold text-slate-900 dark:text-slate-100">Rs {Number(row.amount || 0).toLocaleString("en-IN")}</td>
                <td>{new Date(row.billDate || row.createdAt).toLocaleDateString("en-IN")}</td>
              </tr>
            )}
          />
        </section>
      )}
    </div>
  );
};

const PoojaRevenueView = ({ bills, loading }) => {
  const poojaBills = useMemo(() => {
    return bills.filter((b) => String(b.billType || "").toLowerCase().includes("pooja") || String(b.billType || "").toLowerCase().includes("booking"));
  }, [bills]);

  const totalAmount = poojaBills.reduce((sum, b) => sum + Number(b.amount || 0), 0);
  const totalCount = poojaBills.length;
  const averageValue = totalCount > 0 ? Math.round(totalAmount / totalCount) : 0;

  const poojaRevenueStats = [
    { label: "Pooja Bookings", value: totalCount, note: "All services" },
    { label: "Pooja Revenue", value: `Rs ${totalAmount.toLocaleString("en-IN")}`, note: "Settled volume" },
    { label: "Average Value", value: `Rs ${averageValue.toLocaleString("en-IN")}`, note: "Per booking" }
  ];

  const poojaSegments = useMemo(() => {
    const categories = {};
    poojaBills.forEach((b) => {
      const name = b.sevaType || "General Seva";
      categories[name] = (categories[name] || 0) + Number(b.amount || 0);
    });
    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [poojaBills]);

  if (loading) {
    return <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading pooja ledger...</div>;
  }

  return (
    <div className="accountant-view">
      <ViewHero
        eyebrow="Pooja Revenue"
        title="Pooja Revenue"
        description="Revenue from pooja services, booking activity and monthly collection trends."
        right={<span className="accountant-chip"><MdTempleBuddhist /> Revenue Focus</span>}
      />

      <SummaryGrid items={poojaRevenueStats} />

      <div className="accountant-twoColumn accountant-twoColumn--charts">
        <section className="accountant-panel">
          <div className="accountant-panel__header">
            <div>
              <p className="accountant-panel__eyebrow">Revenue Ledger</p>
              <h3 className="accountant-panel__title">Pooja Revenue Table</h3>
            </div>
          </div>

          <DataTable
            columns={["Booking ID", "Devotee Name", "Pooja Name", "Amount", "Date"]}
            rows={poojaBills}
            renderRow={(row, idx) => (
              <tr key={row._id || idx}>
                <td className="font-bold text-slate-900 dark:text-slate-100">{row.referenceNo || `TXN-${String(idx + 1).padStart(4, "0")}`}</td>
                <td className="font-semibold text-slate-800 dark:text-slate-200">{row.devoteeName}</td>
                <td>{row.sevaType}</td>
                <td className="font-bold text-slate-900 dark:text-slate-100">Rs {Number(row.amount || 0).toLocaleString("en-IN")}</td>
                <td>{new Date(row.billDate || row.createdAt).toLocaleDateString("en-IN")}</td>
              </tr>
            )}
          />
        </section>

        <aside className="accountant-sideRail accountant-sideRail--chart">
          <AccountantDonutCard
            title="Revenue by Pooja Type"
            subtitle="Charts"
            segments={poojaSegments.length ? poojaSegments : [{ name: "No Data", value: 1 }]}
            centerValue={`Rs ${totalAmount.toLocaleString("en-IN")}`}
            centerLabel="Total revenue"
          />
        </aside>
      </div>
    </div>
  );
};

const PrasadamSalesView = ({ bills, loading }) => {
  const prasadamBills = useMemo(() => {
    return bills.filter((b) => String(b.billType || "").toLowerCase().includes("prasadam") || String(b.billType || "").toLowerCase().includes("sale"));
  }, [bills]);

  const totalAmount = prasadamBills.reduce((sum, b) => sum + Number(b.amount || 0), 0);
  const totalCount = prasadamBills.length;
  const averageValue = totalCount > 0 ? Math.round(totalAmount / totalCount) : 0;

  const prasadamStats = [
    { label: "Prasadam Sales", value: totalCount, note: "All items" },
    { label: "Prasadam Revenue", value: `Rs ${totalAmount.toLocaleString("en-IN")}`, note: "Settled volume" },
    { label: "Average Order Value", value: `Rs ${averageValue.toLocaleString("en-IN")}`, note: "Per order" }
  ];

  const itemSegments = useMemo(() => {
    const items = {};
    prasadamBills.forEach((b) => {
      const name = b.sevaType || "Prasadam Item";
      items[name] = (items[name] || 0) + Number(b.amount || 0);
    });
    return Object.entries(items).map(([name, value]) => ({ name, value }));
  }, [prasadamBills]);

  if (loading) {
    return <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading prasadam sales...</div>;
  }

  return (
    <div className="accountant-view">
      <ViewHero
        eyebrow="Prasadam Sales"
        title="Prasadam Sales"
        description="Track daily sales, monthly revenue and item-wise performance for prasadam counters."
        right={<span className="accountant-chip"><FaCheckCircle /> Sales Focus</span>}
      />

      <SummaryGrid items={prasadamStats} />

      <div className="accountant-twoColumn accountant-twoColumn--charts">
        <section className="accountant-panel">
          <div className="accountant-panel__header">
            <div>
              <p className="accountant-panel__eyebrow">Sales Ledger</p>
              <h3 className="accountant-panel__title">Prasadam Table</h3>
            </div>
          </div>

          <DataTable
            columns={["Order ID", "Devotee Name", "Item / Seva Name", "Total Amount", "Date"]}
            rows={prasadamBills}
            renderRow={(row, idx) => (
              <tr key={row._id || idx}>
                <td className="font-bold text-slate-900 dark:text-slate-100">{row.referenceNo || `TXN-${String(idx + 1).padStart(4, "0")}`}</td>
                <td className="font-semibold text-slate-800 dark:text-slate-200">{row.devoteeName}</td>
                <td>{row.sevaType}</td>
                <td className="font-bold text-slate-900 dark:text-slate-100">Rs {Number(row.amount || 0).toLocaleString("en-IN")}</td>
                <td>{new Date(row.billDate || row.createdAt).toLocaleDateString("en-IN")}</td>
              </tr>
            )}
          />
        </section>

        <aside className="accountant-sideRail accountant-sideRail--chart">
          <AccountantDonutCard
            title="Item-wise Revenue"
            subtitle="Revenue split"
            segments={itemSegments.length ? itemSegments : [{ name: "No Data", value: 1 }]}
            centerValue={`Rs ${totalAmount.toLocaleString("en-IN")}`}
            centerLabel="Sales total"
          />
        </aside>
      </div>
    </div>
  );
};

const InventoryFinanceView = () => (
  <AccountantInventory />
);

const DevoteePaymentsView = () => (
  <div className="accountant-view">
    <ViewHero
      eyebrow="Devotee Payments"
      title="Devotee Payments"
      description="Review all payments made by devotees and manage follow-up reminders."
      right={<span className="accountant-chip"><FaHistory /> Payment History</span>}
    />

    <SummaryGrid items={devoteePaymentStats} />

    <section className="accountant-panel">
      <div className="accountant-panel__header">
        <div>
          <p className="accountant-panel__eyebrow">Devotee Ledger</p>
          <h3 className="accountant-panel__title">All Devotee Payments</h3>
        </div>
      </div>

      <DataTable
        columns={["Devotee Name", "Mobile", "Payment Type", "Amount", "Status", "Date", "Actions"]}
        rows={devoteePaymentRows}
        renderRow={(row) => (
          <tr key={`${row.devoteeName}-${row.date}`}>
            <td>{row.devoteeName}</td>
            <td>{row.mobile}</td>
            <td>{row.paymentType}</td>
            <td>{row.amount}</td>
            <td>
              <StatusBadge value={row.status} />
            </td>
            <td>{row.date}</td>
            <td>
              <RowActions
                actions={[
                  { icon: FaHistory, label: "View History" },
                  { icon: FaDownload, label: "Download Receipt", tone: "primary" },
                  { icon: FaPaperPlane, label: "Send Reminder" },
                ]}
              />
            </td>
          </tr>
        )}
      />
    </section>
  </div>
);

const ReportsAnalyticsView = () => (
  <div className="accountant-view">
    <ViewHero
      eyebrow="Reports & Analytics"
      title="Reports & Analytics"
      description="Export reports, compare trends and review temple-wide revenue and expense analytics."
      right={
        <div className="accountant-exportGroup">
          <button type="button" className="accountant-secondaryButton">
            <FaFilePdf />
            Export PDF
          </button>
          <button type="button" className="accountant-secondaryButton">
            <FaFileExcel />
            Export Excel
          </button>
          <button type="button" className="accountant-primaryButton">
            <FaPrint />
            Print Report
          </button>
        </div>
      }
    />

    <section className="accountant-reportGrid">
      {reportCategories.map((label) => (
        <button key={label} type="button" className="accountant-reportCard">
          <span className="accountant-reportCard__label">{label}</span>
          <span className="accountant-reportCard__desc">Open report</span>
        </button>
      ))}
    </section>

    <section className="accountant-panels accountant-panels--top">
      <AccountantRevenueChart
        title="Revenue Growth"
        subtitle="Reports"
        points={reportRevenueGrowth}
        rangeLabel="This Year"
        summaryLabel="Growth"
        summaryValue="Rs 38,00,000"
        trendLabel="+16.5% from last year"
      />

      <AccountantDonutCard
        title="Donation Trends"
        subtitle="Reports"
        segments={reportDonationSegments}
        centerValue="45%"
        centerLabel="Donation share"
      />

      <AccountantDonutCard
        title="Collection Analysis"
        subtitle="Reports"
        segments={categorySegments}
        centerValue="Rs 25,000"
        centerLabel="Daily collection"
      />

      <AccountantDonutCard
        title="Expense Analysis"
        subtitle="Reports"
        segments={reportExpenseSegments}
        centerValue="20%"
        centerLabel="Utilities share"
      />
    </section>
  </div>
);

const NotificationsView = ({ user }) => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadNotifications = async () => {
    try {
      setLoading(true);
      setError("");
      const userId = user?.id || user?._id || "accountant";
      const { data } = await axios.get(`http://localhost:5000/api/notifications/accountant/${userId}`);
      setNotifications(data?.notifications || data || []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [user]);

  const handleRead = async (id) => {
    try {
      await axios.put(`http://localhost:5000/api/notifications/read/${id}`);
      setNotifications(notifications.map(n => n._id === id || n.id === id ? { ...n, read: true, isRead: true } : n));
    } catch (err) {
      alert("Failed to mark as read");
    }
  };

  return (
    <div className="accountant-view">
      <EmailNotificationsView
        title="Notifications"
        subtitle="View all recent system alerts and notifications."
        notifications={notifications}
        loading={loading}
        error={error}
        onMarkRead={handleRead}
        onRefresh={loadNotifications}
      />
    </div>
  );
};

const ProfileView = ({ user }) => {
  const { updateUser, logoutUser } = useAuth();
  const userId = user?.id || user?._id;

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    dob: "",
    bloodGroup: "",
    emergencyContact: "",
  });

  // Password change states
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadProfile = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await getEmployeeProfile(userId);
      if (data?.profile) {
        setProfile(data.profile);
        setEditForm({
          name: data.profile.name || "",
          email: data.profile.email || "",
          phone: data.profile.phone || "",
          address: data.profile.address || "",
          dob: data.profile.dob ? new Date(data.profile.dob).toISOString().split('T')[0] : "",
          bloodGroup: data.profile.bloodGroup || "",
          emergencyContact: data.profile.emergencyContact || "",
        });
      }
    } catch (err) {
      console.error("Failed to load profile details", err);
      setError("Failed to load profile details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [userId]);

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setError("");

    if (!editForm.name.trim() || !editForm.email.trim()) {
      setError("Name and email are required.");
      return;
    }

    try {
      const res = await updateEmployeeProfile(userId, editForm);
      setMessage("Profile updated successfully!");
      setIsEditing(false);

      if (res?.profile) {
        setProfile(res.profile);
        updateUser({
          ...user,
          name: res.profile.name,
          email: res.profile.email,
          phone: res.profile.phone,
          photo: res.profile.photo,
        });
      }

      if (editForm.email.toLowerCase().trim() !== user.email.toLowerCase().trim()) {
        alert("Email changed. Please log in again with your new email.");
        logoutUser();
        window.location.href = "/auth-login";
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update profile.");
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setError("");

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setError("All password fields are required.");
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    try {
      await changeEmployeePassword(userId, {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setMessage("Password updated successfully! Please log in again with your new password.");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setIsChangingPassword(false);

      setTimeout(() => {
        logoutUser();
        window.location.href = "/auth-login";
      }, 2000);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to change password.");
    }
  };

  if (loading) {
    return (
      <div className="accountant-view flex items-center justify-center py-20">
        <p className="text-slate-500 dark:text-slate-400 font-semibold">Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="accountant-view">
      <div className="mx-auto max-w-7xl">
        <EmployeeProfileView
          profile={profile}
          user={user}
          profileForm={editForm}
          passwordForm={passwordForm}
          errors={{}}
          message={message || error}
          messageType={message ? "success" : error ? "error" : "info"}
          loading={loading}
          savingProfile={false}
          savingPassword={false}
          onFieldChange={(field, value) => setEditForm(prev => ({ ...prev, [field]: value }))}
          onPasswordChange={(field, value) => setPasswordForm(prev => ({ ...prev, [field]: value }))}
          onSaveProfile={handleProfileSubmit}
          onChangePassword={handlePasswordSubmit}
          adminManagedDetails={[]}
        />
      </div>
    </div>
  );
};

const AccountantPageContent = ({ activeItem, setActiveItem, user, currentDate, currentWeekday, darkMode }) => {
  const [bills, setBills] = useState([]);
  const [roomBookings, setRoomBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [billsData, roomData] = await Promise.allSettled([
        fetchBills(),
        fetchRoomBookings(),
      ]);
      setBills(billsData.status === "fulfilled" ? billsData.value : []);
      setRoomBookings(roomData.status === "fulfilled" ? roomData.value : []);
    } catch (err) {
      console.error("Failed to load accountant data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  switch (activeItem) {
    case "Donations":
      return <DonationsView bills={bills} loading={loading} />;
    case "Account Ledgers":
      return <AccountLedgersView />;
    case "Manual Entries":
      return <ManualEntriesView />;
    case "Profit & Loss":
      return <ProfitLossView />;
    case "Billing":
      return <BillingView bills={bills} loading={loading} />;
    case "Payments":
      return <PaymentsView bills={bills} loading={loading} />;
    case "Receipts":
      return <ReceiptsView bills={bills} roomBookings={roomBookings} loading={loading} />;
    case "Pooja Revenue":
      return <PoojaRevenueView bills={bills} loading={loading} />;
    case "Prasadam Sales":
      return <PrasadamSalesView bills={bills} loading={loading} />;
    case "Inventory Finance":
      return <InventoryFinanceView />;
    case "Devotee Payments":
      return <DevoteePaymentsView />;
    case "Reports & Analytics":
      return <ReportsAnalyticsView />;
    case "Notifications":
      return <NotificationsView user={user} />;
    case "Attendance":
      return (
        <div style={{ padding: "2rem" }}>
          <Attendance darkMode={darkMode} />
        </div>
      );
    case "Apply Leave":
      return (
        <div style={{ padding: "2rem" }}>
          <LeaveRequest onBack={() => setActiveItem("Leave Requests")} darkMode={darkMode} />
        </div>
      );
    case "Leave Requests":
      return (
        <div style={{ padding: "2rem" }}>
          <LeaveHistory onApply={() => setActiveItem("Apply Leave")} darkMode={darkMode} />
        </div>
      );
    case "Inventory Requests":
      return (
        <div style={{ padding: "2rem" }}>
          <StaffInventory darkMode={darkMode} />
        </div>
      );
    case "Profile":
      return <ProfileView user={user} darkMode={darkMode} />;
    case "Dashboard":
    default:
      return <DashboardView user={user} currentDate={currentDate} currentWeekday={currentWeekday} bills={bills} loading={loading} />;
  }
};

export default AccountantPageContent;
