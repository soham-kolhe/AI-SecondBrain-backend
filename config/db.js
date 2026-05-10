const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/second-brain");
    console.log("🍃 MongoDB Connected");
  } catch (err) {
    console.error("Mongo Connection Error:", err);
    process.exit(1);
  }
};

module.exports = connectDB;
