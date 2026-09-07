import { useState, useRef } from "react";
import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";
import { clearDonationTypes, getDonationTypes, saveDonationTypes } from "../../../services/donationTypeService";

const DonationSettings = () => {
  const [initialTypes, setInitialTypes] = useState(() => getDonationTypes());
  const [types, setTypes] = useState(() => getDonationTypes());
  const [newType, setNewType] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const inputRef = useRef(null);

  const handleAddType = () => {
    setError("");
    setSuccess("");
    const trimmedType = newType.trim();
    if (!trimmedType) {
      const msg = "Please enter donation type.";
      setError(msg);
      alert(msg);
      inputRef.current?.focus();
      return;
    }

    if (types.some((type) => type.toLowerCase() === trimmedType.toLowerCase())) {
      const msg = `Donation type "${trimmedType}" already exists.`;
      setError(msg);
      alert(msg);
      inputRef.current?.focus();
      return;
    }

    const updated = [...types, trimmedType];
    setTypes(updated);
    setNewType("");
    setSuccess(`Donation type "${trimmedType}" added to list. Click 'Save Donation Types' to save.`);
  };

  const handleRemoveType = (typeToRemove) => {
    setTypes((current) => current.filter((type) => type !== typeToRemove));
    setError("");
    setSuccess(`Removed "${typeToRemove}". Click 'Save Donation Types' to apply changes.`);
  };

  const handleSaveSettings = () => {
    setError("");
    setSuccess("");

    const trimmedInput = newType.trim();

    // If user has typed a donation type in the input box, add it and save
    if (trimmedInput) {
      if (types.some((type) => type.toLowerCase() === trimmedInput.toLowerCase())) {
        const msg = `Donation type "${trimmedInput}" already exists.`;
        setError(msg);
        alert(msg);
        inputRef.current?.focus();
        return;
      }
      const updated = [...types, trimmedInput];
      setTypes(updated);
      saveDonationTypes(updated);
      setInitialTypes(updated);
      setNewType("");
      const msg = "Donation types saved successfully.";
      setSuccess(msg);
      alert(msg);
      return;
    }

    // If input is empty, check if any donation type was actually added or modified
    const hasNewAdditions = types.some((type) => !initialTypes.includes(type));
    const isModified = JSON.stringify(types) !== JSON.stringify(initialTypes);

    if (!hasNewAdditions && !isModified) {
      const msg = "No donation type has been added. Please enter a donation type first.";
      setError(msg);
      alert(msg);
      inputRef.current?.focus();
      return;
    }

    // Save the updated donation types list
    saveDonationTypes(types);
    setInitialTypes(types);
    const msg = "Donation types saved successfully.";
    setSuccess(msg);
    alert(msg);
  };

  const handleResetToDefaults = () => {
    if (window.confirm("Are you sure you want to reset donation types to defaults?")) {
      clearDonationTypes();
      const defaults = getDonationTypes();
      setTypes(defaults);
      setInitialTypes(defaults);
      setNewType("");
      setError("");
      setSuccess("Reset to default donation types successfully.");
      alert("Reset to default donation types successfully.");
    }
  };

  return (
    <DonationPageShell
      title="Donation Settings"
      subtitle="Configure categories, receipts, UPI IDs and donation gateway preferences."
      actions={
        <button
          onClick={() => (window.location.href = "/admin/donations")}
          className="rounded-2xl bg-slate-900/90 dark:bg-slate-800 px-5 py-3 font-semibold text-white transition hover:bg-slate-800 dark:hover:bg-slate-700"
        >
          Back to Donations
        </button>
      }
    >
      <SectionCard
        title="Donation Categories"
        subtitle="Create and manage donation types that appear in the Add Donation form."
        className="bg-temple-100 dark:bg-[#0f172a] text-slate-950 dark:text-slate-200 dark:border-slate-700"
      >
        <div className="grid gap-4 md:grid-cols-[1.3fr_0.7fr]">
          <input
            ref={inputRef}
            value={newType}
            onChange={(e) => {
              setNewType(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddType();
              }
            }}
            className={`rounded-3xl border bg-slate-100 dark:bg-[#0b1120] px-4 py-3 text-slate-950 dark:text-slate-200 outline-none transition ${
              error
                ? "border-rose-400 focus:ring-2 focus:ring-rose-400/20"
                : "border-slate-300 dark:border-slate-700 focus:border-amber-400"
            }`}
            placeholder="Add a new donation type"
          />
          <button
            type="button"
            onClick={handleAddType}
            className="rounded-3xl bg-amber-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-amber-300 shadow-sm"
          >
            Add Type
          </button>
        </div>

        {/* Error / Success Feedback Banners */}
        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-rose-400/50 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm font-semibold text-rose-600 dark:text-rose-400">
            <span className="text-base">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-emerald-400/50 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            <span className="text-base">✅</span>
            <span>{success}</span>
          </div>
        )}

        <div className="mt-6 grid gap-3">
          {types.map((type) => (
            <div
              key={type}
              className="flex items-center justify-between rounded-3xl border border-slate-200 dark:border-slate-700/80 bg-slate-100/90 dark:bg-[#0b1120]/80 px-4 py-3 text-slate-950 dark:text-slate-200"
            >
              <span className="font-medium">{type}</span>
              <button
                type="button"
                onClick={() => handleRemoveType(type)}
                className="rounded-full bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 px-3 py-1 text-xs font-bold text-rose-700 dark:text-rose-400 transition hover:bg-rose-100 dark:hover:bg-rose-900/40"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleSaveSettings}
            className="rounded-3xl bg-slate-900 dark:bg-slate-800 border border-slate-700 px-5 py-3 font-semibold text-white dark:text-slate-200 transition hover:bg-slate-800 dark:hover:bg-slate-700 shadow-sm"
          >
            Save Donation Types
          </button>
          <button
            type="button"
            onClick={handleResetToDefaults}
            className="rounded-3xl border border-slate-300 dark:border-slate-700 bg-white/60 dark:bg-slate-900/60 px-5 py-3 text-slate-700 dark:text-slate-400 transition hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200"
          >
            Reset Defaults
          </button>
        </div>
      </SectionCard>
    </DonationPageShell>
  );
};

export default DonationSettings;
