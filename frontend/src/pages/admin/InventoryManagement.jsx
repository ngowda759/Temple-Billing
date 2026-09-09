import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";

const API_BASE = "http://localhost:5000/api";

const UNIT_GROUPS = {
 "Count Units": ["Piece (Pc)", "Number (Nos)", "Unit", "Pair", "Set", "Bundle", "Packet", "Box", "Carton", "Roll", "Dozen", "Tray", "Sack", "Bag"],
 "Weight Units": ["Gram (g)", "Kilogram (kg)", "Quintal", "Ton"],
 "Liquid Units": ["Millilitre (ml)", "Litre (L)", "Can", "Drum", "Barrel"],
 "Volume / Container Units": ["Bottle", "Jar", "Tin", "Container", "Bucket", "Cylinder"],
 "Length Units": ["Meter", "Feet", "Roll"],
 "Area Units": ["Square Feet", "Square Meter"]
};
const INVENTORY_CATEGORIES = [
 "Pooja Items",
 "Prasadam Ingredients",
 "Cleaning Materials",
 "Office & Stationery",
 "Electrical & Maintenance",
 "Festival Materials",
 "Cooking / Annaprasada",
 "Miscellaneous Items"
];

const formatDateTime = (value) => {
 if (!value) return "-";
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return value;
 return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const EMPTY_ITEM_FORM = { name: "", unit: "Pack", availableStock: "", minimumStock: "", category: "", description: "" };
const EMPTY_SUPPLIER_FORM = { name: "", address: "", phone: "", email: "", gst: "" };
const EMPTY_ASSET_FORM = { assetId: "", name: "", category: "", purchaseDate: "", supplier: "", invoiceNumber: "", warranty: "", assignedLocation: "", status: "Active" };
const EMPTY_REPAIR_FORM = { asset: "", description: "", vendor: "", cost: "", invoiceNumber: "" };

const InventoryManagement = () => {
 const { user } = useAuth();
 const [activeTab, setActiveTab] = useState("items"); // items, requests, suppliers, assets, repairs, consumptions, settings

 // Shared Data
 const [items, setItems] = useState([]);
 const [requests, setRequests] = useState([]);
 const [consumptions, setConsumptions] = useState([]);
 const [suppliers, setSuppliers] = useState([]);
 const [assets, setAssets] = useState([]);
 const [repairs, setRepairs] = useState([]);
 const [poojaSettings, setPoojaSettings] = useState([]);
 const [metrics, setMetrics] = useState(null);

 // Modals & Forms
 const [showItemModal, setShowItemModal] = useState(false);
 const [editItem, setEditItem] = useState(null);
 const [showSupplierModal, setShowSupplierModal] = useState(false);
 const [editSupplier, setEditSupplier] = useState(null);
 const [showAssetModal, setShowAssetModal] = useState(false);
 const [editAsset, setEditAsset] = useState(null);
 const [showRepairModal, setShowRepairModal] = useState(false);
 const [showRestockModal, setShowRestockModal] = useState(false);
 const [showAdjustModal, setShowAdjustModal] = useState(false);
 const [selectedItem, setSelectedItem] = useState(null); // for restock/adjust
 const [showItemDetails, setShowItemDetails] = useState(false);
 const [itemDetails, setItemDetails] = useState(null);
 const [showCompleteRepairModal, setShowCompleteRepairModal] = useState(false);
 const [selectedRepair, setSelectedRepair] = useState(null);
 const [poojaMaterials, setPoojaMaterials] = useState([{ item: "", quantity: 1, templeArrangeAvailable: true, templeCharge: 0 }]);

 // Search & Filter
 const [searchTerm, setSearchTerm] = useState("");
 const [categoryFilter, setCategoryFilter] = useState("All");

 // Loading
 const [loading, setLoading] = useState(false);

 // --- Fetches ---
 const fetchData = async () => {
 setLoading(true);
 try {
 const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
 const t = new Date().getTime();
 const [it, req, cons, sup, ast, rep, pset, met] = await Promise.all([
 axios.get(`${API_BASE}/admin/inventory-items?t=${t}`, { headers }),
 axios.get(`${API_BASE}/staff/inventory-requests?t=${t}`, { headers }),
 axios.get(`${API_BASE}/admin/inventory/reports/consumption?t=${t}`, { headers }),
 axios.get(`${API_BASE}/admin/inventory-suppliers?t=${t}`, { headers }),
 axios.get(`${API_BASE}/admin/inventory-assets?t=${t}`, { headers }),
 axios.get(`${API_BASE}/admin/inventory-repairs?t=${t}`, { headers }),
 axios.get(`${API_BASE}/pooja-settings?t=${t}`, { headers }),
 axios.get(`${API_BASE}/admin/inventory-metrics?t=${t}`, { headers }).catch(() => ({ data: { metrics: null } })),
 ]);
 setItems(it.data?.items || []);
 setRequests(req.data?.requests || []);
 setConsumptions(cons.data?.consumptions || []);
 setSuppliers(sup.data?.suppliers || []);
 setAssets(ast.data?.assets || []);
 setRepairs(rep.data?.repairs || []);
 setPoojaSettings(pset.data?.requirements || []);
 setMetrics(met.data?.metrics || null);
 } catch (error) {
 console.error(error);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchData();
 }, []);

 // --- Item Handlers ---
 const handleSaveItem = async (e) => {
 e.preventDefault();
 const form = new FormData(e.target);
 const data = {
 name: form.get("name"),
 unit: form.get("unit"),
 category: form.get("category"),
 minimumStock: Number(form.get("minimumStock")),
 reorderLevel: Number(form.get("reorderLevel") || form.get("minimumStock")),
 lastSupplier: form.get("lastSupplier"),
 lastPurchasePrice: Number(form.get("lastPurchasePrice") || 0),
 isActive: form.get("isActive") === "on",
 };
 if (form.has("availableStock")) {
 data.availableStock = Number(form.get("availableStock"));
 }
 try {
 const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
 if (editItem) {
 await axios.put(`${API_BASE}/admin/inventory-items/${editItem._id}`, data, { headers });
 } else {
 await axios.post(`${API_BASE}/admin/inventory-items`, data, { headers });
 }
 setShowItemModal(false);
 fetchData();
 } catch (err) {
 alert(err.response?.data?.message || "Error saving item");
 }
 };

 const handleDeleteItem = async (id) => {
 if (!window.confirm("Are you sure you want to completely delete this item from the database? This action cannot be undone.")) return;
 try {
 const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
 await axios.delete(`${API_BASE}/admin/inventory-items/${id}`, { headers });
 fetchData();
 } catch (err) {
 alert(err.response?.data?.message || "Error deleting item");
 }
 };

 const handleAdjustStock = async (e) => {
 e.preventDefault();
 const form = new FormData(e.target);
 const data = Object.fromEntries(form);
 try {
 const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
 await axios.post(`${API_BASE}/admin/inventory-items/${selectedItem._id}/adjust`, data, { headers });
 setShowAdjustModal(false);
 fetchData();
 } catch (err) {
 alert(err.response?.data?.message || "Error adjusting stock");
 }
 };

 const handleRestock = async (e) => {
 e.preventDefault();
 const form = new FormData(e.target);
 const data = Object.fromEntries(form);
 try {
 const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
 await axios.post(`${API_BASE}/admin/inventory/restock/${selectedItem._id}`, data, { headers });
 setShowRestockModal(false);
 fetchData();
 } catch (err) {
 alert(err.response?.data?.message || "Error restocking item");
 }
 };

 const handleViewItemDetails = async (id) => {
 try {
 const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
 const res = await axios.get(`${API_BASE}/admin/inventory-items/${id}/details`, { headers });
 setItemDetails(res.data);
 setShowItemDetails(true);
 } catch (err) {
 alert("Error fetching details");
 }
 };

 // --- Request Handlers ---
 const handleApproveRequest = async (id) => {
 try {
 const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
 await axios.put(`${API_BASE}/admin/inventory-requests/${id}/status`, { status: "Approved" }, { headers });
 fetchData();
 } catch (err) {
 alert(err.response?.data?.message || "Error approving");
 }
 };

 const handleIssueRequest = async (id) => {
 try {
 const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
 await axios.post(`${API_BASE}/admin/inventory-requests/${id}/issue`, {}, { headers });
 fetchData();
 } catch (err) {
 alert(err.response?.data?.message || "Error issuing request");
 }
 };

 // --- Supplier Handlers ---
 const handleSaveSupplier = async (e) => {
 e.preventDefault();
 const form = new FormData(e.target);
 const data = Object.fromEntries(form);
 try {
 const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
 if (editSupplier) {
 await axios.put(`${API_BASE}/admin/inventory-suppliers/${editSupplier._id}`, data, { headers });
 } else {
 await axios.post(`${API_BASE}/admin/inventory-suppliers`, data, { headers });
 }
 setShowSupplierModal(false);
 fetchData();
 } catch (err) {
 alert("Error saving supplier");
 }
 };

 // --- Asset Handlers ---
 const handleSaveAsset = async (e) => {
 e.preventDefault();
 const form = new FormData(e.target);
 const data = Object.fromEntries(form);
 try {
 const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
 if (editAsset) {
 await axios.put(`${API_BASE}/admin/inventory-assets/${editAsset._id}`, data, { headers });
 } else {
 await axios.post(`${API_BASE}/admin/inventory-assets`, data, { headers });
 }
 setShowAssetModal(false);
 fetchData();
 } catch (err) {
 alert("Error saving asset");
 }
 };

 // --- Repair Handlers ---
 const handleSaveRepair = async (e) => {
 e.preventDefault();
 const form = new FormData(e.target);
 const data = Object.fromEntries(form);
 try {
 const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
 await axios.post(`${API_BASE}/admin/inventory-repairs`, data, { headers });
 setShowRepairModal(false);
 fetchData();
 } catch (err) {
 alert("Error saving repair");
 }
 };
 
 const handleCompleteRepairSubmit = async (e) => {
 e.preventDefault();
 const form = new FormData(e.target);
 const data = Object.fromEntries(form);
 try {
 const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
 await axios.put(`${API_BASE}/admin/inventory-repairs/${selectedRepair._id}/complete`, data, { headers });
 setShowCompleteRepairModal(false);
 setSelectedRepair(null);
 fetchData();
 } catch (err) {
 alert(err.response?.data?.message || "Error completing repair");
 }
 };

 // --- Settings Handlers ---
 const handleSavePoojaSetting = async (e) => {
 e.preventDefault();
 const form = new FormData(e.target);
 const poojaName = form.get("poojaName");
 
 // Filter out rows without a selected item
 const validMaterials = poojaMaterials.filter(m => m.item).map(m => ({
 ...m,
 quantity: Number(m.quantity) || 0,
 templeCharge: Number(m.templeCharge) || 0
 }));

 try {
 const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
 await axios.post(`${API_BASE}/pooja-settings`, { poojaName, requiredMaterials: validMaterials }, { headers });
 setPoojaMaterials([{ item: "", quantity: 1, templeArrangeAvailable: true, templeCharge: 0 }]);
 e.target.reset();
 fetchData();
 } catch (err) {
 alert("Error saving pooja setting");
 }
 };

 const handleAddPoojaMaterialRow = () => {
 setPoojaMaterials([...poojaMaterials, { item: "", quantity: 1, templeArrangeAvailable: true, templeCharge: 0 }]);
 };

 const handlePoojaMaterialChange = (index, field, value) => {
 const newMaterials = [...poojaMaterials];
 newMaterials[index][field] = value;
 setPoojaMaterials(newMaterials);
 };

 const handleRemovePoojaMaterialRow = (index) => {
 const newMaterials = poojaMaterials.filter((_, i) => i !== index);
 setPoojaMaterials(newMaterials);
 };

 return (
 <div className="space-y-6 mt-5 p-2">
 {/* Header */}
 <div className="rounded-2xl border bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <h1 className="text-3xl font-bold">Inventory & Assets</h1>
 <p className="mt-2 text-slate-500 dark:text-slate-200 ">Manage all temple resources, suppliers, repairs, and requests in one place.</p>
 </div>

 {/* Navigation */}
 <div className="flex flex-wrap gap-2 rounded-2xl border bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-2 shadow-sm">
 {[
 { id: "items", label: "📦 Central Inventory" },
 { id: "requests", label: "📋 Issue Requests" },
 { id: "suppliers", label: "🤝 Suppliers" },
 { id: "assets", label: "🏢 Assets" },
 { id: "repairs", label: "🔧 Repairs" },
 { id: "consumptions", label: "📊 Consumptions" },
 { id: "settings", label: "⚙️ Pooja Mats" },
 ].map(tab => (
 <button
 key={tab.id}
 onClick={() => setActiveTab(tab.id)}
 className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${ activeTab === tab.id ? "bg-blue-600 text-white" : "bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " }`}
 >
 {tab.label}
 </button>
 ))}
 </div>

 {/* Content */}
 <div className="rounded-2xl border bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm min-h-[60vh]">
 {loading && <p>Loading data...</p>}

 {!loading && activeTab === "items" && (
 <div className="space-y-6">
 {/* Dashboard Cards */}
 {metrics && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <div className="p-4 border rounded-xl bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <p className="text-sm text-slate-500 dark:text-slate-200 font-bold">Total Items</p>
 <p className="text-2xl font-black text-blue-700">{metrics.totalItems}</p>
 </div>
 <div className="p-4 border rounded-xl bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <p className="text-sm text-slate-500 dark:text-slate-200 font-bold">Inventory Value</p>
 <p className="text-2xl font-black text-emerald-700">₹{metrics.totalValue.toLocaleString()}</p>
 </div>
 <div className="p-4 border rounded-xl bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <p className="text-sm text-slate-500 dark:text-slate-200 font-bold">Low / Out of Stock</p>
 <p className="text-2xl font-black text-amber-700">{metrics.lowStockCount} / {metrics.outOfStockCount}</p>
 </div>
 <div className="p-4 border rounded-xl bg-purple-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <p className="text-sm text-slate-500 dark:text-slate-200 font-bold">Today's Purchases</p>
 <p className="text-2xl font-black text-purple-700">{metrics.todaysPurchases}</p>
 </div>
 </div>
 )}

 <div className="flex flex-col md:flex-row justify-between items-center gap-4">
 <h2 className="text-xl font-bold">Central Stock</h2>
 <div className="flex gap-2">
 <input 
 type="text" 
 placeholder="Search items..." 
 className="px-4 py-2 border rounded-lg"
 value={searchTerm}
 onChange={(e) => setSearchTerm(e.target.value)}
 />
 <select 
 className="px-4 py-2 border rounded-lg"
 value={categoryFilter}
 onChange={(e) => setCategoryFilter(e.target.value)}
 >
 <option value="All">All Categories</option>
 {INVENTORY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
 </select>
 <button onClick={() => { setEditItem(null); setShowItemModal(true); }} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm">+ Add Item</button>
 </div>
 </div>
 
 <div className="overflow-x-auto border rounded-xl">
 <table className="w-full text-left text-sm whitespace-nowrap">
 <thead className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-b">
 <tr>
 <th className="p-3 sticky left-0 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] z-10">Name</th>
 <th className="p-3">Status</th>
 <th className="p-3">Category</th>
 <th className="p-3">Avail. Stock</th>
 <th className="p-3">Min. / Reorder</th>
 <th className="p-3">Supplier</th>
 <th className="p-3">Last Purchase Price</th>
 <th className="p-3">Damaged/Exp.</th>
 <th className="p-3">Actions</th>
 </tr>
 </thead>
 <tbody className="divide-y bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 {items
 .filter(i => (categoryFilter === "All" || i.category === categoryFilter) && i.name.toLowerCase().includes(searchTerm.toLowerCase()))
 .map(item => (
 <tr key={item._id} className="hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <td className="p-3 font-semibold sticky left-0 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] z-10">
 <button onClick={() => handleViewItemDetails(item._id)} className="text-blue-600 hover:underline">{item.name}</button>
 </td>
 <td className="p-3">
 {!item.isActive ? (
 <span className="px-2 py-1 bg-red-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-red-700 rounded-full text-xs font-bold">Inactive</span>
 ) : item.availableStock === 0 ? (
 <span className="px-2 py-1 bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-rose-700 rounded-full text-xs font-bold">Out of Stock</span>
 ) : item.availableStock <= (item.reorderLevel || item.minimumStock) ? (
 <span className="px-2 py-1 bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-amber-700 rounded-full text-xs font-bold">Low Stock</span>
 ) : (
 <span className="px-2 py-1 bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-emerald-700 rounded-full text-xs font-bold">Available</span>
 )}
 </td>
 <td className="p-3">{item.category}</td>
 <td className="p-3 font-bold text-emerald-600">{item.availableStock} {item.unit}</td>
 <td className="p-3 text-slate-500 dark:text-slate-200 ">{item.minimumStock} / {item.reorderLevel || item.minimumStock} {item.unit}</td>
 <td className="p-3">{item.lastSupplier || "-"}</td>
 <td className="p-3">{item.lastPurchasePrice ? `₹${item.lastPurchasePrice}` : "-"}</td>
 <td className="p-3 text-amber-600">{item.damagedStock} / {item.expiredStock} {item.unit}</td>
 <td className="p-3 flex gap-2">
 <button onClick={() => { setSelectedItem(item); setShowRestockModal(true); }} className="text-emerald-600 text-xs font-bold bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-1 rounded">Restock</button>
 <button onClick={() => { setSelectedItem(item); setShowAdjustModal(true); }} className="text-amber-600 text-xs font-bold bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-1 rounded">Adjust</button>
 <button onClick={() => { setEditItem(item); setShowItemModal(true); }} className="text-blue-600 text-xs font-bold bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-1 rounded">Edit</button>
 <button onClick={() => handleDeleteItem(item._id)} className="text-red-600 text-xs font-bold bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-1 rounded">Delete</button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}

 {!loading && activeTab === "requests" && (
 <div>
 <h2 className="text-xl font-bold mb-6">Issue Requests</h2>
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm">
 <thead className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-b">
 <tr>
 <th className="p-3">Date</th>
 <th className="p-3">User</th>
 <th className="p-3">Item</th>
 <th className="p-3">Quantity</th>
 <th className="p-3">Status</th>
 <th className="p-3">Action</th>
 </tr>
 </thead>
 <tbody className="divide-y">
 {requests.map(req => (
 <tr key={req._id}>
 <td className="p-3">{formatDateTime(req.createdAt)}</td>
 <td className="p-3">{req.userName} ({req.role})</td>
 <td className="p-3">{req.itemName}</td>
 <td className="p-3">{req.quantity} {req.unit}</td>
 <td className="p-3">{req.status}</td>
 <td className="p-3">
 {req.status === "Pending" && (
 <button onClick={() => handleApproveRequest(req._id)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-md text-xs font-bold shadow-xs transition-colors">Approve</button>
 )}
 {req.status === "Approved" && (
 <button onClick={() => handleIssueRequest(req._id)} className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold mt-1">Issue</button>
 )}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}

 {!loading && activeTab === "suppliers" && (
 <div>
 <div className="flex justify-between items-center mb-6">
 <h2 className="text-xl font-bold">Suppliers Directory</h2>
 <button onClick={() => { setEditSupplier(null); setShowSupplierModal(true); }} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm">+ Add Supplier</button>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm">
 <thead className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-b">
 <tr>
 <th className="p-3">Name</th>
 <th className="p-3">Phone</th>
 <th className="p-3">Email</th>
 <th className="p-3">GST</th>
 </tr>
 </thead>
 <tbody className="divide-y">
 {suppliers.map(sup => (
 <tr key={sup._id}>
 <td className="p-3 font-semibold">{sup.name}</td>
 <td className="p-3">{sup.phone}</td>
 <td className="p-3">{sup.email}</td>
 <td className="p-3">{sup.gst}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}

 {!loading && activeTab === "assets" && (
 <div>
 <div className="flex justify-between items-center mb-6">
 <h2 className="text-xl font-bold">Assets Register</h2>
 <button onClick={() => { setEditAsset(null); setShowAssetModal(true); }} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm">+ Add Asset</button>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm">
 <thead className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-b">
 <tr>
 <th className="p-3">ID</th>
 <th className="p-3">Name</th>
 <th className="p-3">Category</th>
 <th className="p-3">Location</th>
 <th className="p-3">Status</th>
 </tr>
 </thead>
 <tbody className="divide-y">
 {assets.map(a => (
 <tr key={a._id}>
 <td className="p-3 font-mono">{a.assetId}</td>
 <td className="p-3 font-semibold">{a.name}</td>
 <td className="p-3">{a.category}</td>
 <td className="p-3">{a.assignedLocation}</td>
 <td className="p-3">{a.status}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}

 {!loading && activeTab === "repairs" && (
 <div>
 <div className="flex justify-between items-center mb-6">
 <h2 className="text-xl font-bold">Maintenance & Repairs</h2>
 <button onClick={() => setShowRepairModal(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm">+ New Repair</button>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm">
 <thead className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-b">
 <tr>
 <th className="p-3">Asset</th>
 <th className="p-3">Description</th>
 <th className="p-3">Vendor</th>
 <th className="p-3">Status</th>
 <th className="p-3">Action</th>
 </tr>
 </thead>
 <tbody className="divide-y">
 {repairs.map(r => (
 <tr key={r._id}>
 <td className="p-3 font-semibold">{r.asset?.name || "Unknown"}</td>
 <td className="p-3">{r.description}</td>
 <td className="p-3">{r.vendor}</td>
 <td className="p-3 font-bold">{r.status}</td>
 <td className="p-3">
 {r.status === "Pending" && (
 <button onClick={() => {
 setSelectedRepair(r);
 setShowCompleteRepairModal(true);
 }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-md text-xs font-bold shadow-xs transition-colors">Complete</button>
 )}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}

 {!loading && activeTab === "consumptions" && (
 <div>
 <h2 className="text-xl font-bold mb-6">Consumption Tracking</h2>
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm">
 <thead className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-b">
 <tr>
 <th className="p-3">Date</th>
 <th className="p-3">User</th>
 <th className="p-3">Item</th>
 <th className="p-3">Used Qty</th>
 <th className="p-3">Remarks</th>
 </tr>
 </thead>
 <tbody className="divide-y">
 {consumptions.map(c => (
 <tr key={c._id}>
 <td className="p-3">{formatDateTime(c.createdAt)}</td>
 <td className="p-3">{c.userName}</td>
 <td className="p-3">{c.itemName}</td>
 <td className="p-3 font-bold text-red-600">{c.usedQuantity} {c.unit}</td>
 <td className="p-3">{c.remarks}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}

 {!loading && activeTab === "settings" && (
 <div>
 <h2 className="text-xl font-bold mb-6">Pooja Material Mappings</h2>
 <form onSubmit={handleSavePoojaSetting} className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-xl border mb-6 flex flex-col gap-4 max-w-4xl">
 <div>
 <label className="block text-sm font-bold mb-1">Pooja Name</label>
 <input name="poojaName" required className="w-full border p-2 rounded" placeholder="e.g. Satyanarayana Swamy Vratha" />
 </div>
 <div>
 <div className="flex justify-between items-center mb-2">
 <label className="block text-sm font-bold">Required Materials</label>
 <button type="button" onClick={handleAddPoojaMaterialRow} className="text-sm bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] hover:bg-slate-300 px-3 py-1 rounded font-bold">+ Add Material</button>
 </div>
 <div className="flex flex-col gap-2">
 {poojaMaterials.map((mat, idx) => (
 <div key={idx} className="flex gap-2 items-center bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-2 rounded border">
 <select 
 className="border p-2 rounded flex-1" 
 value={mat.item} 
 onChange={(e) => handlePoojaMaterialChange(idx, "item", e.target.value)}
 required
 >
 <option value="">Select Item</option>
 {items.filter(i => i.category === "Pooja Items" || i.category === "Prasadam").map(i => (
 <option key={i._id} value={i._id}>{i.name} ({i.unit})</option>
 ))}
 </select>
 <input 
 type="number" 
 step="0.01"
 min="0"
 className="border p-2 rounded w-24" 
 placeholder="Qty" 
 value={mat.quantity}
 onChange={(e) => handlePoojaMaterialChange(idx, "quantity", e.target.value)}
 required
 />
 <label className="flex items-center gap-1 text-sm font-bold">
 <input 
 type="checkbox" 
 checked={mat.templeArrangeAvailable} 
 onChange={(e) => handlePoojaMaterialChange(idx, "templeArrangeAvailable", e.target.checked)} 
 />
 Temple Arranges?
 </label>
 {mat.templeArrangeAvailable && (
 <input 
 type="number" 
 className="border p-2 rounded w-24" 
 placeholder="Charge ₹" 
 value={mat.templeCharge}
 onChange={(e) => handlePoojaMaterialChange(idx, "templeCharge", e.target.value)}
 />
 )}
 <button type="button" onClick={() => handleRemovePoojaMaterialRow(idx)} className="text-red-500 font-bold px-2">X</button>
 </div>
 ))}
 {poojaMaterials.length === 0 && <p className="text-slate-500 dark:text-slate-200 text-sm italic">No materials added.</p>}
 </div>
 </div>
 <div className="flex justify-end mt-2">
 <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded font-bold">Create Rule</button>
 </div>
 </form>
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm">
 <thead className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-b">
 <tr>
 <th className="p-3">Pooja Name</th>
 <th className="p-3">Required Materials</th>
 </tr>
 </thead>
 <tbody className="divide-y">
 {poojaSettings.map(ps => (
 <tr key={ps._id}>
 <td className="p-3 font-semibold">{ps.poojaName}</td>
 <td className="p-3">{ps.requiredMaterials.length} items mapped</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}
 </div>

 {/* Modals for creation (Item, Supplier, Asset, Repair) */}
 {showItemModal && (
 <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl w-96">
 <h3 className="text-lg font-bold mb-4">{editItem ? "Edit Item" : "Add Item"}</h3>
 <form onSubmit={handleSaveItem} className="space-y-3">
 <input name="name" defaultValue={editItem?.name} placeholder="Name" required className="w-full border p-2 rounded" />
 <select name="category" defaultValue={editItem?.category} className="w-full border p-2 rounded" required>
 <option value="">Select Category</option>
 {INVENTORY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
 </select>
 <select name="unit" defaultValue={editItem?.unit || "Piece (Pc)"} className="w-full border p-2 rounded" required>
 <option value="">Select Unit</option>
 {Object.entries(UNIT_GROUPS).map(([groupName, units]) => (
 <optgroup key={groupName} label={groupName}>
 {units.map((u) => (
 <option key={u} value={u}>{u}</option>
 ))}
 </optgroup>
 ))}
 </select>
 <div className="flex gap-2">
 <div className="flex-1">
 <label className="block text-xs font-bold text-slate-500 dark:text-slate-200 mb-1">Initial Stock (Qty)</label>
 <input name="availableStock" type="number" defaultValue={editItem?.availableStock || 0} placeholder="Initial Stock" required className="w-full border p-2 rounded" disabled={!!editItem} />
 </div>
 <div className="flex-1">
 <label className="block text-xs font-bold text-slate-500 dark:text-slate-200 mb-1">Min Stock</label>
 <input name="minimumStock" type="number" defaultValue={editItem?.minimumStock || 0} placeholder="Min Stock" required className="w-full border p-2 rounded" />
 </div>
 <div className="flex-1">
 <label className="block text-xs font-bold text-slate-500 dark:text-slate-200 mb-1">Reorder Level</label>
 <input name="reorderLevel" type="number" defaultValue={editItem?.reorderLevel || 0} placeholder="Reorder Level" className="w-full border p-2 rounded" />
 </div>
 </div>
 <input name="lastSupplier" defaultValue={editItem?.lastSupplier} placeholder="Supplier Name" className="w-full border p-2 rounded" />
 <input name="lastPurchasePrice" type="number" step="0.01" defaultValue={editItem?.lastPurchasePrice} placeholder="Price of single" className="w-full border p-2 rounded" />
 {editItem && (
 <div className="flex items-center gap-2 mt-2">
 <input type="checkbox" name="isActive" id="isActive" defaultChecked={editItem.isActive !== false} />
 <label htmlFor="isActive" className="text-sm font-bold">Item is Active</label>
 </div>
 )}
 <div className="flex gap-2 justify-end mt-4">
 <button type="button" onClick={() => setShowItemModal(false)} className="px-4 py-2 border rounded-xl font-bold">Cancel</button>
 <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold">Save</button>
 </div>
 </form>
 </div>
 </div>
 )}

 {showSupplierModal && (
 <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl w-96">
 <h3 className="text-lg font-bold mb-4">Add Supplier</h3>
 <form onSubmit={handleSaveSupplier} className="space-y-3">
 <input name="name" placeholder="Name" required className="w-full border p-2 rounded" />
 <input name="phone" placeholder="Phone" required className="w-full border p-2 rounded" />
 <input name="email" placeholder="Email" className="w-full border p-2 rounded" />
 <input name="gst" placeholder="GST Number" className="w-full border p-2 rounded" />
 <div className="flex gap-2 justify-end mt-4">
 <button type="button" onClick={() => setShowSupplierModal(false)} className="px-4 py-2 border rounded-xl font-bold">Cancel</button>
 <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold">Save</button>
 </div>
 </form>
 </div>
 </div>
 )}

 {showAssetModal && (
 <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl w-96">
 <h3 className="text-lg font-bold mb-4">Add Asset</h3>
 <form onSubmit={handleSaveAsset} className="space-y-3">
 <input name="assetId" placeholder="Asset ID" required className="w-full border p-2 rounded" />
 <input name="name" placeholder="Name" required className="w-full border p-2 rounded" />
 <input name="category" placeholder="Category" required className="w-full border p-2 rounded" />
 <input name="assignedLocation" placeholder="Location" className="w-full border p-2 rounded" />
 <div className="flex gap-2">
 <input name="purchaseCost" type="number" placeholder="Purchase Cost (₹)" className="w-full border p-2 rounded flex-1" />
 <input name="serialNumber" placeholder="Serial Number" className="w-full border p-2 rounded flex-1" />
 </div>
 <div className="flex gap-2 justify-end mt-4">
 <button type="button" onClick={() => setShowAssetModal(false)} className="px-4 py-2 border rounded-xl font-bold">Cancel</button>
 <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold">Save</button>
 </div>
 </form>
 </div>
 </div>
 )}

 {showRepairModal && (
 <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl w-96">
 <h3 className="text-lg font-bold mb-4">Log Repair</h3>
 <form onSubmit={handleSaveRepair} className="space-y-3">
 <select name="asset" required className="w-full border p-2 rounded">
 <option value="">Select Asset...</option>
 {assets.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}
 </select>
 <input name="description" placeholder="Issue Description" required className="w-full border p-2 rounded" />
 <input name="vendor" placeholder="Vendor Name" required className="w-full border p-2 rounded" />
 <input name="cost" type="number" placeholder="Estimated Cost" className="w-full border p-2 rounded" />
 <div className="flex gap-2 justify-end mt-4">
 <button type="button" onClick={() => setShowRepairModal(false)} className="px-4 py-2 border rounded-xl font-bold">Cancel</button>
 <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold">Save</button>
 </div>
 </form>
 </div>
 </div>
 )}

 {showCompleteRepairModal && selectedRepair && (
 <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl w-full max-w-md">
 <h3 className="text-lg font-bold mb-4">Complete Repair: {selectedRepair.asset?.name}</h3>
 <form onSubmit={handleCompleteRepairSubmit} className="space-y-3">
 <input name="cost" type="number" placeholder="Final Cost (₹)" required className="w-full border p-2 rounded" />
 <input name="invoiceNumber" placeholder="Invoice Number (if any)" className="w-full border p-2 rounded" />
 <select name="paymentMethod" required className="w-full border p-2 rounded">
 <option value="Cash">Cash</option>
 <option value="Bank Transfer">Bank Transfer</option>
 <option value="System">System</option>
 </select>
 <input name="completionDate" type="date" required className="w-full border p-2 rounded" defaultValue={new Date().toISOString().split('T')[0]} />
 <textarea name="remarks" placeholder="Remarks" className="w-full border p-2 rounded h-20"></textarea>
 <div className="flex gap-2 justify-end mt-4">
 <button type="button" onClick={() => setShowCompleteRepairModal(false)} className="px-4 py-2 border rounded-xl font-bold">Cancel</button>
 <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold">Complete Repair</button>
 </div>
 </form>
 </div>
 </div>
 )}

 {showRestockModal && selectedItem && (
 <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl w-full max-w-md">
 <h3 className="text-lg font-bold mb-4">Restock {selectedItem.name}</h3>
 <form onSubmit={handleRestock} className="space-y-3">
 <input name="quantityAdded" type="number" placeholder="Quantity Added" required className="w-full border p-2 rounded" />
 <input name="supplier" placeholder="Supplier Name" required className="w-full border p-2 rounded" />
 <input name="cost" type="number" placeholder="Total Cost (₹)" required className="w-full border p-2 rounded" />
 <input name="gst" type="number" placeholder="GST Amount (₹)" className="w-full border p-2 rounded" />
 <input name="invoiceUrl" placeholder="Invoice Number" required className="w-full border p-2 rounded" />
 <div className="flex gap-2">
 <div className="flex-1">
 <label className="text-xs font-bold text-slate-500 dark:text-slate-200 ">Purchase Date</label>
 <input name="purchaseDate" type="date" required className="w-full border p-2 rounded" />
 </div>
 <div className="flex-1">
 <label className="text-xs font-bold text-slate-500 dark:text-slate-200 ">Expiry Date</label>
 <input name="expiryDate" type="date" className="w-full border p-2 rounded" />
 </div>
 </div>
 <input name="remarks" placeholder="Remarks (optional)" className="w-full border p-2 rounded" />
 <div className="flex gap-2 justify-end mt-4">
 <button type="button" onClick={() => setShowRestockModal(false)} className="px-4 py-2 border rounded-xl font-bold">Cancel</button>
 <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold">Process Purchase</button>
 </div>
 </form>
 </div>
 </div>
 )}

 {showAdjustModal && selectedItem && (
 <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl w-full max-w-md">
 <h3 className="text-lg font-bold mb-4">Adjust Stock: {selectedItem.name}</h3>
 <p className="text-sm text-slate-500 dark:text-slate-200 mb-4">Current Available: {selectedItem.availableStock} {selectedItem.unit}</p>
 <form onSubmit={handleAdjustStock} className="space-y-3">
 <select name="type" required className="w-full border p-2 rounded font-bold">
 <option value="">Select Type...</option>
 <option value="Damaged">Mark as Damaged</option>
 <option value="Expired">Mark as Expired</option>
 <option value="Lost">Mark as Lost</option>
 <option value="Returned">Mark as Returned</option>
 </select>
 <input name="quantity" type="number" placeholder="Quantity" required className="w-full border p-2 rounded" />
 <input name="reason" placeholder="Reason for adjustment" required className="w-full border p-2 rounded" />
 <div className="flex gap-2 justify-end mt-4">
 <button type="button" onClick={() => setShowAdjustModal(false)} className="px-4 py-2 border rounded-xl font-bold">Cancel</button>
 <button type="submit" className="px-4 py-2 bg-amber-600 text-white rounded-xl font-bold">Confirm Adjustment</button>
 </div>
 </form>
 </div>
 </div>
 )}

 {showItemDetails && itemDetails && (
 <div className="fixed inset-0 bg-black/40 flex justify-end z-50">
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] w-full max-w-2xl h-full shadow-xl overflow-y-auto flex flex-col animate-slide-in-right">
 <div className="p-6 border-b flex justify-between items-center bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <div>
 <h3 className="text-2xl font-black text-slate-800 dark:text-slate-200 ">{itemDetails.item.name}</h3>
 <p className="text-sm font-bold text-slate-500 dark:text-slate-200 ">{itemDetails.item.category}</p>
 </div>
 <button onClick={() => setShowItemDetails(false)} className="text-slate-500 dark:text-slate-200 hover:bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-2 rounded-full">
 ✕ Close
 </button>
 </div>
 
 <div className="p-6 space-y-8 flex-1">
 <div className="grid grid-cols-3 gap-4">
 <div className="bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 rounded-xl border border-emerald-100">
 <p className="text-xs font-bold text-emerald-600 uppercase">Available</p>
 <p className="text-xl font-black text-emerald-800">{itemDetails.item.availableStock} {itemDetails.item.unit}</p>
 </div>
 <div className="bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 rounded-xl border border-amber-100">
 <p className="text-xs font-bold text-amber-600 uppercase">Minimum</p>
 <p className="text-xl font-black text-amber-800">{itemDetails.item.minimumStock} {itemDetails.item.unit}</p>
 </div>
 <div className="bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 rounded-xl border border-rose-100">
 <p className="text-xs font-bold text-rose-600 uppercase">Damaged/Exp</p>
 <p className="text-xl font-black text-rose-800">{itemDetails.item.damagedStock + itemDetails.item.expiredStock} {itemDetails.item.unit}</p>
 </div>
 </div>
 
 <div>
 <h4 className="font-bold text-lg border-b pb-2 mb-4">Recent Purchase History</h4>
 {itemDetails.purchaseHistory.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-200 ">No purchase history.</p> : (
 <div className="border rounded-xl overflow-hidden">
 <table className="w-full text-left text-sm">
 <thead className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-b">
 <tr>
 <th className="p-2">Date</th>
 <th className="p-2">Supplier</th>
 <th className="p-2">Qty</th>
 <th className="p-2">Cost</th>
 <th className="p-2">Inv#</th>
 </tr>
 </thead>
 <tbody className="divide-y">
 {itemDetails.purchaseHistory.map(ph => (
 <tr key={ph._id}>
 <td className="p-2">{formatDateTime(ph.purchaseDate)}</td>
 <td className="p-2 font-semibold">{ph.supplier}</td>
 <td className="p-2">{ph.quantity} {ph.unit}</td>
 <td className="p-2">₹{ph.cost}</td>
 <td className="p-2">{ph.invoiceUrl}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 
 <div>
 <h4 className="font-bold text-lg border-b pb-2 mb-4">Recent Stock Movement</h4>
 {itemDetails.stockMovement.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-200 ">No stock movement.</p> : (
 <div className="border rounded-xl overflow-hidden">
 <table className="w-full text-left text-sm">
 <thead className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-b">
 <tr>
 <th className="p-2">Date</th>
 <th className="p-2">Action</th>
 <th className="p-2">Qty</th>
 <th className="p-2">Balance</th>
 <th className="p-2">By</th>
 </tr>
 </thead>
 <tbody className="divide-y">
 {itemDetails.stockMovement.map(sm => (
 <tr key={sm._id}>
 <td className="p-2">{formatDateTime(sm.date)}</td>
 <td className="p-2 font-bold">{sm.action}</td>
 <td className="p-2">{sm.quantity}</td>
 <td className="p-2">{sm.newStock}</td>
 <td className="p-2">{sm.user?.name || "System"}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 </div>
 </div>
 </div>
 )}
 </div>
 );
};

export default InventoryManagement;
