import { useState } from "react";

const RoleSelector = ({ selectedRole, setSelectedRole }) => {

  const roles = [
    "admin",
    "accountant",
    "cashier",
    "priest",
    "staff",
    "devotee",
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">

      {roles.map((role) => (
        <button
          key={role}
          type="button"
          onClick={() => setSelectedRole(role)}
          className={` py-3 px-2 rounded-xl font-medium text-sm capitalize transition-all duration-300 border ${ selectedRole === role ? "bg-temple-500 text-white border-temple-400 shadow-[0_4px_15px_rgba(229,130,32,0.4)] scale-[1.02]" : "bg-temple-100/10 text-white/80 border-white/10 hover:bg-temple-100/20 dark:hover:bg-slate-800 hover:text-white" } `}
        >
          {role}
        </button>
      ))}

    </div>
  );
};

export default RoleSelector;