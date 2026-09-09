import React, { useState } from "react";

const services = [
 { id: 1, name: "Archana Pooja", price: 500 },
 { id: 2, name: "Abhishekam", price: 1200 },
 { id: 3, name: "Special Seva", price: 2500 },
 { id: 4, name: "Ganapathi Homam", price: 3000 },
 { id: 5, name: "Prasadam - Laddu", price: 50 },
];

export default function QuickBillingPage() {
 const [selectedItems, setSelectedItems] = useState([]);
 const [paymentMethod, setPaymentMethod] = useState("Cash");

 const addItem = (service) => {
 setSelectedItems([
 ...selectedItems,
 {
 ...service,
 qty: 1,
 },
 ]);
 };

 const total = selectedItems.reduce(
 (sum, item) => sum + item.price * item.qty,
 0
 );

 return (
 <div className="p-6 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 min-h-screen">

 {/* Header */}
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-6 mb-6">
 <h1 className="text-3xl font-bold">Quick Billing</h1>
 <p className="text-gray-500">
 Generate bill for services, poojas and prasadam
 </p>
 </div>

 {/* Top Cards */}
 <div className="grid grid-cols-4 gap-5 mb-6">

 <div className="bg-yellow-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border rounded-xl p-5">
 <h3 className="text-gray-600">Today's Collection</h3>
 <p className="text-3xl font-bold mt-2">₹68,450</p>
 </div>

 <div className="bg-purple-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border rounded-xl p-5">
 <h3 className="text-gray-600">Total Transactions</h3>
 <p className="text-3xl font-bold mt-2">128</p>
 </div>

 <div className="bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border rounded-xl p-5">
 <h3 className="text-gray-600">Pooja Bookings</h3>
 <p className="text-3xl font-bold mt-2">42</p>
 </div>

 <div className="bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border rounded-xl p-5">
 <h3 className="text-gray-600">Prasadam Sales</h3>
 <p className="text-3xl font-bold mt-2">₹12,780</p>
 </div>

 </div>

 {/* Main Billing Area */}

 <div className="grid grid-cols-12 gap-6">

 {/* Services */}

 <div className="col-span-4 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5">

 <h2 className="font-bold text-xl mb-4">
 Select Service / Item
 </h2>

 <div className="space-y-3">

 {services.map((service) => (
 <div
 key={service.id}
 className="flex justify-between items-center border p-3 rounded-lg"
 >
 <div>
 <p className="font-medium">
 {service.name}
 </p>
 <p className="text-green-600">
 ₹{service.price}
 </p>
 </div>

 <button
 onClick={() => addItem(service)}
 className="bg-blue-600 text-white px-4 py-2 rounded-lg"
 >
 Add
 </button>
 </div>
 ))}

 </div>

 </div>

 {/* Bill Items */}

 <div className="col-span-5 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5">

 <h2 className="font-bold text-xl mb-4">
 Bill Items
 </h2>

 <table className="w-full">

 <thead>
 <tr className="border-b">
 <th className="text-left py-2">Item</th>
 <th>Qty</th>
 <th>Amount</th>
 </tr>
 </thead>

 <tbody>

 {selectedItems.map((item, index) => (
 <tr key={index} className="border-b">

 <td className="py-3">
 {item.name}
 </td>

 <td className="text-center">
 {item.qty}
 </td>

 <td className="text-center">
 ₹{item.price}
 </td>

 </tr>
 ))}

 </tbody>

 </table>

 </div>

 {/* Payment Summary */}

 <div className="col-span-3 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5">

 <h2 className="font-bold text-xl mb-4">
 Payment Summary
 </h2>

 <div className="space-y-3">

 <div className="flex justify-between">
 <span>Total Amount</span>
 <span className="font-bold">
 ₹{total}
 </span>
 </div>

 <div>

 <label className="font-medium block mb-2">
 Payment Method
 </label>

 <select
 className="w-full border rounded-lg p-3"
 value={paymentMethod}
 onChange={(e) =>
 setPaymentMethod(e.target.value)
 }
 >
 <option>Cash</option>
 <option>UPI</option>
 <option>Card</option>
 <option>Net Banking</option>
 </select>

 </div>

 <input
 type="number"
 placeholder="Received Amount"
 className="w-full border rounded-lg p-3"
 />

 <button
 className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold"
 >
 Generate Bill & Print Receipt
 </button>

 </div>

 </div>

 </div>

 </div>
 );
}