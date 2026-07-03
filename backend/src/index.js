require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const quizRoutes = require("./routes/quizzes");
const publicRoutes = require("./routes/public");
const { registerSocketHandlers } = require("./socket");

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map((o) => o.trim());

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/public", publicRoutes);

// Student flow and results routes get mounted here in later steps:
// app.use("/api/submissions", submissionRoutes);

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: allowedOrigins },
});

// Route handlers (quiz status changes, timer-expiry auto-close) need to emit
// to socket rooms — expose the io instance via app.locals rather than a
// module-level singleton, since it's already scoped per-request via req.app.
app.set("io", io);

registerSocketHandlers(io);

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});