import React from "react";
import { FaLock, FaSave, FaUserCircle, FaEnvelope, FaPhone, FaMapMarkerAlt, FaTint, FaCalendarAlt, FaShieldAlt } from "react-icons/fa";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const bankOptions = [
  "State Bank of India (SBI)",
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "Punjab National Bank (PNB)",
  "Bank of Baroda",
  "Canara Bank",
  "Union Bank of India",
  "Kotak Mahindra Bank",
  "IndusInd Bank",
  "Other",
];

const EmployeeProfileView = ({
  profile,
  user,
  profileForm,
  passwordForm,
  errors,
  message,
  messageType,
  loading,
  savingProfile,
  savingPassword,
  onFieldChange,
  onPasswordChange,
  onSaveProfile,
  onChangePassword,
  adminManagedDetails,
}) => {
  return (
    <div className="w-full">
      {message ? (
        <div
          className={`mb-6 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-sm transition-all duration-300 ${ messageType === "success" ? "border-emerald-200 bg-emerald-50 dark:bg-[#0f172a] text-emerald-800" : messageType === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-[#f4d0a3] bg-[#fff7eb] text-[#8a5200]" }`}
        >
          {message}
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-3">
        {/* EDIT PROFILE FORM */}
        <div className="lg:col-span-2 space-y-6">
          <section className="rounded-3xl border border-[#f0d3a2] dark:border-slate-700 bg-[#fff9ef] dark:bg-[#0f172a] p-6 shadow-sm transition hover:shadow-md">
            <div className="flex items-center justify-between border-b border-[#f9ebdf] dark:border-slate-700 pb-4">
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">Edit Profile</h2>
                <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
                  Update your personal details below. Employment details stay synced with admin changes.
                </p>
              </div>
              <div className="rounded-full bg-[#fff6e6] dark:bg-[#0f172a] p-2.5 text-[#f28c18]">
                <FaSave className="text-xl" />
              </div>
            </div>

            <form className="mt-6 space-y-5" onSubmit={onSaveProfile}>
              <div className="grid gap-5 md:grid-cols-2">
                {/* Name */}
                <div className="block">
                  <label className="mb-1.5 block text-sm font-bold text-slate-800 dark:text-slate-200">Full Name</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
                      <FaUserCircle />
                    </span>
                    <input
                      value={profileForm.name}
                      onChange={(e) => onFieldChange("name", e.target.value)}
                      className={`w-full rounded-2xl border ${ errors?.name ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb] dark:border-slate-600" } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition`}
                      placeholder="Enter name"
                    />
                  </div>
                  {errors?.name && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.name}</p>}
                </div>

                {/* Email */}
                <div className="block">
                  <label className="mb-1.5 block text-sm font-bold text-slate-800 dark:text-slate-200">Email Address</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
                      <FaEnvelope />
                    </span>
                    <input
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => onFieldChange("email", e.target.value)}
                      className={`w-full rounded-2xl border ${ errors?.email ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb] dark:border-slate-600" } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition`}
                      placeholder="email@temple.com"
                    />
                  </div>
                  {errors?.email && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.email}</p>}
                </div>

                {/* Phone */}
                <div className="block">
                  <label className="mb-1.5 block text-sm font-bold text-slate-800 dark:text-slate-200">Phone Number</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
                      <FaPhone />
                    </span>
                    <input
                      value={profileForm.phone}
                      onChange={(e) => onFieldChange("phone", e.target.value)}
                      className={`w-full rounded-2xl border ${ errors?.phone ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb] dark:border-slate-600" } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition`}
                      placeholder="10-digit number"
                    />
                  </div>
                  {errors?.phone && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.phone}</p>}
                </div>

                {/* Emergency Contact */}
                <div className="block">
                  <label className="mb-1.5 block text-sm font-bold text-slate-800 dark:text-slate-200">Emergency Contact</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
                      <FaPhone />
                    </span>
                    <input
                      value={profileForm.emergencyContact}
                      onChange={(e) => onFieldChange("emergencyContact", e.target.value)}
                      className={`w-full rounded-2xl border ${ errors?.emergencyContact ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb] dark:border-slate-600" } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition`}
                      placeholder="Emergency 10-digit number"
                    />
                  </div>
                  {errors?.emergencyContact && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.emergencyContact}</p>}
                </div>

                {/* Blood Group Dropdown */}
                <div className="block">
                  <label className="mb-1.5 block text-sm font-bold text-slate-800 dark:text-slate-200">Blood Group</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-[#f28c18]">
                      <FaTint />
                    </span>
                    <select
                      value={profileForm.bloodGroup}
                      onChange={(e) => onFieldChange("bloodGroup", e.target.value)}
                      className={`w-full rounded-2xl border ${ errors?.bloodGroup ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb] dark:border-slate-600" } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition appearance-none cursor-pointer`}
                    >
                      <option value="">Select Blood Group</option>
                      {BLOOD_GROUPS.map((group) => (
                        <option key={group} value={group}>
                          {group}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
                      ▼
                    </span>
                  </div>
                  {errors?.bloodGroup && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.bloodGroup}</p>}
                </div>

                {/* Date of Birth */}
                <div className="block">
                  <label className="mb-1.5 block text-sm font-bold text-slate-800 dark:text-slate-200">Date of Birth</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
                      <FaCalendarAlt />
                    </span>
                    <input
                      type="date"
                      value={profileForm.dob}
                      onChange={(e) => onFieldChange("dob", e.target.value)}
                      className={`w-full rounded-2xl border ${ errors?.dob ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb] dark:border-slate-600" } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition`}
                    />
                  </div>
                  {errors?.dob && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.dob}</p>}
                </div>

                {/* Bank Name Dropdown */}
                <div className="block">
                  <label className="mb-1.5 block text-sm font-bold text-slate-800 dark:text-slate-200">Bank Name</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-[#f28c18]">
                      <FaSave />
                    </span>
                    <select
                      value={profileForm.bankName}
                      onChange={(e) => onFieldChange("bankName", e.target.value)}
                      className={`w-full rounded-2xl border ${ errors?.bankName ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb] dark:border-slate-600" } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition appearance-none cursor-pointer`}
                    >
                      <option value="">Select Bank</option>
                      {bankOptions.map((bank) => (
                        <option key={bank} value={bank}>
                          {bank}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
                      ▼
                    </span>
                  </div>
                  {errors?.bankName && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.bankName}</p>}
                </div>

                {/* Account Number */}
                <div className="block">
                  <label className="mb-1.5 block text-sm font-bold text-slate-800 dark:text-slate-200">Account Number</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
                      <FaSave />
                    </span>
                    <input
                      value={profileForm.accountNumber}
                      onChange={(e) => onFieldChange("accountNumber", e.target.value)}
                      className={`w-full rounded-2xl border ${ errors?.accountNumber ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb] dark:border-slate-600" } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition`}
                      placeholder="Account Number"
                    />
                  </div>
                  {errors?.accountNumber && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.accountNumber}</p>}
                </div>

                {/* Address */}
                <div className="block md:col-span-2">
                  <label className="mb-1.5 block text-sm font-bold text-slate-800 dark:text-slate-200">Current Address</label>
                  <div className="relative">
                    <span className="absolute left-4 top-3.5 text-slate-400">
                      <FaMapMarkerAlt />
                    </span>
                    <textarea
                      rows="3"
                      value={profileForm.address}
                      onChange={(e) => onFieldChange("address", e.target.value)}
                      className="w-full rounded-2xl border border-[#ead7bb] dark:border-slate-600 bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition"
                      placeholder="Enter full address"
                    />
                  </div>
                </div>

                {/* Profile Photo Uploader */}
                <div className="block md:col-span-2">
                  <label className="mb-2 block text-sm font-bold text-slate-800 dark:text-slate-200">Profile Photo</label>
                  <div className="flex flex-col sm:flex-row items-center gap-4 rounded-3xl border border-dashed border-[#ead7bb] dark:border-slate-600 bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 p-4">
                    {profileForm.photo ? (
                      <div className="relative">
                        <img
                          src={profileForm.photo}
                          alt="Profile Preview"
                          className="h-20 w-20 rounded-2xl object-cover border border-[#ead7bb] dark:border-slate-600 shadow-sm"
                        />
                        <button
                          type="button"
                          onClick={() => onFieldChange("photo", "")}
                          className="absolute -top-2 -right-2 rounded-full bg-rose-500 p-1 text-white shadow-sm hover:bg-rose-600 transition"
                          title="Remove photo"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-[#ead7bb] dark:border-slate-600 bg-[#fff9ef] dark:bg-[#0f172a] text-slate-400">
                        <FaUserCircle className="text-4xl text-[#f28c18]/70" />
                      </div>
                    )}
                    <div className="flex flex-col gap-1.5 items-center sm:items-start w-full sm:w-auto">
                      <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[#f0c58f] dark:border-slate-700 bg-[#fff9ef] dark:bg-[#0f172a] px-4 py-2.5 text-sm font-bold text-slate-900 dark:text-slate-100 transition hover:bg-[#fff8ef]">
                        <svg className="w-4 h-4 text-[#f28c18]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        {profileForm.photo ? "Change Photo" : "Upload Photo"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = () => {
                                onFieldChange("photo", String(reader.result || ""));
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                      </label>
                      <span className="text-xs text-slate-500 dark:text-slate-400">JPG, PNG or WebP. Max 5MB.</span>
                      {errors?.photo && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.photo}</p>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-3">
                <button
                  type="submit"
                  disabled={savingProfile || loading}
                  className="rounded-2xl bg-[#f28c18] dark:bg-[#0f172a] px-6 py-3.5 text-base font-extrabold text-white transition hover:bg-[#da7b10] disabled:cursor-not-allowed disabled:opacity-70 flex items-center gap-2"
                >
                  <FaSave />
                  {savingProfile ? "Saving Profile..." : "Save Profile Details"}
                </button>
              </div>
            </form>
          </section>

          {/* Admin Managed Details Section */}
          {adminManagedDetails && adminManagedDetails.length > 0 && (
            <section className="rounded-3xl border border-[#f0d3a2] dark:border-slate-700 bg-[#fff9ef] dark:bg-[#0f172a] p-6 shadow-sm transition hover:shadow-md mt-6">
              <div className="flex items-center justify-between border-b border-[#f9ebdf] dark:border-slate-700 pb-4 mb-4">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">Admin Managed Details</h2>
                  <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
                    These values are read-only here and stay in sync with the employee record.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {adminManagedDetails.map((detail, index) => (
                  <div key={index} className="rounded-2xl border border-[#ead7bb] dark:border-slate-600 bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 p-4 flex flex-col">
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{detail.label}</span>
                    <strong className="mt-1 text-sm text-slate-900 dark:text-slate-100">{detail.value}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* PROFILE SNAPSHOT & SECURITY */}
        <div className="space-y-6">
          {/* SNAPSHOT CARD */}
          <div className="rounded-3xl border border-[#f0d3a2] dark:border-slate-700 bg-[#fff9ef] dark:bg-[#0f172a] p-6 shadow-sm transition hover:shadow-md">
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 border-b border-[#f9ebdf] dark:border-slate-700 pb-3">Profile Snapshot</h2>
            <div className="mt-4 rounded-2xl border border-[#ead7bb] dark:border-slate-600 bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 p-4 flex flex-col items-center text-center">
              {profileForm.photo ? (
                <img
                  src={profileForm.photo}
                  alt="Profile"
                  className="h-24 w-24 rounded-full object-cover border-4 border-white shadow-md mb-3"
                />
              ) : (
                <FaUserCircle className="text-7xl text-[#f28c18] mb-3" />
              )}
              <h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-100">{profileForm.name || user?.name || "Employee"}</h3>
              <span className="mt-1 px-3 py-1 rounded-full bg-[#ffe8ca] dark:bg-[#0f172a] text-xs font-extrabold text-[#9c5a00] uppercase tracking-wider">
                {profile?.role || user?.role || "Employee"}
              </span>

              <div className="w-full mt-4 space-y-2.5 text-left text-sm border-t border-[#f3dfc6] dark:border-slate-700 pt-4">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">Email:</span>
                  <span className="text-slate-800 dark:text-slate-200 font-semibold truncate max-w-[180px]" title={profileForm.email}>{profileForm.email || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">Phone:</span>
                  <span className="text-slate-800 dark:text-slate-200 font-semibold">{profileForm.phone || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">Blood Group:</span>
                  <span className="text-rose-600 font-extrabold">{profileForm.bloodGroup || "Not set"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">Member Since:</span>
                  <span className="text-slate-800 dark:text-slate-200 font-semibold">{profile?.memberSince || new Date(profile?.joiningDate || Date.now()).getFullYear()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* PASSWORD SECURITY CARD */}
          <div className="rounded-3xl border border-[#f0d3a2] dark:border-slate-700 bg-[#fff9ef] dark:bg-[#0f172a] p-6 shadow-sm transition hover:shadow-md">
            <div className="flex items-center justify-between border-b border-[#f9ebdf] dark:border-slate-700 pb-3">
              <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">Security</h2>
              <div className="rounded-full bg-[#fff6e6] dark:bg-[#0f172a] p-2 text-[#f28c18]">
                <FaLock className="text-lg" />
              </div>
            </div>

            <form className="mt-4 space-y-4" onSubmit={onChangePassword}>
              <div className="block">
                <label className="mb-1 block text-sm font-bold text-slate-800 dark:text-slate-200">Current Password</label>
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => onPasswordChange("currentPassword", e.target.value)}
                  className="w-full rounded-2xl border border-[#ead7bb] dark:border-slate-600 bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 px-4 py-3 text-base outline-none focus:border-[#f28c18] transition"
                  placeholder="Current password"
                />
              </div>

              <div className="block">
                <label className="mb-1 block text-sm font-bold text-slate-800 dark:text-slate-200">New Password</label>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => onPasswordChange("newPassword", e.target.value)}
                  className="w-full rounded-2xl border border-[#ead7bb] dark:border-slate-600 bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 px-4 py-3 text-base outline-none focus:border-[#f28c18] transition"
                  placeholder="At least 6 characters"
                />
              </div>

              <div className="block">
                <label className="mb-1 block text-sm font-bold text-slate-800 dark:text-slate-200">Confirm New Password</label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => onPasswordChange("confirmPassword", e.target.value)}
                  className="w-full rounded-2xl border border-[#ead7bb] dark:border-slate-600 bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-100 px-4 py-3 text-base outline-none focus:border-[#f28c18] transition"
                  placeholder="Confirm new password"
                />
              </div>

              <button
                type="submit"
                disabled={savingPassword || loading}
                className="w-full rounded-2xl border border-[#f0c58f] dark:border-slate-700 bg-[#fff9ef] dark:bg-[#0f172a] py-3.5 text-base font-extrabold text-slate-900 dark:text-slate-100 transition hover:bg-[#fff8ef] disabled:cursor-not-allowed disabled:opacity-70 flex items-center justify-center gap-2 shadow-sm"
              >
                <FaShieldAlt className="text-[#f28c18]" />
                {savingPassword ? "Updating..." : "Update Security Password"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeProfileView;
