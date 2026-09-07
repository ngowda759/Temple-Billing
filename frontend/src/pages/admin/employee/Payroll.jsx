import { useCallback, useEffect, useMemo, useState } from "react";
import SectionCard from "../../../components/admin/employee/SectionCard";
import { FiCreditCard, FiClock, FiUsers, FiGift } from "react-icons/fi";
import { getPayrollDashboard, payEmployeePayroll, verifyPayrollPayment } from "../../../services/payrollService";

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

const formatMonthKey = (date) => {
 const year = date.getFullYear();
 const month = String(date.getMonth() + 1).padStart(2, "0");
 return `${year}-${month}`;
};

const PAYMENT_METHODS = ["Bank Transfer", "UPI", "Cash", "Cheque", "Card", "Net Banking"];

const computeNetSalary = (employee, form) => {
 const bonus = Number(form?.bonus || 0);
 const extraDutyPay = Number(form?.extraDutyPay ?? employee.extraDutyPay ?? 0);
 return Math.round(Number(employee.baseSalary || 0) - Number(employee.deduction || 0) + extraDutyPay + bonus);
};

const Payroll = () => {
 const [monthKey, setMonthKey] = useState(formatMonthKey(new Date()));
 const [dashboard, setDashboard] = useState(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState("");
 const [payingId, setPayingId] = useState("");
 const [paymentForms, setPaymentForms] = useState({});

 const loadDashboard = useCallback(async () => {
 setLoading(true);
 setError("");
 try {
 const response = await getPayrollDashboard(monthKey);
 setDashboard(response);
 const defaults = {};
 (response.employees || []).forEach((employee) => {
 defaults[employee.employeeId] = {
 paymentMethod: employee.paymentMethod || "Bank Transfer",
 bonus: employee.bonus || 0,
 extraDutyPay: employee.extraDutyPay || 0,
 transactionId: employee.transactionId || "",
 notes: "",
 };
 });
 setPaymentForms(defaults);
 } catch (loadError) {
 setError(loadError.response?.data?.message || "Failed to load payroll data.");
 setDashboard(null);
 } finally {
 setLoading(false);
 }
 }, [monthKey]);

 useEffect(() => {
 loadDashboard();
 }, [loadDashboard]);

  const summaryTiles = useMemo(() => {
    const summary = dashboard?.summary || {};
    return [
      {
        title: "Monthly Payroll",
        value: formatCurrency(summary.monthlyPayroll),
        icon: FiCreditCard,
        iconBg: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800/60",
        valueColor: "text-slate-900 dark:text-slate-100",
      },
      {
        title: "Pending Salary",
        value: formatCurrency(summary.pendingSalary),
        icon: FiClock,
        iconBg: "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60",
        valueColor: "text-amber-600 dark:text-amber-400",
      },
      {
        title: "Paid Employees",
        value: summary.paidEmployees || 0,
        icon: FiUsers,
        iconBg: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60",
        valueColor: "text-emerald-600 dark:text-emerald-400",
      },
      {
        title: "Bonus Distribution",
        value: formatCurrency(summary.bonusDistribution),
        icon: FiGift,
        iconBg: "bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400 border border-sky-200/60 dark:border-sky-800/60",
        valueColor: "text-slate-900 dark:text-slate-100",
      },
    ];
  }, [dashboard]);

 const updatePaymentForm = (employeeId, field, value) => {
 setPaymentForms((prev) => ({
 ...prev,
 [employeeId]: {
 ...(prev[employeeId] || {}),
 [field]: value,
 },
 }));
 };

 const handlePay = async (employee) => {
 const form = paymentForms[employee.employeeId] || {};
 setPayingId(employee.employeeId);
 setError("");
 try {
 const response = await payEmployeePayroll(employee.employeeId, {
 monthKey,
 paymentMethod: form.paymentMethod || "Bank Transfer",
 bonus: Number(form.bonus || 0),
 extraDutyPay: Number(form.extraDutyPay || 0),
 transactionId: form.transactionId || "",
 notes: form.notes || "",
 });

 const { record, order, key, simulated } = response;

 if (!simulated && order) {
 const loadRazorpayScript = () =>
 new Promise((resolve) => {
 if (window.Razorpay) return resolve(true);
 const script = document.createElement("script");
 script.src = "https://checkout.razorpay.com/v1/checkout.js";
 script.onload = () => resolve(true);
 script.onerror = () => resolve(false);
 document.body.appendChild(script);
 });

 const loaded = await loadRazorpayScript();
 if (!loaded) {
 setError("Unable to load payment gateway. Try again later.");
 return;
 }

 const options = {
 key: key || "",
 amount: order.amount,
 currency: order.currency,
 name: "Temple Employee Payroll",
 description: `Salary for ${employee.employeeName}`,
 order_id: order.id,
 prefill: {
 name: employee.employeeName,
 },
 handler: async function (resp) {
 try {
 setPayingId(employee.employeeId);
 await verifyPayrollPayment({
 razorpay_order_id: resp.razorpay_order_id,
 razorpay_payment_id: resp.razorpay_payment_id,
 razorpay_signature: resp.razorpay_signature,
 recordId: record._id,
 });
 await loadDashboard();
 } catch (err) {
 setError("Payment verification failed.");
 console.warn("verify payroll payment handler error", err);
 } finally {
 setPayingId("");
 }
 },
 modal: {
 ondismiss: function () {
 setPayingId("");
 },
 },
 };

 const rzp = new window.Razorpay(options);
 rzp.open();
 return;
 }

 await loadDashboard();
 } catch (payError) {
 setError(payError.response?.data?.message || "Failed to record salary payment.");
 } finally {
 setPayingId("");
 }
 };

 return (
 <div className="space-y-8">
 <SectionCard
 title="Payroll Management"
 subtitle="Review salary payouts based on attendance, extra duty, and process employee payments."
 className="bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-amber-600/15 text-[#4a2b0f] dark:text-slate-200 border border-amber-200/60 shadow-md backdrop-blur-md"
 >
 <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="text-sm font-extrabold text-[#7a4918] dark:text-amber-400">
          Payroll Month
          <input
            type="month"
            value={monthKey}
            onChange={(event) => setMonthKey(event.target.value)}
            className="ml-3 rounded-2xl border border-amber-300/80 dark:border-slate-700 bg-white/90 dark:bg-slate-900 px-4 py-2 text-slate-800 dark:text-slate-200 font-semibold shadow-xs outline-none focus:border-amber-500"
          />
        </label>
 </div>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {summaryTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <div
                key={tile.title}
                className="rounded-[24px] border border-amber-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 p-5 shadow-sm hover:shadow-md transition-all duration-300 backdrop-blur-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {tile.title}
                    </p>
                    <p className={`mt-2 text-2xl sm:text-3xl font-black tracking-tight ${tile.valueColor}`}>
                      {tile.value}
                    </p>
                  </div>
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tile.iconBg}`}>
                    <Icon className="text-xl" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
 </SectionCard>

 {error ? (
 <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm text-rose-700">{error}</div>
 ) : null}

 <div className="grid gap-5 xl:grid-cols-[1.7fr_0.9fr]">
 <div className="space-y-5">
 <SectionCard title="Payroll Table" subtitle="Salary calculated from present, absent, leave, and admin-entered extra duty pay." className="overflow-hidden">
 <div className="overflow-x-auto rounded-[28px] border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] shadow-sm">
 <table className="min-w-full text-left text-sm text-slate-600 dark:text-slate-200 ">
 <thead className="bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-500 dark:text-slate-200 ">
 <tr>
 <th className="px-5 py-4">Employee</th>
 <th className="px-5 py-4">Present</th>
 <th className="px-5 py-4">Absent</th>
 <th className="px-5 py-4">Extra Duty</th>
 <th className="px-5 py-4">Base Salary</th>
 <th className="px-5 py-4">Deduction</th>
 <th className="px-5 py-4">Extra Pay</th>
 <th className="px-5 py-4">Bonus</th>
 <th className="px-5 py-4">Net Salary</th>
 <th className="px-5 py-4">Status</th>
 <th className="px-5 py-4">Pay</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td colSpan="11" className="px-5 py-8 text-center text-slate-500 dark:text-slate-200 ">Loading payroll records…</td>
 </tr>
 ) : (dashboard?.employees || []).length === 0 ? (
 <tr>
 <td colSpan="11" className="px-5 py-8 text-center text-slate-500 dark:text-slate-200 ">No employee payroll records found.</td>
 </tr>
 ) : (
 dashboard.employees.map((employee) => {
 const form = paymentForms[employee.employeeId] || {};
 const isPaid = employee.status === "Paid";
 const previewNetSalary = isPaid ? employee.netSalary : computeNetSalary(employee, form);
 return (
 <tr key={employee.employeeId} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <td className="px-5 py-4">
 <p className="font-semibold text-slate-900 dark:text-slate-200 ">{employee.employeeName}</p>
 <p className="text-xs text-slate-500 dark:text-slate-200 ">{employee.department}</p>
 </td>
 <td className="px-5 py-4">{employee.presentDays}</td>
 <td className="px-5 py-4">{employee.absentDays}</td>
 <td className="px-5 py-4">{employee.extraDutyDays}</td>
 <td className="px-5 py-4">{formatCurrency(employee.baseSalary)}</td>
 <td className="px-5 py-4">{formatCurrency(employee.deduction)}</td>
 <td className="px-5 py-4">
 <input
 type="number"
 min="0"
 disabled={isPaid || employee.extraDutyDays === 0}
 value={form.extraDutyPay ?? employee.extraDutyPay ?? 0}
 onChange={(event) => updatePaymentForm(employee.employeeId, "extraDutyPay", event.target.value)}
 className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1"
 title={employee.extraDutyDays === 0 ? "No extra duty this month" : "Enter extra duty pay amount"}
 />
 </td>
 <td className="px-5 py-4">
 <input
 type="number"
 min="0"
 disabled={isPaid}
 value={form.bonus ?? employee.bonus ?? 0}
 onChange={(event) => updatePaymentForm(employee.employeeId, "bonus", event.target.value)}
 className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1"
 />
 </td>
 <td className="px-5 py-4 font-semibold text-slate-900 dark:text-slate-200 ">{formatCurrency(previewNetSalary)}</td>
 <td className="px-5 py-4">
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isPaid ? "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-700" : "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-700"}`}>
 {employee.status}
 </span>
 {isPaid ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-200 ">{employee.paymentMethod}</p> : null}
 </td>
 <td className="px-5 py-4">
 {isPaid ? (
 <span className="text-xs text-slate-500 dark:text-slate-200 ">{employee.transactionId || "Paid"}</span>
 ) : (
 <div className="flex min-w-[220px] flex-col gap-2">
 <select
 value={form.paymentMethod || "Bank Transfer"}
 onChange={(event) => updatePaymentForm(employee.employeeId, "paymentMethod", event.target.value)}
 className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs"
 >
 {PAYMENT_METHODS.map((method) => (
 <option key={method} value={method}>{method}</option>
 ))}
 </select>
 <input
 type="text"
 placeholder="Transaction ID"
 value={form.transactionId || ""}
 onChange={(event) => updatePaymentForm(employee.employeeId, "transactionId", event.target.value)}
 className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs"
 />
 <button
 type="button"
 disabled={payingId === employee.employeeId}
 onClick={() => handlePay(employee)}
 className="rounded-full bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
 >
 {payingId === employee.employeeId ? "Processing…" : "Pay Salary"}
 </button>
 </div>
 )}
 </td>
 </tr>
 );
 })
 )}
 </tbody>
 </table>
 </div>
 </SectionCard>
 </div>

 <div className="space-y-5">
 <SectionCard title="Growth by Department" subtitle="Payroll allocation by team." className="overflow-hidden">
 <div className="space-y-4">
 {(dashboard?.departmentBreakdown || []).length === 0 ? (
 <p className="text-sm text-slate-500 dark:text-slate-200 ">No department payroll data yet.</p>
 ) : (
 dashboard.departmentBreakdown.map((item) => (
 <div key={item.name} className="rounded-[22px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <div className="flex items-center justify-between gap-3">
 <div>
 <p className="font-semibold text-slate-900 dark:text-slate-200 ">{item.name}</p>
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Salary cost</p>
 </div>
 <p className="font-semibold text-slate-900 dark:text-slate-200 ">{formatCurrency(item.value)}</p>
 </div>
 </div>
 ))
 )}
 </div>
 </SectionCard>

 <SectionCard title="Upcoming Salary Dates" subtitle="Employees with pending salary for this month." className="overflow-hidden">
 <div className="grid gap-4">
 {(dashboard?.upcomingPayments || []).length === 0 ? (
 <p className="text-sm text-slate-500 dark:text-slate-200 ">All salaries are paid for this month.</p>
 ) : (
 dashboard.upcomingPayments.map((item) => (
 <div key={item.employeeId} className="rounded-[22px] border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <p className="font-semibold text-slate-900 dark:text-slate-200 ">{item.name}</p>
 <p className="text-sm text-slate-500 dark:text-slate-200 ">{item.role}</p>
 </div>
 <span className="rounded-full bg-sky-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1 text-xs font-semibold text-sky-700">
 {formatCurrency(item.netSalary)}
 </span>
 </div>
 </div>
 ))
 )}
 </div>
 </SectionCard>
 </div>
 </div>
 </div>
 );
};

export default Payroll;
