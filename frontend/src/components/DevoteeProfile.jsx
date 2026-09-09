import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { getDevoteeProfile, updateDevoteeProfile } from "../../services/devoteeService";

const DevoateeProfileComponent = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState({
    id: "",
    name: "",
    email: "",
    phone: "",
    address: "",
    place: "",
    memberSince: "",
  });

  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const loadProfile = async () => {
      try {
        setLoading(true);
        if (user?.email) {
          const res = await getDevoteeProfile(user.email);
          if (res.profile) {
            setProfile(res.profile);
          }
        }
      } catch (error) {
        console.error("Failed to load profile:", error);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [user?.email]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfile((prev) => ({ ...prev, [name]: value }));
    // Clear error and success message for this field
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
    if (successMessage) {
      setSuccessMessage("");
    }
  };

  const validateForm = () => {
    const newErrors = {};
    if (!profile.name?.trim()) newErrors.name = "Name is required";
    if (!profile.email?.trim()) {
      newErrors.email = "Email is required";
    } else {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(profile.email?.trim())) {
        newErrors.email = "Please enter a valid email address (e.g. devotee@gmail.com)";
      }
    }
    if (!profile.phone?.trim()) {
      newErrors.phone = "Phone is required";
    } else if (!/^[0-9]{10}$/.test(profile.phone?.trim())) {
      newErrors.phone = "Phone must be exactly 10 digits (numbers only)";
    }
    if (!profile.address?.trim()) newErrors.address = "Address is required";
    if (!profile.place?.trim()) {
      newErrors.place = "Place/City is required";
    } else if (!/^[a-zA-Z\s]+$/.test(profile.place?.trim())) {
      newErrors.place = "Place/City must contain characters/letters and spaces only";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSaving(true);
    try {
      const res = await updateDevoteeProfile({
        currentEmail: user?.email,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        address: profile.address,
        place: profile.place,
      });
      setProfile(res.profile);
      setIsEditing(false);
      setSuccessMessage("✅ Profile updated successfully!");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (error) {
      const errorMsg = error.response?.data?.error || "Failed to update profile";
      alert(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
      </div>
    );
  }

  return (
    <div className={`rounded-[28px] border border-white/45 bg-temple-100/60 dark:bg-[#0f172a] p-6 shadow-[0_28px_80px_rgba(115,83,27,0.12)] backdrop-blur-xl`}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-amber-900">👤 My Profile</h2>
        <button
          onClick={() => {
            setIsEditing(!isEditing);
            setErrors({});
          }}
          className="px-4 py-2 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-all"
        >
          {isEditing ? "❌ Cancel" : "✏️ Edit Profile"}
        </button>
      </div>

      {successMessage && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-[#0f172a] border border-green-200 text-green-800">
          {successMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-amber-900 mb-2">Full Name *</label>
          <input
            type="text"
            name="name"
            value={profile.name}
            onChange={handleChange}
            disabled={!isEditing}
            className={`w-full rounded-xl border ${ errors.name ? "border-red-500" : "border-white/70" } ${isEditing ? "bg-temple-100/80 cursor-text" : "bg-gray-100 cursor-default"} p-3.5 outline-none ${ isEditing ? "focus:ring-2 focus:ring-amber-400" : "" } transition-all`}
          />
          {errors.name && <p className="text-red-600 text-sm mt-1">❌ {errors.name}</p>}
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-amber-900 mb-2">Email Address *</label>
          <input
            type="email"
            name="email"
            value={profile.email}
            onChange={handleChange}
            disabled={!isEditing}
            className={`w-full rounded-xl border ${ errors.email ? "border-red-500" : "border-white/70" } ${isEditing ? "bg-temple-100/80 cursor-text" : "bg-gray-100 cursor-default"} p-3.5 outline-none ${ isEditing ? "focus:ring-2 focus:ring-amber-400" : "" } transition-all`}
          />
          {errors.email && <p className="text-red-600 text-sm mt-1">❌ {errors.email}</p>}
        </div>

        {/* Phone Number */}
        <div>
          <label className="block text-sm font-medium text-amber-900 mb-2">Phone Number * (10 digits)</label>
          <input
            type="tel"
            name="phone"
            value={profile.phone}
            onChange={handleChange}
            disabled={!isEditing}
            placeholder="Enter 10-digit phone number"
            className={`w-full rounded-xl border ${ errors.phone ? "border-red-500" : "border-white/70" } ${isEditing ? "bg-temple-100/80 cursor-text" : "bg-gray-100 cursor-default"} p-3.5 outline-none ${ isEditing ? "focus:ring-2 focus:ring-amber-400" : "" } transition-all`}
          />
          {errors.phone && <p className="text-red-600 text-sm mt-1">❌ {errors.phone}</p>}
        </div>

        {/* Place/City */}
        <div>
          <label className="block text-sm font-medium text-amber-900 mb-2">Place/City *</label>
          <input
            type="text"
            name="place"
            value={profile.place}
            onChange={handleChange}
            disabled={!isEditing}
            className={`w-full rounded-xl border ${ errors.place ? "border-red-500" : "border-white/70" } ${isEditing ? "bg-temple-100/80 cursor-text" : "bg-gray-100 cursor-default"} p-3.5 outline-none ${ isEditing ? "focus:ring-2 focus:ring-amber-400" : "" } transition-all`}
          />
          {errors.place && <p className="text-red-600 text-sm mt-1">❌ {errors.place}</p>}
        </div>

        {/* Address */}
        <div>
          <label className="block text-sm font-medium text-amber-900 mb-2">Address *</label>
          <textarea
            name="address"
            value={profile.address}
            onChange={handleChange}
            disabled={!isEditing}
            rows="3"
            className={`w-full rounded-xl border ${ errors.address ? "border-red-500" : "border-white/70" } ${isEditing ? "bg-temple-100/80 cursor-text" : "bg-gray-100 cursor-default"} p-3.5 outline-none ${ isEditing ? "focus:ring-2 focus:ring-amber-400" : "" } resize-none transition-all`}
          />
          {errors.address && <p className="text-red-600 text-sm mt-1">❌ {errors.address}</p>}
        </div>

        {/* Member Since */}
        <div>
          <label className="block text-sm font-medium text-amber-900 mb-2">Member Since</label>
          <input
            type="text"
            value={profile.memberSince}
            disabled
            className="w-full rounded-xl border border-white/70 bg-gray-100 dark:bg-[#0f172a] p-3.5 outline-none"
          />
        </div>

        {/* Submit Button */}
        {isEditing && (
          <button
            type="submit"
            disabled={saving}
            className="w-full mt-6 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:from-gray-400 disabled:to-gray-400 text-white px-5 py-3 rounded-xl font-bold shadow-lg transition-all"
          >
            {saving ? "⏳ Saving..." : "💾 Save Changes"}
          </button>
        )}
      </form>

      {/* Notification Info */}
      <div className="mt-8 p-4 rounded-xl bg-blue-50 dark:bg-[#0f172a] border border-blue-200">
        <h3 className="font-semibold text-blue-900 mb-3">🔔 Your Notification Channels</h3>
        <p className="text-sm text-blue-800 mb-2">
          You will receive notifications on these channels for all your bookings, donations, and prasadam orders:
        </p>
        <div className="space-y-2 mt-3">
          <div className="flex items-center space-x-2 p-2 bg-temple-100 dark:bg-[#0f172a] rounded border border-blue-100">
            <span className="text-lg">📧</span>
            <div>
              <p className="text-xs font-semibold text-blue-900">Email</p>
              <p className="text-sm text-blue-800">{profile.email || "Not provided"}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 p-2 bg-temple-100 dark:bg-[#0f172a] rounded border border-blue-100">
            <span className="text-lg">📱</span>
            <div>
              <p className="text-xs font-semibold text-blue-900">SMS/WhatsApp</p>
              <p className="text-sm text-blue-800">{profile.phone || "Not provided"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DevoateeProfileComponent;
