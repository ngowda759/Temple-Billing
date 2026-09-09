import React from "react";
import CashierPageShell from "../../components/cashier/CashierPageShell";
import StaffInventory from "../staff/StaffInventory";
import templeBg from "../../assets/temple-bg.jpg";

const CashierInventoryRequestsPage = () => {
 return (
 <CashierPageShell
 eyebrow="Inventory Requests"
 title="Request items from store"
 description="Request items from the main inventory and track usage."
 image={templeBg}
 imageAlt="Inventory Requests"
 >
 <div style={{ margin: "20px 0" }}>
 <StaffInventory />
 </div>
 </CashierPageShell>
 );
};

export default CashierInventoryRequestsPage;
