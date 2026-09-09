import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { login } from "../services/authService";
import { useAuth } from "../context/AuthContext";
import RoleSelector from "./RoleSelector";

const LoginForm = () => {
  const navigate = useNavigate();
  const { loginUser } = useAuth();

  const [selectedRole, setSelectedRole] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!formData.email || !formData.password) {
      alert("Please enter email and password");
      return;
    }

    try {
      setIsLoading(true);
      const res = await login(formData);
      const userRole = res.user?.role;
      if (!userRole) {
        alert("Role not found for this account. Please contact admin.");
        return;
      }

      loginUser({ token: res.token, user: res.user });
      if (selectedRole && selectedRole !== userRole) {
        alert(`Logged in as ${userRole}. Selected role was ${selectedRole}.`);
      } else {
        alert(`Login Successful as ${userRole}`);
      }
      navigate(`/${userRole}`);
    } catch (error) {
      alert(error.response?.data?.message || "Login failed. Please check server and credentials.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[480px] bg-black/40 backdrop-blur-2xl border border-white/20 rounded-[2rem] p-8 md:p-10 shadow-2xl text-white relative overflow-hidden group">
      {/* Subtle glow effect */}
      <div className="absolute -inset-1 bg-gradient-to-r from-temple-500 to-temple-300 rounded-[2rem] blur opacity-10 group-hover:opacity-20 transition duration-1000"></div>

      <div className="relative text-center mb-8">
        <h1 className="font-serif text-3xl md:text-4xl font-bold text-white drop-shadow-sm">Sign In</h1>
        <div className="flex items-center justify-center gap-3 mt-3">
          <div className="h-px w-12 bg-gradient-to-r from-transparent to-temple-400"></div>
          <p className="text-temple-300 text-sm font-medium tracking-wider uppercase">Portal Access</p>
          <div className="h-px w-12 bg-gradient-to-l from-transparent to-temple-400"></div>
        </div>
      </div>

      <div className="relative">
        <RoleSelector selectedRole={selectedRole} setSelectedRole={setSelectedRole} />
      </div>

      <form className="relative mt-8 space-y-5" onSubmit={handleLogin}>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-white/80 ml-1">Email Address</label>
          <input
            type="email"
            name="email"
            placeholder="admin@temple.com"
            value={formData.email}
            onChange={handleChange}
            required
            className="w-full px-5 py-3.5 rounded-xl bg-temple-100/10 dark:bg-[#0f172a] border border-white/10 text-white placeholder:text-white/40 focus:bg-temple-100/20 focus:border-temple-400 focus:ring-2 focus:ring-temple-400/20 outline-none transition-all duration-300"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between ml-1">
            <label className="text-sm font-medium text-white/80">Password</label>
            <button type="button" onClick={() => navigate("/forgot-password")} className="text-xs text-temple-400 hover:text-temple-300 transition-colors">Forgot?</button>
          </div>
          <input
            type="password"
            name="password"
            placeholder="••••••••"
            value={formData.password}
            onChange={handleChange}
            required
            className="w-full px-5 py-3.5 rounded-xl bg-temple-100/10 dark:bg-[#0f172a] border border-white/10 text-white placeholder:text-white/40 focus:bg-temple-100/20 focus:border-temple-400 focus:ring-2 focus:ring-temple-400/20 outline-none transition-all duration-300"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full mt-2 bg-gradient-to-r from-temple-500 to-temple-600 hover:from-temple-600 hover:to-temple-700 disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-300 py-3.5 rounded-xl font-bold text-white shadow-[0_4px_20px_rgba(229,130,32,0.3)] hover:shadow-[0_6px_25px_rgba(229,130,32,0.4)] hover:-translate-y-0.5 active:translate-y-0"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              Authenticating...
            </span>
          ) : "Sign In"}
        </button>
      </form>

      <div className="relative text-center mt-8 pt-6 border-t border-white/10">
        <p className="text-white/60 text-sm">Don't have an account?</p>
        <button onClick={() => navigate("/register")} className="mt-1 text-temple-400 font-semibold hover:text-temple-300 transition-colors">
          Register Here
        </button>
      </div>

      <div className="relative text-center mt-6 text-white/40 text-xs tracking-widest uppercase">
        Har Har Mahadev
      </div>
    </div>
  );
};

export default LoginForm;
