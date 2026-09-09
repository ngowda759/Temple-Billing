import { useCallback, useEffect, useState } from "react";
import { FiSave } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import {
 changeEmployeePassword,
 getEmployeeProfile,
 updateEmployeeProfile,
} from "../../services/employeeService";
import EmployeeProfileView from "../../components/shared/EmployeeProfileView";
import "../staff/StaffDashboard.css"; // Reuse staff profile CSS

const BLOOD_GROUPS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];
const STAFF_PROFILE_EDITABLE_FIELDS = ["name", "email", "bloodGroup", "dob", "phone", "emergencyContact", "address", "photo", "bankName", "accountNumber"];

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

const buildEditableProfilePayload = (profile = {}) =>
 STAFF_PROFILE_EDITABLE_FIELDS.reduce((payload, field) => {
 payload[field] = profile[field] ?? "";
 return payload;
 }, {});

const getStaffProfileDetails = (profile = {}) => {
 const details = [
 { label: "Role", value: profile.role || "-" },
 { label: "Status", value: profile.status || "-" },
 { label: "Gender", value: profile.gender || "-" },
 { label: "Aadhaar", value: profile.aadhaar || "-" },
 { label: "Joining Date", value: profile.joiningDate ? new Date(profile.joiningDate).toLocaleDateString("en-IN") : "-" },
 { label: "Shift", value: profile.currentDuty?.shift || profile.defaultShift || profile.shift || "-" },
 { label: "Department", value: profile.department || "-" },
 { label: "Employment Type", value: profile.employmentType || "-" },
 { label: "Salary", value: profile.salary || "-" },
 { label: "Veda Shakha", value: profile.vedaShakha || "-" },
 { label: "Specializations", value: profile.specializations?.length ? profile.specializations.join(", ") : "-" },
 { label: "Languages", value: profile.languages?.length ? profile.languages.join(", ") : "-" },
 ];
 return details.filter(d => d.value !== "-" && d.value !== "");
};

const toProfileForm = (profile = {}) => ({
 name: profile.name || "",
 email: profile.email || "",
 role: profile.role || "priest",
 gender: profile.gender || "Male",
 dob: profile.dob || "",
 bloodGroup: profile.bloodGroup || "O+",
 aadhaar: profile.aadhaar || "",
 phone: profile.phone || "",
 emergencyContact: profile.emergencyContact || "",
 address: profile.address || "",
 photo: profile.photo || "",
 bankName: profile.bankName || "",
 accountNumber: profile.accountNumber || "",
});

const PriestProfile = () => {
 const { user, updateUser } = useAuth();
 const priestId = user?.id || user?._id;
 const [profileLoading, setProfileLoading] = useState(false);
 const [profileSaving, setProfileSaving] = useState(false);
 const [passwordSaving, setPasswordSaving] = useState(false);
 const [profileMessage, setProfileMessage] = useState("");
 const [passwordMessage, setPasswordMessage] = useState("");
 const [staff, setStaff] = useState(null);

 const [profileForm, setProfileForm] = useState(toProfileForm());
 const [passwordForm, setPasswordForm] = useState({
 currentPassword: "",
 newPassword: "",
 confirmPassword: "",
 });

 const fetchProfileData = useCallback(async () => {
 if (!priestId) return;
 try {
 setProfileLoading(true);
 setProfileMessage("");
 const response = await getEmployeeProfile(priestId);
 setStaff(response.profile);
 setProfileForm(toProfileForm(response.profile));
 if (response.authUser && updateUser) {
 updateUser(response.authUser);
 }
 } catch (apiError) {
 setProfileMessage(apiError.response?.data?.message || "Failed to load profile details");
 } finally {
 setProfileLoading(false);
 }
 }, [priestId, updateUser]);

 useEffect(() => {
 fetchProfileData();
 }, [fetchProfileData]);

 const handleProfileInputChange = (field, value) => {
 setProfileForm((prev) => ({ ...prev, [field]: value }));
 };

 const handleProfilePhotoChange = (file) => {
 if (!file) {
 setProfileForm((prev) => ({ ...prev, photo: "" }));
 return;
 }

 const reader = new FileReader();
 reader.onload = () => {
 setProfileForm((prev) => ({ ...prev, photo: String(reader.result || "") }));
 };
 reader.readAsDataURL(file);
 };

 const handleProfileSave = async (event) => {
 event.preventDefault();
 if (!profileForm.name.trim() || !profileForm.email.trim()) {
 setProfileMessage("Name and email are required");
 return;
 }
 if (!profileForm.bankName || profileForm.bankName.trim() === "") {
 setProfileMessage("Bank Name is required");
 return;
 }
 const acc = profileForm.accountNumber ? profileForm.accountNumber.trim() : "";
 if (!acc || !/^[0-9]{9,18}$/.test(acc)) {
 setProfileMessage("Valid Account Number (9-18 digits) is required");
 return;
 }

 try {
 setProfileSaving(true);
 setProfileMessage("");
 const response = await updateEmployeeProfile(priestId, buildEditableProfilePayload(profileForm));
 setStaff(response.profile);
 setProfileForm(toProfileForm(response.profile));
 if (response.authUser && updateUser) {
 updateUser(response.authUser);
 }
 setProfileMessage("Profile updated successfully");
 } catch (apiError) {
 setProfileMessage(apiError.response?.data?.message || "Failed to update profile");
 } finally {
 setProfileSaving(false);
 }
 };

 const handlePasswordSave = async (event) => {
 event.preventDefault();
 if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
 setPasswordMessage("Please fill all password fields");
 return;
 }
 if (passwordForm.newPassword.length < 6) {
 setPasswordMessage("New password must be at least 6 characters");
 return;
 }
 if (passwordForm.newPassword !== passwordForm.confirmPassword) {
 setPasswordMessage("New passwords do not match");
 return;
 }

 try {
 setPasswordSaving(true);
 setPasswordMessage("");
 await changeEmployeePassword(priestId, {
 currentPassword: passwordForm.currentPassword,
 newPassword: passwordForm.newPassword,
 });
 setPasswordMessage("Password changed successfully");
 setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
 } catch (apiError) {
 setPasswordMessage(apiError.response?.data?.message || "Failed to change password");
 } finally {
 setPasswordSaving(false);
 }
 };

 return (
 <div className="staff-dashboard-page" style={{ minHeight: "auto", background: "none", padding: 0, width: "100%", display: "block" }}>
 <EmployeeProfileView
 profile={staff}
 user={user}
 profileForm={profileForm}
 passwordForm={passwordForm}
 errors={{}}
 message={profileMessage || passwordMessage}
 messageType={profileMessage === "Profile updated successfully" || passwordMessage === "Password changed successfully" ? "success" : profileMessage || passwordMessage ? "error" : "info"}
 loading={profileLoading}
 savingProfile={profileSaving}
 savingPassword={passwordSaving}
 onFieldChange={handleProfileInputChange}
 onPasswordChange={(field, value) => setPasswordForm((prev) => ({ ...prev, [field]: value }))}
 onSaveProfile={handleProfileSave}
 onChangePassword={handlePasswordSave}
 adminManagedDetails={getStaffProfileDetails(staff || {})}
 />
 </div>
 );
};

export default PriestProfile;
