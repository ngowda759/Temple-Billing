require("dotenv").config();
const app = require("./app");
const { connectDB } = require("./config/db");
const { initPostgres } = require("./config/postgres");
const eventRoutes = require("./routes/eventRoutes");
const PORT = process.env.PORT || 5000;
app.use("/api/events", eventRoutes);
const startServer = async () => {
  const dbConnected = await connectDB();

  await initPostgres();

  if (!dbConnected) {
    console.warn("Starting without MongoDB. Auth will use local file fallback.");
  } else {
    const { syncLedgerBills } = require("./utils/syncService");
    const { seedAccountHeads } = require("./utils/seedAccounts");
    
    await seedAccountHeads().catch((err) => console.error("Account Seeder error:", err));
    await syncLedgerBills().catch((err) => console.error("Sync error:", err));
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();

// Touch to force nodemon restart after changing devotee pooja status to Confirmed directly
