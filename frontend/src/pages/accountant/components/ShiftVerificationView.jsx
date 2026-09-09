import React, { useState, useEffect } from "react";
import { getCashClosings, verifyCashClosing } from "../../../services/accountService";
import { toast } from "react-toastify";
import { FaCheckCircle, FaTimesCircle } from "react-icons/fa";

const ShiftVerificationView = () => {
  const [closings, setClosings] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadClosings = async () => {
    setLoading(true);
    try {
      const data = await getCashClosings();
      setClosings(data);
    } catch (error) {
      toast.error("Failed to load cash closings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClosings();
  }, []);

  const handleVerify = async (id, status) => {
    try {
      await verifyCashClosing(id, status);
      toast.success(`Shift closing ${status}`);
      loadClosings();
    } catch (error) {
      toast.error("Failed to verify shift closing");
    }
  };

  if (loading) return <div className="p-8 text-center">Loading shift closings...</div>;

  return (
    <div className="accountant-view">
      <section className="accountant-view__hero">
        <div>
          <h1>Shift Verification</h1>
          <p>Verify daily cash collections submitted by cashiers.</p>
        </div>
      </section>

      <section className="accountant-panel mt-6">
        <div className="accountant-panel__header">
          <div>
            <h3 className="accountant-panel__title">Pending Verifications</h3>
          </div>
        </div>

        <div className="accountant-tableWrap mt-4">
          <table className="accountant-table accountant-table--wide">
            <thead>
              <tr>
                <th>Date</th>
                <th>Cashier</th>
                <th>Opening Cash</th>
                <th>Collected</th>
                <th>Deposited</th>
                <th>Closing Cash</th>
                <th>Discrepancy</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {closings.length === 0 ? (
                <tr>
                  <td colSpan="9" className="text-center py-4">No shift closings found.</td>
                </tr>
              ) : (
                closings.map((c) => (
                  <tr key={c._id}>
                    <td>{new Date(c.date).toLocaleDateString()}</td>
                    <td>{c.recordedBy?.name || "Cashier"}</td>
                    <td>Rs {c.openingCash?.toFixed(2)}</td>
                    <td>Rs {c.cashCollected?.toFixed(2)}</td>
                    <td>Rs {c.cashDeposited?.toFixed(2)}</td>
                    <td className="font-bold">Rs {c.closingCash?.toFixed(2)}</td>
                    <td className={c.discrepancy !== 0 ? "text-red-500 font-bold" : "text-green-500"}>
                      Rs {c.discrepancy?.toFixed(2)}
                    </td>
                    <td>
                      <span className={`px-2 py-1 rounded text-xs ${c.status === 'Verified' ? 'bg-green-100 text-green-800' : c.status === 'Disputed' ? 'bg-red-100 dark:bg-red-900/40 dark:border-red-800/50 text-red-800 dark:text-red-400' : 'bg-yellow-100 text-yellow-800'}`}>
                        {c.status}
                      </span>
                    </td>
                    <td>
                      {c.status === "Pending Verification" && (
                        <div className="flex gap-2">
                          <button onClick={() => handleVerify(c._id, "Verified")} className="text-green-600 hover:text-green-800" title="Verify">
                            <FaCheckCircle size={18} />
                          </button>
                          <button onClick={() => handleVerify(c._id, "Disputed")} className="text-red-600 hover:text-red-800 dark:text-red-400" title="Dispute">
                            <FaTimesCircle size={18} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default ShiftVerificationView;
