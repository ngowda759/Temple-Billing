import { useState } from "react";

const RoleSelector = ({ selectedRole, setSelectedRole }) => {

  const roles = [
    "admin",
    "staff",
    "devotee",
  ];


  return (
    <div className="grid grid-cols-3 gap-4">

      {roles.map((role) => (
        <button
          key={role}
          type="button"
          onClick={() => setSelectedRole(role)}
          className={` p-4 rounded-2xl font-semibold capitalize transition-all duration-300 shadow-lg border ${ selectedRole === role ? "bg-orange-500 text-white border-orange-600 scale-105" : "bg-temple-100/90 text-black dark:text-slate-200 border-white hover:bg-orange-100" dark:hover:bg-slate-800 } `}
        >
          {role}
        </button>
      ))}

    </div>
  );
};

export default RoleSelector;