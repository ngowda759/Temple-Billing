const mongoose = require("mongoose");
const axios = require("axios");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");

dotenv.config();

const API_BASE = "http://localhost:5000/api";

async function runTests() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/temple_billing");
  console.log("Connected.");

  const User = require("./src/models/User");
  const InventoryItem = require("./src/models/InventoryItem");
  const AccountTransaction = require("./src/models/AccountTransaction");
  const InventoryRequest = require("./src/models/InventoryRequest");
  const Asset = require("./src/models/Asset");
  const RepairRequest = require("./src/models/RepairRequest");

  // Create Users
  await User.deleteMany({ name: /VerifyTestUser/ });

  const createTestUser = async (role) => {
    return await User.create({
      name: `VerifyTestUser ${role}`,
      email: `verify_${role}@test.com`,
      password: "password123",
      role: role,
      status: "Active",
      accountEnabled: true,
      phoneNumber: "1234567890"
    });
  };

  const adminUser = await createTestUser("admin");
  const cashierUser = await createTestUser("cashier");
  const staffUser = await createTestUser("staff");
  const accUser = await createTestUser("accountant");

  function generateToken(user) {
    const payload = { id: user._id.toString(), role: user.role, email: user.email };
    return jwt.sign(payload, process.env.JWT_SECRET || "dev-secret", { expiresIn: "1d" });
  }

  const tokens = {
    admin: generateToken(adminUser),
    accountant: generateToken(accUser),
    staff: generateToken(staffUser),
    cashier: generateToken(cashierUser),
  };

  const getAxios = (role) => axios.create({ baseURL: API_BASE, headers: { Authorization: `Bearer ${tokens[role]}` } });

  const adminApi = getAxios("admin");
  const cashierApi = getAxios("cashier");
  const staffApi = getAxios("staff");
  const accApi = getAxios("accountant");

  const table = [];

  const addResult = (testName, role, action, before, after, accTx, expected, actual, pass) => {
    table.push({
      Test: testName, Role: role, Action: action,
      "Before Value": before, "After Value": after,
      "Acc Tx Created?": accTx,
      "Expected Result": expected, "Actual Result": actual,
      "PASS/FAIL": pass ? "PASS" : "FAIL"
    });
  };

  try {
    // 1. Add Item
    let itemId;
    try {
      const res = await adminApi.post("/admin/inventory-items", {
        name: "Verify Ghee " + Date.now(),
        unit: "Kg",
        category: "Pooja Items",
        minimumStock: 2,
        reorderLevel: 5
      });
      itemId = res.data.item._id;
      addResult("1. Add Item", "Admin", "Create Item", "N/A", "Stock 0", "No", "Stock 0, no tx", `Stock ${res.data.item.availableStock}`, res.data.item.availableStock === 0);
    } catch (e) { console.error("Add item failed:", e.message, e.response?.data); }

    // 2. Unauthorized Restock (Cashier)
    try {
      await cashierApi.post(`/admin/inventory-items/${itemId}/restock`, { quantityAdded: 10, supplier: "S", cost: 500 });
      addResult("2. Unauth Restock", "Cashier", "Attempt Restock", "0", "0", "No", "Forbidden", "Allowed", false);
    } catch (e) {
      addResult("2. Unauth Restock", "Cashier", "Attempt Restock", "0", "0", "No", "Forbidden", e.response?.status, e.response?.status === 401 || e.response?.status === 403);
    }

    // 3. Restock (Admin)
    try {
      const beforeTxCount = await AccountTransaction.countDocuments();
      await adminApi.post(`/admin/inventory-items/${itemId}/restock`, { quantityAdded: 10, supplier: "Vendor A", cost: 500, paymentMethod: "Cash" });
      const item = await InventoryItem.findById(itemId);
      const txs = await AccountTransaction.find({ referenceModel: "InventoryPurchase" }).sort({ _id: -1 }).limit(1);
      const afterTxCount = await AccountTransaction.countDocuments();

      const pass = item.availableStock === 10 && (afterTxCount - beforeTxCount === 1) && txs[0].amount === 500;
      addResult("3. Restock", "Admin", "Restock +10", "0", "10", `Yes (₹${txs[0]?.amount})`, "Stock 10, 1 Debit", `Stock ${item.availableStock}, ${afterTxCount - beforeTxCount} Tx`, pass);
    } catch (e) { console.error("Restock failed:", e.message, e.response?.data); }

    // 4. Request (Staff)
    let reqId;
    try {
      const reqData = await InventoryRequest.create({
        userId: staffUser._id, userName: "Staff User", role: "Staff",
        itemName: (await InventoryItem.findById(itemId)).name, quantity: 9, unit: "Kg",
        reason: "Test", purpose: "Test", expectedDate: new Date(), status: "Pending"
      });
      reqId = reqData._id;
      addResult("4. Request", "Staff", "Create Request", "N/A", "Pending", "No", "Created", "Created", !!reqId);
    } catch (e) { console.error("Request failed:", e.message); }

    // 5. Approve (Admin)
    try {
      await adminApi.put(`/admin/inventory-requests/${reqId}/status`, { status: "Approved" });
      const r = await InventoryRequest.findById(reqId);
      const item = await InventoryItem.findById(itemId);
      addResult("5. Approve", "Admin", "Approve Request", "Pending", r.status, "No", "Approved, Stock 10", `${r.status}, Stock ${item.availableStock}`, r.status === "Approved" && item.availableStock === 10);
    } catch (e) { console.error("Approve failed:", e.message, e.response?.data); }

    // 6. Issue (Admin)
    try {
      const beforeTxCount = await AccountTransaction.countDocuments();
      await adminApi.post(`/admin/inventory-requests/${reqId}/issue`, {});
      const item = await InventoryItem.findById(itemId);
      const afterTxCount = await AccountTransaction.countDocuments();
      const pass = item.availableStock === 1 && (afterTxCount === beforeTxCount);
      addResult("6. Issue", "Admin", "Issue Material", "10", "1", "No", "Stock 1, 0 Tx", `Stock ${item.availableStock}, ${afterTxCount - beforeTxCount} Tx`, pass);
    } catch (e) { console.error("Issue failed:", e.message, e.response?.data); }

    // 7. Repair Asset (Admin)
    try {
      const asset = await Asset.create({ assetId: "VERIFY-AST", name: "Verify Fan", category: "Electrical" });
      const repair = await RepairRequest.create({ asset: asset._id, description: "Test", vendor: "V", status: "Pending" });

      const beforeTxCount = await AccountTransaction.countDocuments();
      await adminApi.put(`/admin/inventory-repairs/${repair._id}/complete`, { cost: 150, paymentMethod: "Cash", completionDate: new Date() });
      const afterTxCount = await AccountTransaction.countDocuments();
      const tx = await AccountTransaction.findOne({ referenceId: repair._id });

      const pass = tx && tx.amount === 150 && (afterTxCount - beforeTxCount === 1);
      addResult("7. Complete Repair", "Admin", "Complete Repair", "Pending", "Completed", `Yes (₹${tx?.amount})`, "1 Debit Tx", `${afterTxCount - beforeTxCount} Tx`, pass);
    } catch (e) { console.error("Repair failed:", e.message, e.response?.data); }

    // Print table
    console.table(table);

  } catch (e) {
    console.error("Test execution failed:", e);
  } finally {
    mongoose.connection.close();
  }
}

runTests();
