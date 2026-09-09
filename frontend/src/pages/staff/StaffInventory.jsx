import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { FiBox, FiClock, FiCheckCircle, FiLock, FiSave } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import "./StaffDashboard.css"; // Reuse existing styles

const API_BASE = "http://localhost:5000/api";

const statusClassMap = {
  Pending: "pending",
  "In Progress": "progress",
  Completed: "completed",
  Approved: "approved",
  Rejected: "rejected",
};

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const StaffInventory = () => {
  const { user } = useAuth();
  const staffId = user?.id || user?._id || "";
  const staffName = user?.name || "Staff";

  const [activeTab, setActiveTab] = useState("requests"); // "requests" | "issued"

  // Requests Tab State
  const [catalog, setCatalog] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [form, setForm] = useState({ itemName: "", quantity: "", unit: "Pack", reason: "" });
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Issued Tab State
  const [issues, setIssues] = useState([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState("");
  const [completingIssueId, setCompletingIssueId] = useState(null);
  const [completionForm, setCompletionForm] = useState({}); // { [issueId]: { usedQuantity: "", returnedQuantity: "", remarks: "" } }

  const fetchRequestsData = useCallback(async () => {
    if (!staffId) return;
    setLoading(true);
    try {
      const [catRes, reqRes] = await Promise.all([
        axios.get(`${API_BASE}/staff/inventory/catalog`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }),
        axios.get(`${API_BASE}/staff/inventory-requests/${staffId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      ]);
      setCatalog(catRes.data?.items || []);
      setRequests(reqRes.data?.requests || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [staffId]);

  const fetchIssuesData = useCallback(async () => {
    if (!staffId) return;
    setIssuesLoading(true);
    setIssuesError("");
    try {
      const res = await axios.get(`${API_BASE}/staff/inventory-issues/${staffId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
      setIssues(Array.isArray(res.data?.issues) ? res.data.issues : []);
    } catch (err) {
      setIssuesError(err.response?.data?.message || "Failed to load issued items.");
    } finally {
      setIssuesLoading(false);
    }
  }, [staffId]);

  useEffect(() => {
    if (activeTab === "requests") {
      fetchRequestsData();
    } else if (activeTab === "issued") {
      fetchIssuesData();
    }
  }, [activeTab, fetchRequestsData, fetchIssuesData]);

  // Computed Values
  const filteredRequests = useMemo(() => {
    return requests
      .filter((req) => {
        const matchesStatus = filter === "all" || req.status === filter;
        const query = search.trim().toLowerCase();
        const matchesSearch = !query || req.itemName.toLowerCase().includes(query);
        return matchesStatus && matchesSearch;
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [requests, filter, search]);

  const summary = useMemo(() => {
    return requests.reduce(
      (acc, r) => {
        acc.total++;
        if (r.status === "Pending") acc.pending++;
        if (r.status === "Approved") acc.approved++;
        if (r.status === "Rejected") acc.rejected++;
        return acc;
      },
      { total: 0, pending: 0, approved: 0, rejected: 0 }
    );
  }, [requests]);

  const pendingIssues = useMemo(() => issues.filter((iss) => iss.status === "Issued"), [issues]);
  const completedIssues = useMemo(() => issues.filter((iss) => iss.status === "Consumed"), [issues]);

  // Handlers
  const handleSubmitRequest = async (e) => {
    e.preventDefault();
    if (!form.itemName || !form.quantity || !form.reason) {
      setError("Please fill all required fields.");
      return;
    }
    const parsedQty = parseFloat(form.quantity);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      setSuccessMsg("");
      await axios.post(`${API_BASE}/staff/inventory-requests`, {
        userId: staffId,
        userName: staffName,
        role: user?.role || "Staff",
        itemName: form.itemName,
        quantity: parsedQty,
        unit: form.unit,
        reason: form.reason,
      }, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
      setForm({ itemName: "", quantity: "", unit: "Pack", reason: "" });
      await fetchRequestsData();
      setSuccessMsg("Request submitted successfully!");
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to submit request.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteIssue = async (issueId, issuedQuantity) => {
    const data = completionForm[issueId] || {};
    const usedQty = parseFloat(data.usedQuantity);
    const returnedQty = parseFloat(data.returnedQuantity);

    if (isNaN(usedQty) || isNaN(returnedQty) || usedQty < 0 || returnedQty < 0) {
      alert("Please enter valid positive numbers for used and returned quantities.");
      return;
    }

    if (usedQty + returnedQty !== issuedQuantity) {
      alert(`Used (${usedQty}) + Returned (${returnedQty}) must equal Issued Quantity (${issuedQuantity}).`);
      return;
    }

    if (!window.confirm(`Confirm usage:\nUsed: ${usedQty}\nReturned: ${returnedQty}\nAre you sure?`)) return;

    setCompletingIssueId(issueId);
    try {
      await axios.post(`${API_BASE}/staff/inventory-issues/${issueId}/complete`, {
        usedQuantity: usedQty,
        returnedQuantity: returnedQty,
        remarks: data.remarks || "Usage logged by staff",
      }, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
      await fetchIssuesData();
      setCompletionForm((p) => {
        const next = { ...p };
        delete next[issueId];
        return next;
      });
    } catch (err) {
      alert(err.response?.data?.message || "Failed to log usage.");
    } finally {
      setCompletingIssueId(null);
    }
  };

  const updateCompletionForm = (issueId, field, value) => {
    setCompletionForm((p) => ({
      ...p,
      [issueId]: {
        ...(p[issueId] || { usedQuantity: "", returnedQuantity: "", remarks: "" }),
        [field]: value
      }
    }));
  };

  const downloadInventoryReport = () => {
    const rows = [
      ["Item Name", "Quantity", "Unit", "Request Date", "Status", "Admin Remarks"],
      ...requests.map((request) => [
        request.itemName,
        request.quantity,
        request.unit || "",
        formatDateTime(request.createdAt),
        request.status,
        request.adminReason || "-",
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "inventory-requests-report.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ width: "100%" }}>
      <section className="inventory-page">
        <div className="leave-head">
          <div>
            <h2>Inventory Management</h2>
            <p>Request items and track usage of your issued items.</p>
          </div>
          <div className="inventory-actions">
            {/* Tabs removed as per user request */}
          </div>
        </div>

        {activeTab === "requests" && (
          <div>
            {error ? <div className="staff-error">{error}</div> : null}
            {successMsg ? (
              <div style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: "12px", padding: "12px 16px", color: "#065f46", fontWeight: 600, marginBottom: "16px" }}>
                {successMsg}
              </div>
            ) : null}

            <div className="inventory-top-cards">
              <article className="info-card">
                <div className="icon-bg orange"><FiBox /></div>
                <div>
                  <h3>Total Requests</h3>
                  <strong>{summary.total}</strong>
                </div>
              </article>
              <article className="info-card">
                <div className="icon-bg blue"><FiClock /></div>
                <div>
                  <h3>Pending</h3>
                  <strong>{summary.pending}</strong>
                </div>
              </article>
              <article className="info-card">
                <div className="icon-bg green"><FiCheckCircle /></div>
                <div>
                  <h3>Approved</h3>
                  <strong>{summary.approved}</strong>
                </div>
              </article>
              <article className="info-card">
                <div className="icon-bg red"><FiLock /></div>
                <div>
                  <h3>Rejected</h3>
                  <strong>{summary.rejected}</strong>
                </div>
              </article>
            </div>

            <div className="inventory-grid">
              <div className="inventory-form-card">
                <div className="card-heading">
                  <h2>New Inventory Request</h2>
                </div>
                <form className="leave-form" onSubmit={handleSubmitRequest}>
                  <div>
                    <label htmlFor="inv-itemName">Item Name <span style={{ color: "#ef4444" }}>*</span></label>
                    <select
                      id="inv-itemName"
                      value={form.itemName}
                      onChange={(e) => {
                        const selected = catalog.find(i => i.name === e.target.value);
                        setForm(p => ({ ...p, itemName: e.target.value, unit: selected ? selected.unit : "Pack" }));
                        setError("");
                      }}
                    >
                      <option value="">Select Item</option>
                      {catalog.map((item) => (
                        <option key={item.name} value={item.name}>
                          {item.name} ({item.stock} {item.unit} available)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label htmlFor="inv-quantity">Quantity <span style={{ color: "#ef4444" }}>*</span></label>
                      <input
                        id="inv-quantity"
                        type="number"
                        min="0.1"
                        step="0.1"
                        placeholder="Quantity"
                        value={form.quantity}
                        onChange={(e) => { setForm(p => ({ ...p, quantity: e.target.value })); setError(""); }}
                      />
                    </div>
                    <div>
                      <label htmlFor="inv-unit">Unit <span style={{ color: "#ef4444" }}>*</span></label>
                      <select
                        id="inv-unit"
                        value={form.unit}
                        onChange={(e) => { setForm(p => ({ ...p, unit: e.target.value })); setError(""); }}
                      >
                        <option value="">Select Unit</option>
                        {["Kg", "Liter", "Pack", "Pieces"].map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="inv-reason">Purpose <span style={{ color: "#ef4444" }}>*</span></label>
                    <textarea
                      id="inv-reason"
                      rows="2"
                      placeholder="e.g. For tomorrow's tasks"
                      value={form.reason}
                      onChange={(e) => { setForm(p => ({ ...p, reason: e.target.value })); setError(""); }}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    style={{
                      width: "100%",
                      padding: "14px 20px",
                      backgroundColor: submitting ? "#94a3b8" : "#d97706",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "12px",
                      fontSize: "15px",
                      fontWeight: "800",
                      letterSpacing: "0.5px",
                      cursor: submitting ? "not-allowed" : "pointer",
                      boxShadow: "0 4px 14px rgba(217, 119, 6, 0.4)",
                      transition: "all 0.2s ease",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      marginTop: "16px",
                    }}
                  >
                    {submitting ? "Submitting Request..." : "🚀 Submit Inventory Request"}
                  </button>
                </form>
              </div>

              <div className="inventory-status-card">
                <div className="card-heading">
                  <h2>📦 Live Inventory Status</h2>
                  <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>Read-only</p>
                </div>
                <div className="inventory-status-list">
                  {loading ? (
                    <div className="empty-cell">Loading inventory...</div>
                  ) : catalog.length === 0 ? (
                    <div className="empty-cell">No inventory data available</div>
                  ) : (
                    (() => {
                      const lowStockItems = catalog
                        .filter(item => item.status === "Low Stock" || item.stock <= item.minimumStock)
                        .sort((a, b) => a.stock - b.stock)
                        .slice(0, 5);
                      
                      if (lowStockItems.length === 0) {
                        return <div className="empty-cell">No low stock items.</div>;
                      }

                      return lowStockItems.map((item) => (
                        <div key={item.name} className="inventory-status-item">
                          <div>
                            <h3>{item.name}</h3>
                            <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>
                              Stock: <strong style={{ color: "#ef4444" }}>{item.stock} {item.unit}</strong> | Min: {item.minimumStock} {item.unit}
                            </p>
                          </div>
                          <span className="status-chip rejected">
                            🔴 Low Stock
                          </span>
                        </div>
                      ));
                    })()
                  )}
                </div>
              </div>
            </div>

            <div className="table-card" style={{ marginTop: "24px" }}>
              <div className="card-heading inventory-history-header">
                <div>
                  <h2>Request History</h2>
                </div>
                <div className="inventory-history-filters">
                  <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                    <option value="all">All</option>
                    <option value="Pending">Pending</option>
                    <option value="Approved">Approved</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                  <input type="text" placeholder="Search item..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
              <div className="table-wrap">
                <table className="task-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Purpose</th>
                      <th>Status</th>
                      <th>Admin Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.length === 0 ? (
                      <tr><td colSpan="6" className="empty-cell">No requests found.</td></tr>
                    ) : (
                      filteredRequests.map((request) => (
                        <tr key={request._id}>
                          <td>{formatDateTime(request.createdAt)}</td>
                          <td>{request.itemName}</td>
                          <td>{request.quantity} {request.unit}</td>
                          <td style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={request.reason}>{request.reason}</td>
                          <td><span className={`status-chip ${statusClassMap[request.status] || ""}`}>{request.status}</span></td>
                          <td>{request.adminReason || "-"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "issued" && (
          <div>
            <div className="leave-head" style={{ marginBottom: "16px" }}>
              <div>
                <h2>Items Issued to You</h2>
                <p>Log usage for items issued to you. Enter used and returned quantities.</p>
              </div>
              <button type="button" onClick={fetchIssuesData} disabled={issuesLoading}>
                {issuesLoading ? "Refreshing..." : "🔄 Refresh"}
              </button>
            </div>

            {issuesError && <div className="staff-error">{issuesError}</div>}

            <div className="inventory-grid" style={{ gridTemplateColumns: "1fr", gap: "24px" }}>
              {pendingIssues.length === 0 ? (
                <div className="empty-cell" style={{ background: "var(--panel)", padding: "40px", borderRadius: "16px" }}>
                  No pending issued items.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
                  {pendingIssues.map(issue => {
                    const cForm = completionForm[issue._id] || { usedQuantity: "", returnedQuantity: "", remarks: "" };
                    return (
                      <div key={issue._id} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "16px", padding: "20px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                          <div>
                            <h3 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text)", margin: "0 0 4px" }}>{issue.itemName}</h3>
                            <p style={{ fontSize: "12px", color: "var(--muted)", margin: 0 }}>Issued: {formatDateTime(issue.issueDate)}</p>
                          </div>
                          <span style={{ background: "#eff6ff", color: "#1d4ed8", padding: "4px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: 700 }}>
                            {issue.issuedQuantity} {issue.unit}
                          </span>
                        </div>

                        <div style={{ marginBottom: "16px" }}>
                          <p style={{ fontSize: "13px", color: "var(--muted)", margin: "0 0 12px" }}><strong>Purpose:</strong> {issue.purpose || "-"}</p>

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                            <div>
                              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>Used Qty <span style={{ color: "#ef4444" }}>*</span></label>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={cForm.usedQuantity}
                                onChange={(e) => updateCompletionForm(issue._id, "usedQuantity", e.target.value)}
                                style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "13px", background: "var(--panel)", color: "var(--text)" }}
                              />
                            </div>
                            <div>
                              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>Returned Qty <span style={{ color: "#ef4444" }}>*</span></label>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={cForm.returnedQuantity}
                                onChange={(e) => updateCompletionForm(issue._id, "returnedQuantity", e.target.value)}
                                style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "13px", background: "var(--panel)", color: "var(--text)" }}
                              />
                            </div>
                          </div>
                          <div>
                            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>Remarks (Optional)</label>
                            <input
                              type="text"
                              value={cForm.remarks}
                              onChange={(e) => updateCompletionForm(issue._id, "remarks", e.target.value)}
                              placeholder="e.g. Unused packs returned"
                              style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "13px", background: "var(--panel)", color: "var(--text)" }}
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={completingIssueId === issue._id}
                          onClick={() => handleCompleteIssue(issue._id, issue.issuedQuantity)}
                          style={{ width: "100%", background: "#10b981", color: "#fff", border: "none", padding: "10px", borderRadius: "8px", fontWeight: 600, cursor: "pointer" }}
                        >
                          {completingIssueId === issue._id ? "Saving..." : "Complete Usage"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {completedIssues.length > 0 && (
              <div className="table-card" style={{ marginTop: "24px" }}>
                <div className="card-heading">
                  <h2>Consumption History</h2>
                </div>
                <div className="table-wrap">
                  <table className="task-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Item</th>
                        <th>Issued</th>
                        <th>Used</th>
                        <th>Returned</th>
                        <th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {completedIssues.map((issue) => (
                        <tr key={issue._id}>
                          <td>{formatDateTime(issue.updatedAt)}</td>
                          <td>{issue.itemName}</td>
                          <td>{issue.issuedQuantity} {issue.unit}</td>
                          <td style={{ color: "#ef4444", fontWeight: 600 }}>{issue.usedQuantity} {issue.unit}</td>
                          <td style={{ color: "#10b981", fontWeight: 600 }}>{issue.returnedQuantity} {issue.unit}</td>
                          <td>{issue.remarks || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

      </section>
    </div>
  );
};

export default StaffInventory;
