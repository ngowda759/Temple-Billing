import React, { useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { FaCalendarAlt, FaChevronDown } from "react-icons/fa";

const poojaPrices = {
 "Abhisheka": 801,
 "Archana": 501,
 "Special Homa": 1501,
 "Satyanarayana Puja": 1201,
 "Maha Lakshmi Pooja": 2201,
 "Harigriha Pooja": 501
};

const popularPoojas = Object.keys(poojaPrices).map(name => ({
 name,
 price: poojaPrices[name]
}));

const PoojaBookingPage = () => {
 const [poojaSettings, setPoojaSettings] = useState([]);
 
 React.useEffect(() => {
 const fetchSettings = async () => {
 try {
 const token = localStorage.getItem("token");
 const res = await axios.get("http://localhost:5000/api/pooja-settings", {
 headers: { Authorization: `Bearer ${token}` }
 });
 setPoojaSettings(res.data?.requirements || []);
 } catch (err) {
 console.error("Failed to load pooja settings", err);
 }
 };
 fetchSettings();
 }, []);

 const [formData, setFormData] = useState({
 customerName: "",
 service: "Abhisheka",
 bookingDate: "",
 amount: poojaPrices["Abhisheka"],
 paymentMethod: "UPI",
 contactNumber: "",
 notes: "",
 materialsProvidedByTemple: false
 });

 const [loading, setLoading] = useState(false);

 const handleChange = (e) => {
 const { name, value } = e.target;
 
 if (name === "service") {
 setFormData({
 ...formData,
 service: value,
 amount: poojaPrices[value] || "",
 materialsProvidedByTemple: false // Reset when service changes
 });
 } else if (name === "materialsProvidedByTemple") {
 setFormData({
 ...formData,
 [name]: e.target.checked
 });
 } else if (name === "bookingDate") {
 if (!value) {
 setFormData({ ...formData, [name]: value });
 return;
 }
 const selectedSetting = poojaSettings.find(p => p.poojaName === formData.service);
 if (selectedSetting && selectedSetting.availableDays && selectedSetting.availableDays.length > 0) {
 const isEveryday = selectedSetting.availableDays.some(d => d.toLowerCase() === "everyday");
 if (!isEveryday) {
 const dateObj = new Date(value);
 const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
 const dayName = daysOfWeek[dateObj.getDay()];
 
 if (!selectedSetting.availableDays.includes(dayName)) {
 toast.error(`${formData.service} is only available on: ${selectedSetting.availableDays.join(", ")}`);
 setFormData({ ...formData, [name]: "" });
 return;
 }
 }
 }
 setFormData({
 ...formData,
 [name]: value
 });
 } else {
 setFormData({
 ...formData,
 [name]: value
 });
 }
 };

 // Calculate dynamic total including material charge
 const selectedPoojaSetting = poojaSettings.find(p => p.poojaName === formData.service);
 const materialCharge = formData.materialsProvidedByTemple && selectedPoojaSetting?.requiredMaterials
 ? selectedPoojaSetting.requiredMaterials.reduce((sum, item) => sum + (item.charge || 0), 0)
 : 0;
 const totalAmount = (formData.amount || 0) + materialCharge;

 const handlePoojaCardClick = (serviceName) => {
 setFormData({
 ...formData,
 service: serviceName,
 amount: poojaPrices[serviceName]
 });
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 setLoading(true);

 try {
 const token = localStorage.getItem("token");
 const payload = {
 ...formData,
 amount: totalAmount, // Submit total amount
 materialCharge: materialCharge
 };

 await axios.post(
 "http://localhost:5000/api/pooja/book", 
 payload,
 { headers: { Authorization: `Bearer ${token}` } }
 );
 
 toast.success("Pooja booked successfully");
 
 setFormData({
 customerName: "",
 service: "Abhisheka",
 bookingDate: "",
 amount: poojaPrices["Abhisheka"],
 paymentMethod: "UPI",
 contactNumber: "",
 notes: "",
 materialsProvidedByTemple: false
 });
 } catch (error) {
 console.error(error);
 toast.error(error.response?.data?.message || "Failed to book pooja");
 } finally {
 setLoading(false);
 }
 };

 return (
 <div className="w-full bg-[#FCF8F2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 min-h-screen p-6 font-sans text-gray-800">
 <div className="max-w-7xl mx-auto">
 <h1 className="text-[28px] font-bold text-[#3A1F1D] mb-1">Book Pooja</h1>
 <p className="text-[13px] text-gray-600 mb-8">
 Choose a service and book your next pooja online. Your new booking will appear under My Bookings.
 </p>

 <div className="flex flex-col lg:flex-row gap-6">
 
 {/* LEFT PANEL - BOOKING FORM */}
 <div className="w-full lg:w-[60%] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-[20px] shadow-sm p-8 pb-10">
 <form onSubmit={handleSubmit} className="space-y-6">
 
 {/* CUSTOMER NAME */}
 <div>
 <label className="block text-[11px] font-bold text-[#b88c6b] uppercase tracking-wider mb-2">Customer Name</label>
 <input
 type="text"
 name="customerName"
 value={formData.customerName}
 onChange={handleChange}
 required
 placeholder="Enter devotee name"
 className="w-full pb-2 bg-transparent border-b border-gray-200 text-[14px] text-gray-800 focus:outline-none focus:border-[#b88c6b] placeholder-gray-400"
 />
 </div>

 {/* SERVICE */}
 <div>
 <label className="block text-[11px] font-bold text-[#b88c6b] uppercase tracking-wider mb-2">Service</label>
 <div className="relative">
 <select
 name="service"
 value={formData.service}
 onChange={handleChange}
 required
 className="w-full pb-2 bg-transparent border-b border-gray-200 text-[14px] text-gray-800 focus:outline-none focus:border-[#b88c6b] appearance-none"
 >
 <option value="" disabled>Select Pooja Service</option>
 {popularPoojas.map((pooja) => (
 <option key={pooja.name} value={pooja.name}>{pooja.name}</option>
 ))}
 </select>
 <div className="absolute right-0 top-1 pointer-events-none text-gray-500">
 <FaChevronDown size={12} />
 </div>
 </div>
 </div>

 {/* DATE */}
 <div>
 <label className="block text-[11px] font-bold text-[#b88c6b] uppercase tracking-wider mb-2">Date</label>
 <div className="relative">
 <input
 type="date"
 name="bookingDate"
 value={formData.bookingDate}
 onChange={handleChange}
 required
 className="w-full pb-2 bg-transparent border-b border-gray-200 text-[14px] text-gray-800 focus:outline-none focus:border-[#b88c6b]"
 />
 </div>
 </div>

 {/* AMOUNT */}
 <div>
 <label className="block text-[11px] font-bold text-[#b88c6b] uppercase tracking-wider mb-2">Base Amount</label>
 <input
 type="number"
 name="amount"
 value={formData.amount}
 readOnly
 className="w-full pb-2 bg-transparent border-b border-gray-200 text-[14px] text-gray-800 focus:outline-none"
 />
 </div>

 {/* MATERIALS PROVIDED BY TEMPLE */}
 <div className="flex items-center gap-3 mt-4">
 <input
 type="checkbox"
 id="materialsProvidedByTemple"
 name="materialsProvidedByTemple"
 checked={formData.materialsProvidedByTemple}
 onChange={handleChange}
 className="w-4 h-4 text-[#1F7A68] rounded focus:ring-[#1F7A68]"
 />
 <label htmlFor="materialsProvidedByTemple" className="text-[13px] text-gray-700">
 Include Temple Materials 
 {selectedPoojaSetting && (
 <span className="text-[#b88c6b] font-semibold ml-1">
 (+ ₹ {selectedPoojaSetting.requiredMaterials.reduce((sum, item) => sum + (item.charge || 0), 0)})
 </span>
 )}
 </label>
 </div>

 {/* PAYMENT METHOD */}
 <div>
 <label className="block text-[11px] font-bold text-[#b88c6b] uppercase tracking-wider mb-2">Payment Method</label>
 <div className="relative">
 <select
 name="paymentMethod"
 value={formData.paymentMethod}
 onChange={handleChange}
 required
 className="w-full pb-2 bg-transparent border-b border-gray-200 text-[14px] text-gray-800 focus:outline-none focus:border-[#b88c6b] appearance-none"
 >
 <option value="UPI">UPI</option>
 <option value="Cash">Cash</option>
 <option value="Card">Card</option>
 </select>
 <div className="absolute right-0 top-1 pointer-events-none text-gray-500">
 <FaChevronDown size={12} />
 </div>
 </div>
 </div>

 {/* CONTACT NUMBER */}
 <div>
 <label className="block text-[11px] font-bold text-[#b88c6b] uppercase tracking-wider mb-2">Contact Number</label>
 <input
 type="tel"
 name="contactNumber"
 value={formData.contactNumber}
 onChange={handleChange}
 required
 placeholder="Optional phone number"
 className="w-full pb-2 bg-transparent border-b border-gray-200 text-[14px] text-gray-800 focus:outline-none focus:border-[#b88c6b] placeholder-gray-400"
 />
 </div>

 {/* NOTES */}
 <div>
 <label className="block text-[11px] font-bold text-[#b88c6b] uppercase tracking-wider mb-2">Notes</label>
 <div className="relative">
 <textarea
 name="notes"
 value={formData.notes}
 onChange={handleChange}
 rows="1"
 placeholder="Any special requests"
 className="w-full pb-2 bg-transparent border-b border-gray-200 text-[14px] text-gray-800 focus:outline-none focus:border-[#b88c6b] placeholder-gray-400 resize-none overflow-hidden"
 ></textarea>
 <div className="absolute right-0 bottom-2 text-gray-400 pointer-events-none">
 <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="21" y1="21" x2="15" y2="15"></line><line x1="21" y1="15" x2="15" y2="21"></line></svg>
 </div>
 </div>
 </div>

 {/* SUBMIT BUTTON */}
 <div className="pt-6">
 <button
 type="submit"
 disabled={loading}
 className="w-full py-3.5 bg-[#1F7A68] hover:bg-[#186253] text-white font-medium text-[14px] rounded-lg transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
 >
 {loading ? "Booking..." : "Book Pooja"}
 </button>
 </div>
 </form>
 </div>

 {/* RIGHT PANEL - POPULAR POOJAS */}
 <div className="w-full lg:w-[40%] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-[20px] shadow-sm p-8">
 <h2 className="text-[18px] font-bold text-[#3A1F1D] mb-2">Popular Pooja services</h2>
 <p className="text-[12px] text-gray-500 mb-6 leading-relaxed">
 Select a service to book and check your newest booking immediately in My Bookings.
 </p>

 <div className="space-y-3 mb-8">
 {popularPoojas.map((pooja) => (
 <div 
 key={pooja.name}
 onClick={() => handlePoojaCardClick(pooja.name)}
 className={`cursor-pointer px-4 py-3 rounded-full border transition-all flex justify-between items-center text-[13px] font-medium ${
 formData.service === pooja.name 
 ? "border-[#D19C74] bg-[#FDF8F5] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#3A1F1D]" 
 : "border-gray-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-gray-600 hover:border-gray-300"
 }`}
 >
 <span>{pooja.name}</span>
 <span className={formData.service === pooja.name ? "text-[#3A1F1D] font-bold" : "text-gray-500"}>
 ₹ {pooja.price}
 </span>
 </div>
 ))}
 </div>

 {/* BOOKING SUMMARY */}
 <div className="mt-auto">
 <h3 className="text-[13px] font-bold text-[#3A1F1D] mb-3">Booking summary</h3>
 <div className="space-y-1 text-[12px] text-gray-600">
 <p><span className="font-medium">Service:</span> {formData.service || "Not selected"}</p>
 <p><span className="font-medium">Date:</span> {formData.bookingDate ? new Date(formData.bookingDate).toLocaleDateString() : "Not selected"}</p>
 <p><span className="font-medium">Payment:</span> {formData.paymentMethod || "Not selected"}</p>
 {formData.materialsProvidedByTemple && (
 <p><span className="font-medium text-[#1F7A68]">Material Charge:</span> ₹ {materialCharge}</p>
 )}
 <div className="border-t border-gray-200 my-2 pt-2">
 <p className="text-[14px] font-bold text-[#3A1F1D]">
 <span>Total Amount:</span> ₹ {totalAmount}
 </p>
 </div>
 </div>
 </div>
 
 </div>
 </div>
 </div>
 </div>
 );
};

export default PoojaBookingPage;
