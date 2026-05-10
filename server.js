require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

// Routes
const authRoutes = require("./routes/auth");
const fileRoutes = require("./routes/fileRoutes");
const chatRoutes = require("./routes/chatRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const commandRoutes = require("./routes/commandRoutes");

const app = express();
app.use(cors());
app.use(express.json());

// Connect Database
connectDB();

// Mount Routes
app.use("/auth", authRoutes);
app.use("/files", fileRoutes); 
app.use("/chat", chatRoutes);  
app.use("/analytics", analyticsRoutes);
app.use("/commands", commandRoutes);

app.use("/", fileRoutes); // For /ingest
app.use("/", chatRoutes); // For /ask
app.use("/", analyticsRoutes); // For /proactive-review, /track-performance

app.listen(5000, () => console.log("🚀 Server on 5000"));
