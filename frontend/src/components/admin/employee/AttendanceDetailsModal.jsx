import React from "react";
import { FiX, FiMapPin, FiCamera, FiSmartphone, FiGlobe } from "react-icons/fi";

const AttendanceDetailsModal = ({ record, onClose }) => {
 if (!record) return null;

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
 <div className="w-full max-w-2xl rounded-3xl bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-2xl relative">
 <button
 onClick={onClose}
 className="absolute top-6 right-6 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-500 hover:bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 hover:text-slate-700 transition"
 >
 <FiX />
 </button>

 <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-200 mb-6">Attendance Verification Details</h2>
 
 <div className="grid gap-6 md:grid-cols-2">
 {/* Photos */}
 <div className="space-y-4">
 <h3 className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2"><FiCamera /> Verification Photos</h3>
 <div className="grid grid-cols-2 gap-4">
 <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-2 text-center">
 <p className="text-xs font-semibold text-slate-500 mb-2">Check In Photo</p>
 {record.checkInPhoto ? (
 <img src={record.checkInPhoto} alt="Check In" className="h-32 w-full object-cover rounded-lg" />
 ) : (
 <div className="h-32 w-full flex items-center justify-center bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded-lg text-slate-400 text-sm">No Photo</div>
 )}
 </div>
 <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-2 text-center">
 <p className="text-xs font-semibold text-slate-500 mb-2">Check Out Photo</p>
 {record.checkOutPhoto ? (
 <img src={record.checkOutPhoto} alt="Check Out" className="h-32 w-full object-cover rounded-lg" />
 ) : (
 <div className="h-32 w-full flex items-center justify-center bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded-lg text-slate-400 text-sm">No Photo</div>
 )}
 </div>
 </div>
 {record.faceVerified ? (
 <span className="inline-flex rounded-full bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1 text-xs font-semibold text-emerald-700">Face Match Verified</span>
 ) : (
 <span className="inline-flex rounded-full bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1 text-xs font-semibold text-rose-700">Face Not Verified</span>
 )}
 </div>

 {/* Location & Device Info */}
 <div className="space-y-4">
 <h3 className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2"><FiMapPin /> Location & Device</h3>
 
 <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 space-y-3 text-sm text-slate-600">
 <div className="flex justify-between">
 <span className="font-semibold text-slate-500 flex items-center gap-1.5"><FiMapPin /> GPS Location</span>
 <span>{record.latitude && record.longitude ? `${record.latitude.toFixed(5)}, ${record.longitude.toFixed(5)}` : "Not Available"}</span>
 </div>
 <div className="flex justify-between">
 <span className="font-semibold text-slate-500">Distance from Temple</span>
 <span>{record.distanceFromTemple ? `${Math.round(record.distanceFromTemple)} meters` : "N/A"}</span>
 </div>
 <div className="flex justify-between">
 <span className="font-semibold text-slate-500">Location Status</span>
 {record.locationVerified ? (
 <span className="text-emerald-600 font-semibold">Verified in Premises</span>
 ) : (
 <span className="text-rose-600 font-semibold">Outside Premises / N/A</span>
 )}
 </div>
 </div>

 <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 space-y-3 text-sm text-slate-600">
 <div className="flex justify-between">
 <span className="font-semibold text-slate-500 flex items-center gap-1.5"><FiSmartphone /> Device Info</span>
 <span className="truncate max-w-[120px] text-right" title={record.deviceInfo}>{record.deviceInfo || "Unknown"}</span>
 </div>
 <div className="flex justify-between">
 <span className="font-semibold text-slate-500 flex items-center gap-1.5"><FiGlobe /> Browser / IP</span>
 <span className="truncate max-w-[120px] text-right" title={`${record.browser} - ${record.ipAddress}`}>{record.browser || "Unknown"}</span>
 </div>
 </div>
 </div>
 </div>
 
 <div className="mt-8 flex justify-end">
 <button
 onClick={onClose}
 className="rounded-full bg-slate-900 px-6 py-2.5 font-semibold text-white transition hover:bg-slate-800"
 >
 Close
 </button>
 </div>
 </div>
 </div>
 );
};

export default AttendanceDetailsModal;
