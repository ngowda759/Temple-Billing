require("dotenv").config();
const { getPool } = require("../config/postgres");

const main = async () => {
  try {
    const result = await getPool().query("SELECT 1 AS ok");
    console.log("PostgreSQL connected:", JSON.stringify(result.rows[0]));
    process.exitCode = 0;
  } catch (error) {
    console.error("PostgreSQL connection failed:", error.message);
    process.exitCode = 1;
  } finally {
    await getPool().end().catch(() => {});
  }
};

main();