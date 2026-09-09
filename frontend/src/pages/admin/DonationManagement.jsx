import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { getDonationTypes } from "../../services/donationTypeService";
import DonationStats from "../../components/dashboard/donation/DonationStats";
import DonationCharts from "../../components/dashboard/donation/DonationCharts";
import DonationFilters from "../../components/dashboard/donation/DonationFilters";
import DonationTable from "../../components/dashboard/donation/DonationTable";
import RecentDonations from "../../components/dashboard/donation/RecentDonations";
import TopDonors from "../../components/dashboard/donation/TopDonors";

const DonationManagement = () => {
 const navigate = useNavigate();
 const [donations, setDonations] = useState([]);
 const [filteredDonations, setFilteredDonations] = useState([]);
 const [stats, setStats] = useState({});
 const [categories, setCategories] = useState(getDonationTypes());

 const loadCategories = (donationList) => {
 const donationCategories = Array.from(
 new Set(donationList.map((donation) => donation.category).filter(Boolean))
 );
 setCategories(Array.from(new Set([...getDonationTypes(), ...donationCategories])));
 };

 const fetchDonations = async () => {
 try {
 const res = await axios.get("http://localhost:5000/api/donations");
 let donations = Array.isArray(res.data?.donations) ? res.data.donations : [];
 
 // Exclude non-donation categories
 donations = donations.filter((donation) => {
 const cat = donation.category?.toLowerCase() || "";
 if (cat.includes("pooja") || cat.includes("prasada") || cat.includes("room") || cat.includes("abhishekam")) {
 return false;
 }
 return true;
 });

 setDonations(donations);
 setFilteredDonations(donations);
 loadCategories(donations);
 } catch (error) {
 console.error("Unable to load donations:", error);
 }
 };

 const fetchStats = async () => {
 try {
 const res = await axios.get("http://localhost:5000/api/donations/stats");
 setStats(res.data?.stats || {});
 } catch (error) {
 console.error("Unable to load donation stats:", error);
 }
 };

 useEffect(() => {
 fetchDonations();
 fetchStats();
 }, []);

 const handleApplyFilters = ({ searchTerm, category, status }) => {
 const normalizedSearch = searchTerm.trim().toLowerCase();

 const nextFiltered = donations.filter((donation) => {
 const textFields = [donation.donorName, donation.category, donation.status, donation.transactionId, donation._id];
 const matchesSearch =
 !normalizedSearch ||
 textFields.filter(Boolean).some((field) => field.toString().toLowerCase().includes(normalizedSearch));

 const matchesCategory = category === "All Donation Types" || donation.category === category;
 const matchesStatus = status === "All Statuses" || donation.status === status;

 return matchesSearch && matchesCategory && matchesStatus;
 });

 setFilteredDonations(nextFiltered);
 };

 return (
 <div className="space-y-6 mt-5 text-slate-800 dark:text-slate-200 ">
 {/* TEMPLE HERO BANNER */}
 <div className="relative overflow-hidden rounded-[32px] border border-amber-200/60 bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-amber-600/15 p-8 text-[#4a2b0f] dark:text-slate-200 shadow-sm backdrop-blur-md">
 <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
 <div className="max-w-2xl">
 <p className="text-xs uppercase tracking-[0.32em] font-extrabold text-[#7a4918]">Donation Command Center</p>
 <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-[#4a2b0f] dark:text-slate-200 ">Admin Donation Overview</h1>
 <p className="mt-2 text-[#7a4918] font-medium text-base">
 High-level donation intelligence and financial tracking for Sri Shanti Mahadev Mandir: Category Performance, Donor Health, Verification Workflows and Governance.
 </p>
 </div>
 <div className="grid gap-3 sm:grid-cols-1">
 <button
 onClick={() => navigate("/admin/donations/reports")}
 className="rounded-2xl bg-amber-600 px-6 py-3 font-bold text-white shadow-md transition hover:bg-amber-700 hover:scale-105"
 >
 View Reports
 </button>
 </div>
 </div>
 </div>

 <DonationStats stats={stats} />

 <div className="grid gap-6 lg:grid-cols-[1.45fr_0.95fr]">
 <DonationCharts donations={filteredDonations} />

 <div className="grid gap-6">
 <DonationFilters categories={categories} onApplyFilters={handleApplyFilters} />

 <div className="rounded-[32px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-md backdrop-blur-lg">
 <p className="text-xs uppercase tracking-[0.28em] font-extrabold text-amber-700">Donation Types</p>
 <h2 className="mt-2 text-2xl font-black text-slate-800 dark:text-slate-200 ">Manage Donation Categories</h2>
 <p className="mt-2 text-slate-600 dark:text-slate-200 text-sm font-semibold">
 Admin-defined donation types are stored centrally and reflected across Add Donation, filters, reports and tables.
 </p>
 <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
 <button
 onClick={() => navigate("/admin/donations/settings")}
 className="rounded-2xl bg-amber-600 px-5 py-3 font-extrabold text-white shadow-md transition hover:bg-amber-700 hover:scale-105"
 >
 Manage Donation Types
 </button>
 <span className="inline-flex items-center rounded-2xl border border-amber-300 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-sm font-bold text-amber-900">
 {categories.length} donation types available
 </span>
 </div>
 </div>
 </div>
 </div>

 <DonationTable donations={filteredDonations} onRefresh={fetchDonations} />

 <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
 <RecentDonations donations={filteredDonations} />
 <TopDonors donations={filteredDonations} />
 </div>
 </div>
 );
};

export default DonationManagement;
