import { useEffect, useMemo, useState } from "react";
import { FaDownload, FaSearch, FaWarehouse } from "react-icons/fa";
import templeBg from "../../assets/temple-bg.jpg";
import CashierPageShell from "../../components/cashier/CashierPageShell";
import { fetchInventoryItems } from "../../services/cashierService";

const InventoryPage = () => {
 const [items, setItems] = useState([]);
 const [loading, setLoading] = useState(true);
 const [query, setQuery] = useState("");
 const [filter, setFilter] = useState("All");

 const loadItems = async () => {
 setLoading(true);
 try {
 const rows = await fetchInventoryItems();
 setItems(rows);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadItems();
 }, []);

 const filteredItems = useMemo(() => {
 const q = query.trim().toLowerCase();
 return [...items]
 .filter((item) => {
 const isLow = Number(item.currentStock) < Number(item.minimumStock);
 const status = isLow ? "Low" : "Available";
 const matchesFilter = filter === "All" || filter === status;
 const matchesQuery =
 !q ||
 [item.name, item.category, item.unit, item.status]
 .filter(Boolean)
 .some((value) => String(value).toLowerCase().includes(q));
 return matchesFilter && matchesQuery;
 })
 .sort((a, b) => a.name.localeCompare(b.name));
 }, [items, query, filter]);

 const lowStockItems = useMemo(
 () => items.filter((item) => Number(item.currentStock) < Number(item.minimumStock)),
 [items]
 );

 const stats = [
 {
 title: "All Items",
 value: items.length,
 note: "Counter inventory list",
 tone: "orange",
 },
 {
 title: "Low Stock",
 value: lowStockItems.length,
 note: "Needs attention",
 tone: "gold",
 },
 {
 title: "Available",
 value: items.length - lowStockItems.length,
 note: "Healthy stock",
 tone: "green",
 },
 {
 title: "Categories",
 value: new Set(items.map((item) => item.category || "General")).size,
 note: "Unique item groups",
 tone: "blue",
 },
 ];

 const handleDownloadCsv = () => {
 const rows = [
 ["Item", "Category", "Current Stock", "Minimum Stock", "Unit", "Status"],
 ...filteredItems.map((item) => [
 item.name,
 item.category || "-",
 item.currentStock,
 item.minimumStock,
 item.unit,
 Number(item.currentStock) < Number(item.minimumStock) ? "Low Stock" : "Available",
 ]),
 ];

 const csv = rows
 .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
 .join("\r\n");
 const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
 const url = URL.createObjectURL(blob);
 const link = document.createElement("a");
 link.href = url;
 link.download = "cashier-inventory.csv";
 link.click();
 URL.revokeObjectURL(url);
 };

 return (
 <CashierPageShell
 eyebrow="Inventory"
 title="View prasadam and temple inventory on the cashier side"
 description="Search the stock list, spot low inventory items and export the current view for internal use."
 image={templeBg}
 imageAlt="Temple inventory counter"
 stats={stats}
 actions={
 <>
 <button
 type="button"
 onClick={loadItems}
 className="inline-flex items-center gap-2 rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 <FaWarehouse /> Refresh
 </button>
 <button
 type="button"
 onClick={handleDownloadCsv}
 className="inline-flex items-center gap-2 rounded-full bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-95"
 >
 <FaDownload /> Export CSV
 </button>
 </>
 }
 >
 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Inventory stock list</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Cashier can review stock levels and low stock alerts without editing inventory.
 </p>
 </div>

 <div className="flex flex-wrap gap-3">
 <div className="flex items-center gap-2 rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm text-slate-700">
 <FaSearch />
 <input
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 placeholder="Search inventory"
 className="w-[180px] bg-transparent outline-none"
 />
 </div>
 <select
 value={filter}
 onChange={(e) => setFilter(e.target.value)}
 className="rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-semibold text-slate-900 outline-none"
 >
 <option value="All">All</option>
 <option value="Low">Low Stock</option>
 <option value="Available">Available</option>
 </select>
 </div>
 </div>
 </section>

 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Stock overview</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Low stock rows are highlighted for quick review.
 </p>
 </div>
 <span className="rounded-full bg-[#fff1d7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-1 text-xs font-bold text-[#8a5200]">
 {filteredItems.length} items
 </span>
 </div>

 <div className="mt-5 overflow-x-auto">
 <table className="w-full min-w-[860px] text-left text-sm">
 <thead className="bg-[#fff7eb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-600">
 <tr>
 <th className="px-4 py-3 font-bold">Item</th>
 <th className="px-4 py-3 font-bold">Category</th>
 <th className="px-4 py-3 font-bold">Current</th>
 <th className="px-4 py-3 font-bold">Minimum</th>
 <th className="px-4 py-3 font-bold">Unit</th>
 <th className="px-4 py-3 font-bold">Status</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td colSpan="6" className="px-4 py-8 text-center text-slate-500">
 Loading inventory...
 </td>
 </tr>
 ) : filteredItems.length ? (
 filteredItems.map((item) => {
 const isLow = Number(item.currentStock) < Number(item.minimumStock);
 return (
 <tr key={item._id} className="border-b border-[#f2e7d7]">
 <td className="px-4 py-3 font-bold text-slate-950">{item.name}</td>
 <td className="px-4 py-3 text-slate-700">{item.category || "-"}</td>
 <td className="px-4 py-3 font-bold text-slate-950">{item.currentStock}</td>
 <td className="px-4 py-3">{item.minimumStock}</td>
 <td className="px-4 py-3">{item.unit}</td>
 <td className="px-4 py-3">
 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
 isLow ? "bg-[#fff1d7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#9a5a00]" : "bg-[#def7e3] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#166534]"
 }`}
 >
 {isLow ? "Low Stock" : "Available"}
 </span>
 </td>
 </tr>
 );
 })
 ) : (
 <tr>
 <td colSpan="6" className="px-4 py-8 text-center text-slate-500">
 No inventory items match the current filter.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </section>
 </CashierPageShell>
 );
};

export default InventoryPage;
