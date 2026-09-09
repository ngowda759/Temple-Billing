import { useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { changePassword, googleLogin, login } from "../../services/authService";
import { FiRefreshCw } from "react-icons/fi";

import { useAuth } from "../../context/AuthContext";

const LoginForm = () => {
  const navigate = useNavigate();
  const { loginUser } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordResetToken, setPasswordResetToken] = useState(null);

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const [captchaText, setCaptchaText] = useState("");
  const [userCaptcha, setUserCaptcha] = useState("");
  const canvasRef = useRef(null);

  const generateCaptcha = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let text = "";
    for (let i = 0; i < 6; i++) {
      text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCaptchaText(text);
    setUserCaptcha("");
  };

  useEffect(() => {
    generateCaptcha();
  }, []);

  useEffect(() => {
    if (captchaText && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Background
      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Noise lines
      for (let i = 0; i < 5; i++) {
        ctx.strokeStyle = `rgba(${Math.random()*255},${Math.random()*255},${Math.random()*255},0.5)`;
        ctx.beginPath();
        ctx.moveTo(Math.random() * canvas.width, Math.random() * canvas.height);
        ctx.lineTo(Math.random() * canvas.width, Math.random() * canvas.height);
        ctx.stroke();
      }

      // Draw text
      ctx.font = "bold 24px Arial";
      ctx.fillStyle = "#1f2937";
      ctx.textBaseline = "middle";
      
      for (let i = 0; i < captchaText.length; i++) {
        const x = 15 + i * 18;
        const y = canvas.height / 2;
        const angle = (Math.random() - 0.5) * 0.4;
        
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillText(captchaText[i], 0, 0);
        ctx.restore();
      }
    }
  }, [captchaText]);

  const handleChange = (e) => {
    setErrorMessage("");
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!formData.email || !formData.password) {
      setErrorMessage("Please enter email and password.");
      return;
    }

    if (userCaptcha.toLowerCase() !== captchaText.toLowerCase()) {
      setErrorMessage("Incorrect CAPTCHA.");
      generateCaptcha();
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage("");
      const res = await login({ ...formData });
      const userRole = res.user?.role;
      if (!userRole) {
        setErrorMessage("Role not found for this account. Please contact admin.");
        return;
      }

      if (res.user?.mustChangePassword && userRole !== "devotee") {
        setPasswordResetToken(res.token);
        setCurrentPassword(formData.password);
        alert("First login detected. You must change your password to continue.");
        return;
      }

      loginUser({ token: res.token, user: res.user });
      alert(`Login Successful as ${userRole}`);
      navigate(`/${userRole}`);
    } catch (error) {
      setErrorMessage(error.response?.data?.message || "Login failed. Please check server and credentials.");
      generateCaptcha();
    } finally {
      setIsLoading(false);
    }
  };

  const handleFirstLoginPasswordChange = async (e) => {
    e.preventDefault();
    if (!passwordResetToken) return;

    try {
      setIsLoading(true);
      const res = await changePassword({
        token: passwordResetToken,
        currentPassword,
        newPassword,
      });
      loginUser({ token: res.token, user: res.user });
      setPasswordResetToken(null);
      setNewPassword("");
      alert("Password changed. Login completed.");
      navigate(`/${res.user.role}`);
    } catch (error) {
      alert(error.response?.data?.message || "Password update failed");
    } finally {
      setIsLoading(false);
    }
  };



  const handleGoogleLogin = async () => {
    const email = window.prompt("Enter Google email");
    if (!email) return;
    const name = window.prompt("Enter display name", "Devotee") || "Devotee";

    try {
      setIsLoading(true);
      const res = await googleLogin({ email, name });
      loginUser({ token: res.token, user: res.user });
      alert("Google login successful");
      navigate("/devotee");
    } catch (error) {
      alert(error.response?.data?.message || "Google login failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-[480px] bg-temple-100/20 dark:bg-[#0f172a] backdrop-blur-2xl border border-white/30 rounded-[35px] p-10 shadow-2xl text-white">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)] tracking-wide">Sri Shanti Mahadev Mandir</h1>
        <div className="flex items-center justify-center gap-3 mt-4">
          <div className="h-[2px] w-16 bg-amber-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"></div>
          <p className="text-amber-300 text-lg font-semibold tracking-wider uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">Sacred Management Portal</p>
          <div className="h-[2px] w-16 bg-amber-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"></div>
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-5 rounded-2xl border border-red-300/50 bg-red-950/50 px-4 py-3 text-sm text-red-100">
          {errorMessage}
        </div>
      ) : null}

      <form className="mt-8 space-y-6" onSubmit={handleLogin}>
        <div>
          <label className="block mb-3 text-lg font-medium">Email</label>
          <input
            type="email"
            name="email"
            placeholder="Enter email"
            value={formData.email}
            onChange={handleChange}
            required
            className="w-full p-4 rounded-2xl bg-temple-100/90 dark:bg-[#0f172a] text-black dark:text-slate-200 outline-none text-lg shadow-lg"
          />
        </div>

        <div>
          <label className="block mb-3 text-lg font-medium">Password</label>
          <input
            type="password"
            name="password"
            placeholder="Enter password"
            value={formData.password}
            onChange={handleChange}
            required
            className="w-full p-4 rounded-2xl bg-temple-100/90 dark:bg-[#0f172a] text-black dark:text-slate-200 outline-none text-lg shadow-lg"
          />
        </div>

        <div>
          <label className="block mb-3 text-lg font-medium">Verify you are human</label>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-4">
              <canvas 
                ref={canvasRef} 
                width="140" 
                height="50" 
                className="rounded-xl border border-gray-300 dark:border-slate-700 shadow-sm cursor-pointer"
                onClick={generateCaptcha}
                title="Click to refresh CAPTCHA"
              ></canvas>
              <button 
                type="button" 
                onClick={generateCaptcha} 
                className="text-amber-100 hover:text-white transition-transform hover:rotate-180 duration-300 p-2 bg-black/20 rounded-xl border border-white/20 shadow-sm flex items-center justify-center"
                title="Refresh CAPTCHA"
              >
                <FiRefreshCw className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              placeholder="Enter CAPTCHA text"
              value={userCaptcha}
              onChange={(e) => { setErrorMessage(""); setUserCaptcha(e.target.value); }}
              required
              className="w-full p-4 rounded-2xl bg-temple-100/90 dark:bg-[#0f172a] text-black dark:text-slate-200 outline-none text-lg shadow-lg"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all duration-300 p-4 rounded-2xl font-bold text-xl shadow-xl"
        >
          {isLoading ? "Logging in..." : "Login"}
        </button>
      </form>

      {passwordResetToken && (
        <form className="mt-5 space-y-3" onSubmit={handleFirstLoginPasswordChange}>
          <p className="text-amber-100 text-sm">Change password to continue (required for non-devotee first login).</p>
          <input
            type="password"
            placeholder="New password"
            minLength={6}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full p-3 rounded-xl bg-temple-100/90 dark:bg-[#0f172a] text-black dark:text-slate-200 outline-none"
            required
          />
          <button type="submit" className="w-full bg-amber-600 p-3 rounded-xl font-semibold">
            Update Password
          </button>
        </form>
      )}

      

      <div className="mt-5">
        <button
          type="button"
          onClick={() => navigate("/forgot-password")}
          className="w-full bg-orange-600 hover:bg-orange-700 transition-colors p-3 rounded-xl font-semibold"
        >
          Forgot Password
        </button>
      </div>


      <div className="text-center mt-6">
        <p className="text-amber-100">Don't have an account?</p>
        <button type="button" onClick={() => navigate("/register")} className="mt-2 text-yellow-300 font-semibold hover:text-yellow-400">
          New Devotee Register Here
        </button>
      </div>

      <div className="text-center mt-8 text-orange-100 text-xl">Har Har Mahadev</div>
    </div>
  );
};

export default LoginForm;
