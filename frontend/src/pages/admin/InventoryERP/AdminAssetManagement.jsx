// Admin Asset Management Component
import React, { useState, useEffect } from "react";
import axios from "axios";
import { QRCodeCanvas } from "qrcode.react";

const AdminAssetManagement = () => {
 const [activeTab, setActiveTab] = useState("Assets");
 const [assets, setAssets] = useState([]);
 const [loading, setLoading] = useState(false);
 const [showQRModal, setShowQRModal] = useState(null);

 const tabs = ["Assets", "Maintenance", "Repairs", "Service History", "Warranty", "Scrapped"];

 useEffect(() => {
 if (activeTab === "Assets") {
 fetchAssets();
 }
 }, [activeTab]);

 const fetchAssets = async () => {
 setLoading(true);
 try {
 const token = localStorage.getItem("token");
 const res = await axios.get("http://localhost:5000/api/admin/inventory-assets", {
 headers: { Authorization: `Bearer ${token}` }
 });
 if (res.data.success) {
 setAssets(res.data.assets);
 }
 } catch (error) {
 console.error("Failed to fetch assets", error);
 } finally {
 setLoading(false);
 }
 };

 const printQR = (assetId) => {
 const canvas = document.getElementById(`qr-code-${assetId}`);
 if (!canvas) return;
 
 const image = canvas.toDataURL("image/png");
 const printWindow = window.open("", "_blank");
 printWindow.document.write(`
 <html>
 <head>
 <title>Print QR Code</title>
 <style>
 body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; font-family: sans-serif; }
 img { max-width: 300px; }
 h2 { margin-top: 20px; }
 </style>
 </head>
 <body>
 <img src="${image}" />
 <h2>Asset ID: ${assetId}</h2>
 <script>
 window.onload = () => { window.print(); window.close(); }
 </script>
 </body>
 </html>
 `);
 printWindow.document.close();
 };

 const renderAssetsTab = () => {
 if (loading) return <div className="p-8 text-center text-slate-500 dark:text-slate-200 ">Loading assets...</div>;

 return (
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
 {assets.map((asset) => {
 const qrUrl = `${window.location.origin}/admin/assets/scan/${asset.assetId}`;
 return (
 <div key={asset._id} className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow p-6 relative overflow-hidden group">
 <div className="flex justify-between items-start mb-4">
 <div>
 <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200 ">{asset.name}</h3>
 <p className="text-xs font-medium text-slate-500 dark:text-slate-200 uppercase tracking-wider">{asset.category}</p>
 </div>
 <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${ asset.status === 'Active' ? 'bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-700' : asset.status === 'Under Repair' ? 'bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-700' : 'bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 ' }`}>
 {asset.status}
 </span>
 </div>
 
 <div className="space-y-2 text-sm text-slate-600 dark:text-slate-200 mb-6">
 <p><span className="font-medium text-slate-700 dark:text-slate-200 ">Asset ID:</span> {asset.assetId}</p>
 <p><span className="font-medium text-slate-700 dark:text-slate-200 ">Location:</span> {asset.assignedLocation}</p>
 {asset.purchaseDate && <p><span className="font-medium text-slate-700 dark:text-slate-200 ">Purchased:</span> {new Date(asset.purchaseDate).toLocaleDateString()}</p>}
 </div>

 <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
 <button 
 onClick={() => setShowQRModal(asset)}
 className="text-[#ff8b00] hover:text-[#e67d00] font-medium text-sm flex items-center transition-colors"
 >
 <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"></path></svg>
 View QR
 </button>
 </div>
 </div>
 );
 })}

 {assets.length === 0 && !loading && (
 <div className="col-span-full py-12 text-center text-slate-500 dark:text-slate-200 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded-xl border border-dashed border-slate-300 dark:border-slate-700 ">
 No assets found. Create one to get started.
 </div>
 )}

 {/* QR Modal */}
 {showQRModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded-2xl shadow-xl max-w-sm w-full overflow-hidden transform transition-all">
 <div className="p-6 text-center">
 <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">{showQRModal.name}</h3>
 <p className="text-sm text-slate-500 dark:text-slate-200 mb-6">Asset ID: {showQRModal.assetId}</p>
 
 <div className="flex justify-center mb-6 p-4 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded-xl border border-slate-100 shadow-sm inline-block">
 <QRCodeCanvas 
 id={`qr-code-${showQRModal.assetId}`}
 value={`${window.location.origin}/admin/assets/scan/${showQRModal.assetId}`} 
 size={200}
 level="H"
 includeMargin={true}
 />
 </div>

 <div className="flex space-x-3">
 <button 
 onClick={() => printQR(showQRModal.assetId)}
 className="flex-1 bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] hover:bg-[#e67d00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-white py-2.5 rounded-lg font-medium transition-colors"
 >
 Print QR
 </button>
 <button 
 onClick={() => setShowQRModal(null)}
 className="flex-1 bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] hover:bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 py-2.5 rounded-lg font-medium transition-colors"
 >
 Close
 </button>
 </div>
 </div>
 </div>
 </div>
 )}
 </div>
 );
 };

 return (
 <div className="p-4 md:p-8 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] min-h-screen">
 <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
 <div>
 <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">Asset Management</h1>
 <p className="text-sm text-slate-500 dark:text-slate-200 mt-1">Manage temple assets, maintenance, and generate QR codes.</p>
 <div className="mt-3 h-1 w-16 rounded-full bg-gradient-to-r from-[#ff8b00] to-[#ffaf4d]" />
 </div>
 </div>
 
 {/* Tabs */}
 <div className="flex space-x-2 border-b border-slate-200 dark:border-slate-700 mb-8 overflow-x-auto pb-px">
 {tabs.map((tab) => (
 <button
 key={tab}
 onClick={() => setActiveTab(tab)}
 className={`px-5 py-2.5 text-sm font-medium rounded-t-xl transition-all whitespace-nowrap ${ activeTab === tab ? "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#ff8b00] border-t border-l border-r border-slate-200 dark:border-slate-700 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] translate-y-px" : "text-slate-500 dark:text-slate-200 hover:text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " }`}
 >
 {tab}
 </button>
 ))}
 </div>

 <div className="min-h-[400px]">
 {activeTab === "Assets" ? renderAssetsTab() : (
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded-2xl border border-slate-200 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-200 shadow-sm flex items-center justify-center h-64">
 {activeTab} module under development.
 </div>
 )}
 </div>
 </div>
 );
};

export default AdminAssetManagement;
