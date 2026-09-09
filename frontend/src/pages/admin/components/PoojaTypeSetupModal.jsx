import { useState, useEffect } from "react";
import axios from "axios";

const API_BASE = "http://localhost:5000/api";

export default function PoojaTypeSetupModal({ editingPooja, onClose, onSave }) {
 const [name, setName] = useState(editingPooja?.name || "");
 const [description, setDescription] = useState(editingPooja?.description || "");
 const [price, setPrice] = useState(editingPooja?.price || 501);
 const [duration, setDuration] = useState(editingPooja?.duration || "");
 const [dressCode, setDressCode] = useState(editingPooja?.dressCode || (editingPooja ? "" : "Traditional and modest attire is required inside the temple."));
 const [availableDays, setAvailableDays] = useState(editingPooja?.availableDays || ["Everyday"]);
 const [availableDates, setAvailableDates] = useState(editingPooja?.availableDates || []);
 const [newDate, setNewDate] = useState("");
 const [availableStartTime, setAvailableStartTime] = useState(editingPooja?.availableStartTime || "");
 const [availableEndTime, setAvailableEndTime] = useState(editingPooja?.availableEndTime || "");
 const [minimumAdvanceBookingDays, setMinimumAdvanceBookingDays] = useState(editingPooja?.minimumAdvanceBookingDays || 0);
 const [strictAdvancePreparation, setStrictAdvancePreparation] = useState(editingPooja?.strictAdvancePreparation ?? false);

 const [rules, setRules] = useState(editingPooja?.rules || []);
 const [newRule, setNewRule] = useState("");

 const [instructions, setInstructions] = useState(editingPooja?.instructions || []);
 const [newInstruction, setNewInstruction] = useState("");

 const [requiredMaterials, setRequiredMaterials] = useState(editingPooja?.requiredMaterials || []);

 const [inventoryItems, setInventoryItems] = useState([]);
 const [materialSource, setMaterialSource] = useState("TEMPLE_INVENTORY");
 const [externalMaterialName, setExternalMaterialName] = useState("");
 const [selectedItem, setSelectedItem] = useState("");
 const [qty, setQty] = useState("");
 const [unit, setUnit] = useState("");
 const [responsibilityType, setResponsibilityType] = useState("TEMPLE_PROVIDES");
 const [preparationDaysBeforePooja, setPreparationDaysBeforePooja] = useState(0);
 const [preparationInstructions, setPreparationInstructions] = useState("");
 const [requiresAdvanceCollection, setRequiresAdvanceCollection] = useState(false);
 const [collectionInstructions, setCollectionInstructions] = useState("");
 const [mandatory, setMandatory] = useState(false);
 const [templeCharge, setTempleCharge] = useState(0);

 const WEEKDAYS = ["Everyday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

 const [error, setError] = useState("");

 useEffect(() => {
 const fetchInventory = async () => {
 try {
 const token = localStorage.getItem("token");
 const res = await axios.get(`${API_BASE}/admin/inventory-items`, {
 headers: token ? { Authorization: `Bearer ${token}` } : {}
 });
 setInventoryItems(res.data.items || []);
 } catch (err) {
 console.error("Failed to fetch inventory items", err);
 }
 };
 fetchInventory();
 }, []);

 const handleAddRule = () => {
 if (newRule.trim()) {
 setRules([...rules, newRule.trim()]);
 setNewRule("");
 }
 };

 const handleAddInstruction = () => {
 if (newInstruction.trim()) {
 setInstructions([...instructions, newInstruction.trim()]);
 setNewInstruction("");
 }
 };

 const handleAddDate = () => {
 if (newDate.trim() && !availableDates.includes(newDate.trim())) {
 setAvailableDates([...availableDates, newDate.trim()]);
 setNewDate("");
 }
 };

 const handleAddMaterial = () => {
 if (materialSource === "TEMPLE_INVENTORY") {
 if (!selectedItem || !qty || !unit.trim()) {
 setError("Please select an item, quantity, and unit.");
 return;
 }
 } else {
 if (!externalMaterialName.trim() || !qty || !unit.trim()) {
 setError("Please enter a material name, quantity, and unit.");
 return;
 }
 }

 let itemObj = null;
 let nameToUse = externalMaterialName.trim();
 let itemIdToUse = undefined;

 if (materialSource === "TEMPLE_INVENTORY") {
 itemObj = inventoryItems.find(i => i._id === selectedItem);
 if (!itemObj) return;
 nameToUse = itemObj.name;
 itemIdToUse = selectedItem;
 }

 setRequiredMaterials([...requiredMaterials, {
 item: itemIdToUse,
 materialSource: materialSource,
 itemName: nameToUse,
 qty: Number(qty),
 unit: unit.trim(),
 responsibilityType,
 mandatory,
 templeCharge: responsibilityType === "DEVOTEE_OR_TEMPLE" ? Number(templeCharge) : 0,
 preparationDaysBeforePooja: responsibilityType === "DEVOTEE_PREPARATION_REQUIRED" ? Number(preparationDaysBeforePooja) : 0,
 preparationInstructions: responsibilityType === "DEVOTEE_PREPARATION_REQUIRED" ? preparationInstructions.trim() : "",
 requiresAdvanceCollection: responsibilityType === "DEVOTEE_PREPARATION_REQUIRED" ? requiresAdvanceCollection : false,
 collectionInstructions: (responsibilityType === "DEVOTEE_PREPARATION_REQUIRED" && requiresAdvanceCollection) ? collectionInstructions.trim() : ""
 }]);

 setSelectedItem("");
 setExternalMaterialName("");
 setMaterialSource("TEMPLE_INVENTORY");
 setQty("");
 setUnit("");
 setTempleCharge(0);
 setMandatory(false);
 setResponsibilityType("TEMPLE_PROVIDES");
 setPreparationDaysBeforePooja(0);
 setPreparationInstructions("");
 setRequiresAdvanceCollection(false);
 setCollectionInstructions("");
 setError("");
 };

 const handleSave = () => {
 if (!name.trim() || price <= 0) {
 setError("Please enter a valid Pooja name and price.");
 return;
 }

 const payload = {
 name: name.trim(),
 description: description.trim(),
 price: Number(price),
 duration: duration.trim(),
 availableDays,
 availableDates,
 availableStartTime,
 availableEndTime,
 dressCode: dressCode.trim(),
 rules,
 instructions,
 requiredMaterials,
 minimumAdvanceBookingDays: Number(minimumAdvanceBookingDays) || 0,
 strictAdvancePreparation,
 status: "Active"
 };

 onSave(payload);
 };

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8 overflow-y-auto">
 <div className="w-full max-w-4xl rounded-3xl border border-[#f0f0f0] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-8 shadow-2xl relative my-auto">
 <button type="button" onClick={onClose} className="absolute top-4 right-4 text-[#858b96] dark:text-slate-200 hover:text-[#15141f] dark:text-slate-200 text-3xl font-bold">&times;</button>
 <h3 className="text-2xl font-bold text-[#15141f] dark:text-slate-200 mb-6 border-b pb-4">
 {editingPooja ? "Edit Pooja Setup" : "Create New Pooja"}
 </h3>

 {error && <div className="mb-4 rounded-xl bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-3 text-red-600 font-medium">{error}</div>}

 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 {/* Basic Details */}
 <div className="space-y-4">
 <h4 className="text-lg font-bold text-[#323946] dark:text-slate-200 ">Basic Details</h4>

 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Pooja Name <span className="text-red-500">*</span>
 <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2.5 outline-none focus:border-[#8b5e3c]" placeholder="e.g. Satyanarayana Vratha" />
 </label>

 <div className="grid grid-cols-2 gap-4">
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Price (₹) <span className="text-red-500">*</span>
 <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2.5 outline-none focus:border-[#8b5e3c]" />
 </label>
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Duration
 <input type="text" value={duration} onChange={(e) => setDuration(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2.5 outline-none focus:border-[#8b5e3c]" placeholder="e.g. 2 Hours" />
 </label>
 </div>

 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Description
 <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" placeholder="Pooja description..." />
 </label>

 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Dress Code
 <input type="text" value={dressCode} onChange={(e) => setDressCode(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2.5 outline-none focus:border-[#8b5e3c]" placeholder="e.g. Traditional Indian wear" />
 </label>

 <div className="pt-2 border-t mt-2">
 <h5 className="font-bold text-[#323946] dark:text-slate-200 mb-2">Schedule</h5>
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 mb-1">Available Days</label>
 <div className="flex flex-wrap gap-2 mb-3">
 {WEEKDAYS.map(day => (
 <label key={day} className="flex items-center gap-1 text-sm bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border px-2 py-1 rounded cursor-pointer">
 <input
 type="checkbox"
 checked={availableDays.includes(day)}
 onChange={(e) => {
 if (e.target.checked) {
 setAvailableDays(day === "Everyday" ? ["Everyday"] : [...availableDays.filter(d => d !== "Everyday"), day]);
 } else {
 setAvailableDays(availableDays.filter(d => d !== day));
 }
 }}
 /> {day}
 </label>
 ))}
 </div>

 <div className="grid grid-cols-2 gap-4 mb-3">
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Start Time
 <input type="time" value={availableStartTime} onChange={(e) => setAvailableStartTime(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" />
 </label>
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 End Time
 <input type="time" value={availableEndTime} onChange={(e) => setAvailableEndTime(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" />
 </label>
 </div>

 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 mb-1">Specific Dates (Optional Festival Dates)</label>
 <div className="flex gap-2">
 <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" />
 <button type="button" onClick={handleAddDate} className="rounded-xl bg-[#e0f2fe] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-bold text-[#0369a1] dark:text-slate-200 hover:bg-[#bae6fd]">Add</button>
 </div>
 <ul className="mt-2 flex flex-wrap gap-2">
 {availableDates.map((d, i) => (
 <li key={i} className="flex gap-1 items-center bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-blue-800 text-xs px-2 py-1 rounded border border-blue-200">
 {d} <button type="button" onClick={() => setAvailableDates(availableDates.filter((_, idx) => idx !== i))} className="text-red-500 font-bold ml-1">&times;</button>
 </li>
 ))}
 </ul>

 <div className="mt-4 pt-2 border-t border-[#f0ece6] dark:border-slate-700 ">
 <h5 className="font-bold text-[#323946] dark:text-slate-200 mb-2">Advance Booking Constraints</h5>
 <div className="grid grid-cols-2 gap-4">
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Min. Advance Booking (Days)
 <input type="number" min="0" value={minimumAdvanceBookingDays} onChange={(e) => setMinimumAdvanceBookingDays(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" />
 </label>
 <label className="flex items-center gap-2 text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 mt-6">
 <input type="checkbox" checked={strictAdvancePreparation} onChange={(e) => setStrictAdvancePreparation(e.target.checked)} className="w-4 h-4 accent-[#1b7f77]" />
 Strict Validation (Block Booking)
 </label>
 </div>
 </div>
 </div>

 <div className="pt-2 border-t mt-2">
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 mb-1">Rules (For Devotee)</label>
 <div className="flex gap-2">
 <input type="text" value={newRule} onChange={(e) => setNewRule(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddRule()} className="w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" placeholder="e.g. Fasting required" />
 <button type="button" onClick={handleAddRule} className="rounded-xl bg-[#e0f2fe] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-bold text-[#0369a1] dark:text-slate-200 hover:bg-[#bae6fd]">Add</button>
 </div>
 <ul className="mt-2 space-y-1">
 {rules.map((r, i) => (
 <li key={i} className="flex justify-between rounded-lg bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1 text-sm text-gray-700 dark:text-slate-200 ">
 <span>• {r}</span>
 <button type="button" onClick={() => setRules(rules.filter((_, idx) => idx !== i))} className="text-red-500 font-bold">&times;</button>
 </li>
 ))}
 </ul>
 </div>

 <div className="pt-2">
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 mb-1">Instructions (For Priest)</label>
 <div className="flex gap-2">
 <input type="text" value={newInstruction} onChange={(e) => setNewInstruction(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddInstruction()} className="w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" placeholder="e.g. Needs special kalasha" />
 <button type="button" onClick={handleAddInstruction} className="rounded-xl bg-[#e0f2fe] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-bold text-[#0369a1] dark:text-slate-200 hover:bg-[#bae6fd]">Add</button>
 </div>
 <ul className="mt-2 space-y-1">
 {instructions.map((r, i) => (
 <li key={i} className="flex justify-between rounded-lg bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1 text-sm text-gray-700 dark:text-slate-200 ">
 <span>• {r}</span>
 <button type="button" onClick={() => setInstructions(instructions.filter((_, idx) => idx !== i))} className="text-red-500 font-bold">&times;</button>
 </li>
 ))}
 </ul>
 </div>
 </div>

 {/* Materials Section */}
 <div className="space-y-4 border-l pl-6 border-[#f0ece6] dark:border-slate-700 ">
 <h4 className="text-lg font-bold text-[#323946] dark:text-slate-200 ">Required Materials</h4>

 <div className="rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 space-y-3">
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 mb-3">
 Material Source
 <div className="flex gap-4 mt-1">
 <label className="flex items-center gap-2 cursor-pointer">
 <input type="radio" name="materialSource" value="TEMPLE_INVENTORY" checked={materialSource === "TEMPLE_INVENTORY"} onChange={() => setMaterialSource("TEMPLE_INVENTORY")} className="accent-[#1b7f77]" />
 Temple Inventory
 </label>
 <label className="flex items-center gap-2 cursor-pointer">
 <input type="radio" name="materialSource" value="EXTERNAL_OR_DEVOTEE" checked={materialSource === "EXTERNAL_OR_DEVOTEE"} onChange={() => setMaterialSource("EXTERNAL_OR_DEVOTEE")} className="accent-[#1b7f77]" />
 External / Devotee Arranged
 </label>
 </div>
 </label>

 {materialSource === "TEMPLE_INVENTORY" ? (
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Select Inventory Item
 <select
 value={selectedItem}
 onChange={(e) => {
 const id = e.target.value;
 setSelectedItem(id);
 const item = inventoryItems.find(i => i._id === id);
 if (item) setUnit(item.unit || "");
 }}
 className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "
 >
 <option value="">-- Choose Item --</option>
 {inventoryItems.map(item => (
 <option key={item._id} value={item._id}>{item.name} ({item.category})</option>
 ))}
 </select>
 </label>
 ) : (
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Material Name
 <input type="text" value={externalMaterialName} onChange={(e) => setExternalMaterialName(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" placeholder="e.g. Fresh Flowers" />
 </label>
 )}

 <div className="grid grid-cols-2 gap-3">
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Quantity
 <input type="number" step="1" min="0" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" placeholder="e.g. 2" />
 </label>
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Unit
 <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" placeholder="e.g. Kg, Pcs" />
 </label>
 </div>

 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 mt-3">
 Responsibility Type
 <select value={responsibilityType} onChange={(e) => setResponsibilityType(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <option value="TEMPLE_PROVIDES">Temple Provides (No Action from Devotee)</option>
 <option value="DEVOTEE_MUST_BRING">Devotee Must Bring (On Pooja Day)</option>
 <option value="DEVOTEE_OR_TEMPLE">Devotee Can Bring or Temple Arranges</option>
 <option value="DEVOTEE_PREPARATION_REQUIRED">Devotee Advance Preparation Required</option>
 </select>
 </label>

 {responsibilityType === "DEVOTEE_OR_TEMPLE" && (
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Temple Charge if Arranged (₹)
 <input type="number" min="0" value={templeCharge} onChange={(e) => setTempleCharge(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" />
 </label>
 )}

 {responsibilityType === "DEVOTEE_PREPARATION_REQUIRED" && (
 <div className="bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-orange-200 p-3 rounded-xl space-y-3">
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Preparation Days Required Before Pooja
 <input type="number" min="1" value={preparationDaysBeforePooja} onChange={(e) => setPreparationDaysBeforePooja(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" />
 </label>
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Preparation Instructions (For Devotee)
 <textarea value={preparationInstructions} onChange={(e) => setPreparationInstructions(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" placeholder="How to prepare the material..." />
 </label>
 <label className="flex items-center gap-2 text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 mt-1 cursor-pointer">
 <input type="checkbox" checked={requiresAdvanceCollection} onChange={(e) => setRequiresAdvanceCollection(e.target.checked)} className="w-4 h-4 accent-orange-600" />
 Requires Advance Collection from Temple
 </label>
 {requiresAdvanceCollection && (
 <label className="block text-sm font-semibold text-[#4f4f4f] dark:text-slate-200 ">
 Collection Instructions
 <input type="text" value={collectionInstructions} onChange={(e) => setCollectionInstructions(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ded6c6] dark:border-slate-700 px-4 py-2 outline-none focus:border-[#8b5e3c]" placeholder="e.g. Collect from Temple Counter #1" />
 </label>
 )}
 </div>
 )}

 <div className="flex gap-4 pt-1 flex-wrap">
 <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-slate-200 cursor-pointer">
 <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} className="w-4 h-4 accent-[#1b7f77]" />
 Mandatory to have
 </label>
 </div>

 <button type="button" onClick={handleAddMaterial} className="w-full mt-2 rounded-xl bg-[#15141f] dark:bg-[#0f172a] py-2 text-sm font-bold text-white hover:bg-black dark:hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 + Add Material to Pooja
 </button>
 </div>

 <div className="mt-4 max-h-[300px] overflow-y-auto pr-2">
 {requiredMaterials.length === 0 ? (
 <p className="text-sm text-gray-500 dark:text-slate-200 text-center py-4">No materials added yet.</p>
 ) : (
 <div className="space-y-2">
 {requiredMaterials.map((mat, idx) => (
 <div key={idx} className="relative rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-3 shadow-sm">
 <button type="button" onClick={() => setRequiredMaterials(requiredMaterials.filter((_, i) => i !== idx))} className="absolute top-2 right-2 text-red-500 hover:text-red-700 font-bold">&times;</button>
 <p className="font-bold text-[#15141f] dark:text-slate-200 ">{mat.itemName} <span className="text-sm font-normal text-gray-500 dark:text-slate-200 ">({mat.qty} {mat.unit})</span></p>
 <div className="mt-1 flex gap-2 flex-wrap">
 {mat.responsibilityType === "TEMPLE_PROVIDES" && <span className="rounded bg-teal-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-0.5 text-xs font-semibold text-teal-700">Temple Provides</span>}
 {mat.responsibilityType === "DEVOTEE_MUST_BRING" && <span className="rounded bg-blue-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-0.5 text-xs font-semibold text-blue-700">Devotee Must Bring</span>}
 {mat.responsibilityType === "DEVOTEE_OR_TEMPLE" && <span className="rounded bg-green-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-0.5 text-xs font-semibold text-green-700">Devotee / Temple Arrange (₹{mat.templeCharge})</span>}
 {mat.responsibilityType === "DEVOTEE_PREPARATION_REQUIRED" && <span className="rounded bg-orange-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-0.5 text-xs font-semibold text-orange-700">Adv. Prep ({mat.preparationDaysBeforePooja}d)</span>}
 {mat.mandatory && <span className="rounded bg-gray-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-0.5 text-xs font-semibold text-gray-700 dark:text-slate-200 ">Mandatory</span>}
 </div>
 </div>
 ))}
 </div>
 )}
 </div>

 </div>
 </div>

 <div className="mt-8 flex justify-end gap-3 border-t border-[#f0ece6] dark:border-slate-700 pt-4">
 <button type="button" onClick={onClose} className="rounded-xl border border-[#d1d5db] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-6 py-2.5 font-bold text-[#374151] dark:text-slate-200 hover:bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">Cancel</button>
 <button type="button" onClick={handleSave} className="rounded-xl bg-[#1b7f77] px-8 py-2.5 font-bold text-white hover:bg-[#146059]">Save Pooja</button>
 </div>
 </div>
 </div>
 );
}
