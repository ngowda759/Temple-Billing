import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";
import { downloadReceiptPDF } from "../../../utils/receiptGenerator";
import { FaDownload, FaPrint, FaSearch } from "react-icons/fa";

const initialMockReceipts = [
  { id: "R-4391", donor: "Ramesh Kumar", amount: 5000, category: "Annadanam", paymentMethod: "UPI", date: "2026-05-20", phone: "9876543210", email: "ramesh@example.com" },
  { id: "R-4407", donor: "Priya Shetty", amount: 10000, category: "Temple Renovation", paymentMethod: "Card", date: "2026-05-19", phone: "9876543211", email: "priya@example.com" },
  { id: "R-4423", donor: "Suresh Rao", amount: 2500, category: "General Donation", paymentMethod: "Cash", date: "2026-05-18", phone: "9876543212", email: "suresh@example.com" },
];

const DonationReceipts = () => {
  const [donations, setDonations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchDonations = async () => {
    setLoading(true);
    try {
      const res = await axios.get("http://localhost:5000/api/donations");
      const list = Array.isArray(res.data?.donations) ? res.data.donations : [];
      if (list.length > 0) {
        setDonations(list);
      } else {
        setDonations(initialMockReceipts);
      }
    } catch (error) {
      console.error("Unable to load donations:", error);
      setDonations(initialMockReceipts);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDonations();
  }, []);

  const filteredReceipts = useMemo(() => {
    return donations.filter((item) => {
      const dateStr = item.createdAt || item.date;
      const recDate = dateStr ? new Date(dateStr) : null;

      if (fromDate && recDate) {
        const from = new Date(fromDate);
        from.setHours(0, 0, 0, 0);
        if (recDate < from) return false;
      }

      if (toDate && recDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        if (recDate > to) return false;
      }

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const donorName = (item.donorName || item.donor || "").toLowerCase();
        const cat = (item.category || "").toLowerCase();
        const id = (item.id || item._id || "").toLowerCase();
        if (!donorName.includes(q) && !cat.includes(q) && !id.includes(q)) return false;
      }

      return true;
    });
  }, [donations, fromDate, toDate, searchTerm]);

  const handleDownloadReceipt = async (item) => {
    try {
      const refNo = item.id || `DN-${item._id?.slice(-6).toUpperCase()}`;
      const amount = Number(item.amount) || 0;

      const receiptData = {
        isOnline: item.paymentMethod !== "Cash",
        receiptNo: refNo,
        bookingDate: item.createdAt ? new Date(item.createdAt).toLocaleDateString("en-IN") : item.date || "-",
        paymentMode: item.paymentMethod || "Cash",
        transactionId: item.transactionId || "-",
        cashierName: item.cashierName || "Admin",
        devoteeName: item.donorName || item.donor || "Devotee",
        mobile: item.phone || item.donorPhone || "-",
        email: item.email || item.donorEmail || "-",
        address: item.address || "Udupi",
        poojaBookings: [],
        prasadamOrders: [],
        subTotal: amount,
        templeCharges: 0,
        grandTotal: amount,
        amountInWords: `Rupees ${amount} Only`,
        devoteeMaterials: [],
        templeMaterials: [],
        notes: [`Category: ${item.category || "General Donation"}`]
      };

      await downloadReceiptPDF(receiptData, `donation-receipt-${refNo}.pdf`);
    } catch (err) {
      console.error("Receipt generation error:", err);
      alert("Failed to generate receipt PDF.");
    }
  };

  return (
    <DonationPageShell
      title="Donation Receipts"
      subtitle="Filter receipts by Date Range, search records, and download official receipt PDFs."
    >
      <SectionCard title="Filter & Download Receipts" subtitle="Select From/To Date to view and download receipts.">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-300">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-300">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-300">Search Keywords</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search donor name or category..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
        </div>

        {(fromDate || toDate || searchTerm) && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-amber-400 font-semibold">
              Showing {filteredReceipts.length} filtered receipt(s)
            </p>
            <button
              onClick={() => { setFromDate(""); setToDate(""); setSearchTerm(""); }}
              className="text-xs font-bold text-amber-300 hover:underline"
            >
              Reset Filters
            </button>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Receipt Records" subtitle="Click Download PDF to export receipt for any record.">
        <div className="space-y-4">
          {loading ? (
            <p className="text-slate-400 text-center py-6">Loading receipt records...</p>
          ) : filteredReceipts.length > 0 ? (
            filteredReceipts.map((item) => {
              const recId = item.id || `DN-${item._id?.slice(-6).toUpperCase()}`;
              const donorName = item.donorName || item.donor || "Devotee";
              const amt = Number(item.amount) || 0;
              const formattedDate = item.createdAt ? new Date(item.createdAt).toLocaleDateString("en-IN") : item.date || "-";

              return (
                <div key={recId} className="rounded-3xl border border-white/10 bg-slate-950/20 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition hover:bg-slate-950/40">
                  <div>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      {recId}
                    </span>
                    <h3 className="text-lg font-semibold text-white mt-2">{donorName}</h3>
                    <p className="text-xs text-slate-400 mt-1">Category: {item.category || "General Donation"} • {item.paymentMethod || "UPI"}</p>
                  </div>
                  <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                    <div className="text-right">
                      <p className="text-lg font-bold text-amber-400">₹{amt.toLocaleString("en-IN")}</p>
                      <p className="text-xs text-slate-400">{formattedDate}</p>
                    </div>
                    <button
                      onClick={() => handleDownloadReceipt(item)}
                      className="inline-flex items-center gap-2 rounded-2xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-amber-300 shadow-sm"
                    >
                      <FaDownload /> Download PDF
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-slate-400 text-center py-6">No receipts match the selected criteria.</p>
          )}
        </div>
      </SectionCard>
    </DonationPageShell>
  );
};

export default DonationReceipts;
