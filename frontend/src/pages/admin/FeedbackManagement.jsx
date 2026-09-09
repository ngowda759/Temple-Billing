import React, { useEffect, useMemo, useState } from "react";
import { FaReply, FaCheckCircle, FaClock, FaCommentAlt, FaTimes, FaPaperPlane } from "react-icons/fa";
import { getSupportRequests, replySupportRequest } from "../../services/devoteeService";

const FeedbackManagement = () => {
 const [supportRequests, setSupportRequests] = useState([]);
 const [replyTexts, setReplyTexts] = useState({});
 const [replyingId, setReplyingId] = useState(null);
 const [savingId, setSavingId] = useState(null);
 const [statusMessage, setStatusMessage] = useState("");
 const [activeTab, setActiveTab] = useState("All");

 useEffect(() => {
 const load = async () => {
 try {
 const res = await getSupportRequests();
 setSupportRequests(res.requests || []);
 } catch (error) {
 console.warn("Unable to load feedback requests", error);
 }
 };
 load();
 }, []);

 const handleReplyChange = (id, value) => {
 setReplyTexts((prev) => ({ ...prev, [id]: value }));
 };

 const handleSendReply = async (id) => {
 const reply = (replyTexts[id] || "").trim();
 if (!reply) return;
 setSavingId(id);
 try {
 await replySupportRequest(id, { reply, status: "Closed" });
 const res = await getSupportRequests();
 setSupportRequests(res.requests || []);
 setReplyTexts((prev) => ({ ...prev, [id]: "" }));
 setReplyingId(null);
 setStatusMessage("Reply sent successfully to devotee.");
 } catch (error) {
 console.warn("Unable to send reply", error);
 setStatusMessage("Unable to send reply. Please try again.");
 } finally {
 setSavingId(null);
 setTimeout(() => setStatusMessage(""), 4000);
 }
 };

 const filteredRequests = useMemo(() => {
 if (activeTab === "Pending") {
 return supportRequests.filter((r) => r.status !== "Closed" && !r.reply);
 }
 if (activeTab === "Closed") {
 return supportRequests.filter((r) => r.status === "Closed" || r.reply);
 }
 return supportRequests;
 }, [supportRequests, activeTab]);

 const pendingCount = useMemo(
 () => supportRequests.filter((r) => r.status !== "Closed" && !r.reply).length,
 [supportRequests]
 );
 const closedCount = useMemo(
 () => supportRequests.filter((r) => r.status === "Closed" || r.reply).length,
 [supportRequests]
 );

 return (
 <div className="mt-5 space-y-6 text-slate-800 dark:text-slate-200 ">
 {/* HERO BANNER */}
 <div className="relative overflow-hidden rounded-[32px] border border-amber-200/60 bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-amber-600/15 p-8 shadow-md backdrop-blur-md">
 <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
 <div>
 <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.3em] text-amber-800">
 <FaCommentAlt size={16} /> Devotee Communication
 </div>
 <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-[#4a2b0f] dark:text-slate-200 ">
 Feedback & Complaints
 </h1>
 <p className="mt-2 text-[#7a4918] font-medium text-base max-w-2xl">
 Review devotee inquiries, grievances, and feedback for Sri Shanti Mahadev Mandir. Click reply to expand the response form.
 </p>
 </div>

 <div className="flex items-center gap-3">
 <span className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-xs font-black text-amber-900 shadow-xs">
 {pendingCount} Pending Response
 </span>
 </div>
 </div>
 </div>

 {/* STAT CARDS & TABS */}
 <div className="grid gap-4 sm:grid-cols-3">
 <div 
 onClick={() => setActiveTab("All")}
 className={`cursor-pointer rounded-2xl border p-5 transition shadow-xs ${activeTab === "All" ? "border-amber-500 bg-amber-100/90 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ring-2 ring-amber-400/30" : "border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] hover:bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "}`}
 >
 <p className="text-xs font-extrabold uppercase text-slate-500 dark:text-slate-200 ">Total Requests</p>
 <p className="mt-2 text-3xl font-black text-slate-900 dark:text-slate-200 ">{supportRequests.length}</p>
 </div>
 <div 
 onClick={() => setActiveTab("Pending")}
 className={`cursor-pointer rounded-2xl border p-5 transition shadow-xs ${activeTab === "Pending" ? "border-amber-500 bg-amber-100/90 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ring-2 ring-amber-400/30" : "border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] hover:bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "}`}
 >
 <p className="text-xs font-extrabold uppercase text-amber-800 flex items-center gap-1.5">
 <FaClock className="text-amber-600" /> Pending Reply
 </p>
 <p className="mt-2 text-3xl font-black text-amber-700">{pendingCount}</p>
 </div>
 <div 
 onClick={() => setActiveTab("Closed")}
 className={`cursor-pointer rounded-2xl border p-5 transition shadow-xs ${activeTab === "Closed" ? "border-amber-500 bg-amber-100/90 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ring-2 ring-amber-400/30" : "border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] hover:bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "}`}
 >
 <p className="text-xs font-extrabold uppercase text-emerald-800 flex items-center gap-1.5">
 <FaCheckCircle className="text-emerald-600" /> Replied & Closed
 </p>
 <p className="mt-2 text-3xl font-black text-emerald-700">{closedCount}</p>
 </div>
 </div>

 {statusMessage && (
 <div className="rounded-2xl border border-emerald-300 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-5 py-3 text-sm font-extrabold text-emerald-900 shadow-xs flex items-center gap-2">
 <FaCheckCircle className="text-emerald-600" /> {statusMessage}
 </div>
 )}

 {/* FEEDBACK LIST GRID */}
 <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
 <div className="rounded-[32px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-md">
 <div className="flex items-center justify-between mb-5">
 <div>
 <h2 className="text-2xl font-black text-slate-800 dark:text-slate-200 ">Devotee Feedback Log</h2>
 <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-200 ">Showing {filteredRequests.length} feedback items ({activeTab}).</p>
 </div>
 <div className="flex gap-2">
 {["All", "Pending", "Closed"].map((tab) => (
 <button
 key={tab}
 onClick={() => setActiveTab(tab)}
 className={`rounded-xl px-3.5 py-1.5 text-xs font-extrabold transition ${ activeTab === tab ? "bg-amber-600 text-white shadow-xs" : "bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " }`}
 >
 {tab}
 </button>
 ))}
 </div>
 </div>

 <div className="space-y-4">
 {filteredRequests.length > 0 ? (
 filteredRequests.map((request) => {
 const isClosed = request.status === "Closed" || Boolean(request.reply);
 const isReplyingThis = replyingId === request._id;

 return (
 <div 
 key={request._id} 
 className={`rounded-2xl border p-5 transition shadow-xs ${ isClosed ? "border-emerald-200 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " : isReplyingThis ? "border-amber-400 bg-amber-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ring-2 ring-amber-400/20" : "border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] hover:border-amber-300" }`}
 >
 {/* CARD HEADER */}
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <p className="text-lg font-extrabold text-slate-900 dark:text-slate-200 ">{request.subject || "Devotee Query / Feedback"}</p>
 <p className="text-xs font-semibold text-slate-500 dark:text-slate-200 mt-0.5">
 From: <strong className="text-slate-800 dark:text-slate-200 ">{request.name || "Devotee"}</strong> ({request.email || "No email"})
 </p>
 </div>
 <span className={`rounded-lg px-3 py-1 text-xs font-black border ${ isClosed ? "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-800 border-emerald-300" : "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-900 border-amber-300" }`}>
 {isClosed ? "✓ Closed & Replied" : "⏰ Open Request"}
 </span>
 </div>

 {/* MESSAGE BODY */}
 <div className="mt-3 p-3.5 rounded-xl bg-amber-50/40 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-amber-100 text-sm text-slate-700 dark:text-slate-200 font-medium leading-relaxed">
 "{request.message}"
 </div>

 {/* EXISTING REPLY */}
 {request.reply ? (
 <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-sm text-emerald-950">
 <p className="text-xs font-black uppercase text-emerald-800 flex items-center gap-1.5 mb-1">
 <FaCheckCircle className="text-emerald-600" /> Admin Reply Sent:
 </p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 mt-1">{request.reply}</p>
 </div>
 ) : (
 /* REPLY ACTION WORKFLOW */
 <div className="mt-4">
 {!isReplyingThis ? (
 /* CLICK TO REPLY BUTTON */
 <button
 type="button"
 onClick={() => setReplyingId(request._id)}
 className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-extrabold text-white shadow-xs transition hover:bg-amber-700 hover:scale-102"
 >
 <FaReply size={13} /> Reply to Devotee
 </button>
 ) : (
 /* EXPANDED REPLY FORM BOXES */
 <div className="space-y-3 p-4 rounded-2xl border border-amber-300 bg-amber-50/80 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <div className="flex items-center justify-between">
 <p className="text-xs font-black uppercase text-amber-900 flex items-center gap-1.5">
 <FaReply className="text-amber-700" /> Replying to {request.name || "Devotee"}
 </p>
 <button
 type="button"
 onClick={() => setReplyingId(null)}
 className="text-slate-400 hover:text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1"
 >
 <FaTimes /> Close Box
 </button>
 </div>

 <textarea
 rows={4}
 value={replyTexts[request._id] || ""}
 onChange={(e) => handleReplyChange(request._id, e.target.value)}
 placeholder={`Type your reply to ${request.name || 'the devotee'} here...`}
 className="w-full rounded-xl border border-amber-300 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-3.5 text-sm font-semibold text-slate-800 dark:text-slate-200 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 shadow-xs"
 />

 <div className="flex items-center gap-3">
 <button
 type="button"
 onClick={() => handleSendReply(request._id)}
 disabled={savingId === request._id || !(replyTexts[request._id] || "").trim()}
 className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-xs font-extrabold text-white shadow-md transition hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
 >
 {savingId === request._id ? (
 "Sending..."
 ) : (
 <>
 <FaPaperPlane size={12} /> Send Reply
 </>
 )}
 </button>
 <button
 type="button"
 onClick={() => setReplyingId(null)}
 className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition"
 >
 Cancel
 </button>
 </div>
 </div>
 )}
 </div>
 )}
 </div>
 );
 })
 ) : (
 <div className="p-8 text-center text-sm font-semibold text-slate-400 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded-2xl border border-slate-200 dark:border-slate-700 ">
 No feedback or complaints match the selected filter.
 </div>
 )}
 </div>
 </div>

 {/* SIDEBAR INSTRUCTIONS */}
 <div className="space-y-4">
 <div className="rounded-[32px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-md">
 <h2 className="text-xl font-black text-slate-800 dark:text-slate-200 mb-3">Feedback Guidelines</h2>
 <ul className="space-y-3 text-xs font-semibold text-slate-600 dark:text-slate-200 ">
 <li className="rounded-xl bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-amber-200/60 p-3.5 shadow-xs">
 💬 <strong>Click Reply:</strong> Click the "Reply to Devotee" button on any open request card to reveal the response input box.
 </li>
 <li className="rounded-xl bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-amber-200/60 p-3.5 shadow-xs">
 ✉️ <strong>Direct Communication:</strong> Submitting a reply closes the feedback ticket and updates the devotee's dashboard instantly.
 </li>
 <li className="rounded-xl bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-amber-200/60 p-3.5 shadow-xs">
 ✅ <strong>Archived Records:</strong> All closed & replied queries remain accessible in the "Closed" tab for audit history.
 </li>
 </ul>
 </div>
 </div>
 </div>
 </div>
 );
};

export default FeedbackManagement;
