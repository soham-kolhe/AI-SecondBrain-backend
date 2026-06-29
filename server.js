require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");

// Routes
const authRoutes = require("./routes/auth");
const fileRoutes = require("./routes/fileRoutes");
const chatRoutes = require("./routes/chatRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json());

// Connect Database
connectDB();

// Mount Routes
app.use("/auth", authRoutes);
app.use("/files", fileRoutes); 
app.use("/chat", chatRoutes);  
app.use("/analytics", analyticsRoutes);

app.use("/", fileRoutes); // For /ingest
app.use("/", chatRoutes); // For /ask
app.use("/", analyticsRoutes); // For /proactive-review, /track-performance

app.listen(5000, () => console.log("🚀 Server on 5000"));
