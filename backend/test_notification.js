const mongoose = require("mongoose");
const { createNotification } = require("./src/utils/notificationService");
require("dotenv").config();

async function testNotification() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://soumya:soumya%402002@ac-6rcywmh-shard-00-00.3add7qv.mongodb.net:27017,ac-6rcywmh-shard-00-01.3add7qv.mongodb.net:27017,ac-6rcywmh-shard-00-02.3add7qv.mongodb.net:27017/templebilling?ssl=true&replicaSet=atlas-12p46k-shard-0&authSource=admin&retryWrites=true&w=majority');
    console.log("Connected to MongoDB.");

    const res = await createNotification({
      title: "Test Email Notification",
      message: "This is a test notification to ensure emails are dispatched.",
      audienceEmail: "kulalshiva3.sk@gmail.com",
      audienceRole: "priest",
      category: "duty"
    });

    console.log("Notification created:", res);

    // Wait a moment for async email
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log("Done.");
    process.exit(0);
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

testNotification();
