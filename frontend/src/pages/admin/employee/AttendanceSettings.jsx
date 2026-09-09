import { useEffect, useState } from "react";
import axios from "axios";
import { FiSave, FiEdit2, FiTrash2, FiPlus } from "react-icons/fi";
import SectionCard from "../../../components/admin/employee/SectionCard";
import { getStoredToken } from "../../../services/authService";

const AttendanceSettings = () => {
 const [settings, setSettings] = useState({
 lateThreshold: 15,
 earlyCheckInWindow: 30,
 });
 const [locations, setLocations] = useState([]);
 
 const [editingLocation, setEditingLocation] = useState(null);
 const [locationForm, setLocationForm] = useState({
 locationName: "",
 latitude: 0,
 longitude: 0,
 allowedRadius: 50
 });

 const [loading, setLoading] = useState(true);
 const [message, setMessage] = useState("");

 const fetchSettingsAndLocations = async () => {
 try {
 const token = getStoredToken();
 
 const [settingsRes, locationsRes] = await Promise.all([
 axios.get("http://localhost:5000/api/attendance/settings", { headers: { Authorization: `Bearer ${token}` } }),
 axios.get("http://localhost:5000/api/attendance-locations", { headers: { Authorization: `Bearer ${token}` } })
 ]);
 
 if (settingsRes.data.success && settingsRes.data.settings) {
 setSettings({
 lateThreshold: settingsRes.data.settings.lateThreshold || 15,
 earlyCheckInWindow: settingsRes.data.settings.earlyCheckInWindow || 30
 });
 }
 if (locationsRes.data.success) {
 setLocations(locationsRes.data.locations);
 }
 } catch (error) {
 console.error(error);
 setMessage("Failed to load settings or locations.");
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchSettingsAndLocations();
 }, []);

 const handleSettingsChange = (e) => {
 setSettings({ ...settings, [e.target.name]: Number(e.target.value) });
 };

 const handleLocationChange = (e) => {
 const value = e.target.type === "number" ? Number(e.target.value) : e.target.value;
 setLocationForm({ ...locationForm, [e.target.name]: value });
 };

 const handleSaveSettings = async () => {
 setMessage("Saving global settings...");
 try {
 const token = getStoredToken();
 // Only updating time thresholds for global settings
 const res = await axios.post("http://localhost:5000/api/attendance/settings", settings, {
 headers: { Authorization: `Bearer ${token}` }
 });
 if (res.data.success) {
 setMessage("Settings saved successfully.");
 }
 } catch (error) {
 console.error(error);
 setMessage("Failed to save settings.");
 }
 };
 
 const handleSaveLocation = async (e) => {
 e.preventDefault();
 setMessage("Saving location...");
 try {
 const token = getStoredToken();
 if (editingLocation) {
 await axios.put(`http://localhost:5000/api/attendance-locations/${editingLocation}`, locationForm, {
 headers: { Authorization: `Bearer ${token}` }
 });
 setMessage("Location updated.");
 } else {
 await axios.post("http://localhost:5000/api/attendance-locations", locationForm, {
 headers: { Authorization: `Bearer ${token}` }
 });
 setMessage("Location created.");
 }
 setEditingLocation(null);
 setLocationForm({ locationName: "", latitude: 0, longitude: 0, allowedRadius: 50 });
 fetchSettingsAndLocations();
 } catch (error) {
 console.error(error);
 setMessage("Failed to save location.");
 }
 };
 
 const handleEditLocation = (loc) => {
 setEditingLocation(loc._id);
 setLocationForm({
 locationName: loc.locationName,
 latitude: loc.latitude,
 longitude: loc.longitude,
 allowedRadius: loc.allowedRadius
 });
 };
 
 const handleDeleteLocation = async (id) => {
 if (!window.confirm("Are you sure you want to delete this location?")) return;
 try {
 const token = getStoredToken();
 await axios.delete(`http://localhost:5000/api/attendance-locations/${id}`, {
 headers: { Authorization: `Bearer ${token}` }
 });
 setMessage("Location deleted.");
 fetchSettingsAndLocations();
 } catch (error) {
 console.error(error);
 setMessage("Failed to delete location.");
 }
 };
 
 const handleCancelEdit = () => {
 setEditingLocation(null);
 setLocationForm({ locationName: "", latitude: 0, longitude: 0, allowedRadius: 50 });
 };

 if (loading) return <div>Loading settings...</div>;

 return (
 <div className="space-y-6">
 <div className="flex items-center justify-between">
 <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 ">Attendance Settings</h1>
 <button onClick={handleSaveSettings} className="flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 font-semibold text-white transition hover:bg-slate-800">
 <FiSave /> Save Time Settings
 </button>
 </div>
 {message && <p className="font-semibold text-slate-700 dark:text-slate-200 p-3 bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-blue-700 rounded-xl">{message}</p>}

 <SectionCard title="Time Thresholds" subtitle="Configure late arrival and early check-in windows.">
 <div className="grid gap-6 md:grid-cols-2">
 <div>
 <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200 ">Late Threshold (minutes)</label>
 <input type="number" name="lateThreshold" value={settings.lateThreshold} onChange={handleSettingsChange} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 focus:bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " />
 </div>
 <div>
 <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200 ">Early Check-in Window (minutes)</label>
 <input type="number" name="earlyCheckInWindow" value={settings.earlyCheckInWindow} onChange={handleSettingsChange} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 focus:bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " />
 </div>
 </div>
 </SectionCard>
 
 <SectionCard title="Attendance Locations" subtitle="Manage specific GPS coordinates for employee assignments.">
 <div className="grid md:grid-cols-[1fr_2fr] gap-6">
 {/* Form */}
 <div className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 rounded-2xl border border-slate-200 dark:border-slate-700 h-fit">
 <h3 className="font-bold text-slate-800 dark:text-slate-200 mb-4">{editingLocation ? "Edit Location" : "Add New Location"}</h3>
 <form onSubmit={handleSaveLocation} className="space-y-4">
 <div>
 <div className="flex items-center justify-between mb-1">
 <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 ">Location Name</label>
 <button 
 type="button" 
 onClick={() => {
 if (navigator.geolocation) {
 navigator.geolocation.getCurrentPosition(
 (position) => {
 setLocationForm(prev => ({
 ...prev,
 latitude: position.coords.latitude,
 longitude: position.coords.longitude
 }));
 setMessage("Current location coordinates fetched!");
 },
 (err) => {
 alert("Failed to fetch location. Please allow location permissions in your browser.");
 }
 );
 } else {
 alert("Geolocation is not supported by your browser.");
 }
 }}
 className="text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-1 rounded-md transition"
 >
 📍 Use My Current Location
 </button>
 </div>
 <input required type="text" name="locationName" value={locationForm.locationName} onChange={handleLocationChange} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-2 outline-none focus:border-amber-400" placeholder="e.g. Main Temple" />
 </div>
 <div>
 <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200 ">Latitude</label>
 <input required type="number" step="any" name="latitude" value={locationForm.latitude} onChange={handleLocationChange} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-2 outline-none focus:border-amber-400" />
 </div>
 <div>
 <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200 ">Longitude</label>
 <input required type="number" step="any" name="longitude" value={locationForm.longitude} onChange={handleLocationChange} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-2 outline-none focus:border-amber-400" />
 </div>
 <div>
 <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200 ">Allowed Radius (meters)</label>
 <input required type="number" name="allowedRadius" value={locationForm.allowedRadius} onChange={handleLocationChange} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-2 outline-none focus:border-amber-400" />
 </div>
 
 <div className="flex gap-2 pt-2">
 <button type="submit" className="flex-1 bg-emerald-600 text-white py-2 rounded-xl font-semibold hover:bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition">
 {editingLocation ? "Update" : "Create"}
 </button>
 {editingLocation && (
 <button type="button" onClick={handleCancelEdit} className="flex-1 bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 py-2 rounded-xl font-semibold hover:bg-slate-300 transition">
 Cancel
 </button>
 )}
 </div>
 </form>
 </div>
 
 {/* List */}
 <div>
 <div className="space-y-3">
 {locations.length === 0 ? (
 <p className="text-slate-500 dark:text-slate-200 text-sm">No attendance locations found. Add one to assign to employees.</p>
 ) : (
 locations.map(loc => (
 <div key={loc._id} className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 p-4 rounded-xl flex items-center justify-between hover:shadow-md transition">
 <div>
 <h4 className="font-bold text-slate-900 dark:text-slate-200 ">{loc.locationName}</h4>
 <p className="text-xs text-slate-500 dark:text-slate-200 mt-0.5">Lat: {loc.latitude} | Lng: {loc.longitude}</p>
 <p className="text-xs text-slate-500 dark:text-slate-200 mt-0.5">Radius: {loc.allowedRadius}m</p>
 </div>
 <div className="flex items-center gap-2">
 <button onClick={() => handleEditLocation(loc)} className="p-2 text-blue-600 hover:bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-lg transition">
 <FiEdit2 />
 </button>
 <button onClick={() => handleDeleteLocation(loc._id)} className="p-2 text-rose-600 hover:bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-lg transition">
 <FiTrash2 />
 </button>
 </div>
 </div>
 ))
 )}
 </div>
 </div>
 </div>
 </SectionCard>
 </div>
 );
};

export default AttendanceSettings;
