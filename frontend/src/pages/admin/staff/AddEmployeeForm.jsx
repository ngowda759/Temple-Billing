import { useState } from "react";
import axios from "axios";

const AddEmployeeForm = () => {

 const [formData, setFormData] = useState({
 name: "",
 email: "",
 password: "",
 role: "",
 shift: "",
 department: "",
 });

 const handleChange = (e) => {
 setFormData({
 ...formData,
 [e.target.name]: e.target.value,
 });
 };

 const handleSubmit = async (e) => {
 e.preventDefault();

 try {

 const response = await axios.post(
 "http://localhost:5000/api/employees/create",
 formData
 );

 alert(response.data.message);

 } catch (error) {

 alert(error.response.data.message);

 }
 };

 return (
 <form
 onSubmit={handleSubmit}
 className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-3xl shadow"
 >

 <h2 className="text-2xl font-bold mb-5">
 Add Employee
 </h2>

 <div className="grid grid-cols-2 gap-4">

 <input
 type="text"
 name="name"
 placeholder="Employee Name"
 className="border p-3 rounded-xl"
 onChange={handleChange}
 />

 <input
 type="email"
 name="email"
 placeholder="Email"
 className="border p-3 rounded-xl"
 onChange={handleChange}
 />

 <input
 type="password"
 name="password"
 placeholder="Password"
 className="border p-3 rounded-xl"
 onChange={handleChange}
 />

 <select
 name="role"
 className="border p-3 rounded-xl"
 onChange={handleChange}
 >
 <option>Select Role</option>
 <option value="priest">Priest</option>
 <option value="cashier">Cashier</option>
 <option value="accountant">Accountant</option>
 <option value="staff">Staff</option>
 </select>

 </div>

 <button
 className="
 mt-5
  bg-orange-500 hover:bg-orange-600 text-white transition-colors
 px-6
 py-3
 rounded-xl
 "
 >
 Create Employee
 </button>

 </form>
 );
};

export default AddEmployeeForm;