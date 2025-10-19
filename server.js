import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] },
});

// Store connected users (userId => Set of socketIds)
const connectedUsers = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("register", (userId) => {
    if (!userId) return;

    // If user already exists, add new socket to their set
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    connectedUsers.get(userId).add(socket.id);

    console.log(`🟢 ${userId} registered`);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    // Remove socket from user's set
    for (const [userId, sockets] of connectedUsers.entries()) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        connectedUsers.delete(userId);
      }
    }
  });

  // inside io.on("connection")
  // Handle sending messages
  socket.on("send_message", (data) => {
    const { senderId, receiverId, content } = data;

    // forward to recipient if online
    const receiverSockets = connectedUsers.get(receiverId);
    if (receiverSockets && receiverSockets.size > 0) {
      receiverSockets.forEach((id) => {
        io.to(id).emit("receive_message", { senderId, content });
      });
    }

    // echo back to sender so chat UI updates instantly
    const senderSockets = connectedUsers.get(senderId);
    if (senderSockets && senderSockets.size > 0) {
      senderSockets.forEach((id) => {
        io.to(id).emit("message_sent", { receiverId, content });
      });
    }
  });
});

// 🔔 Notify all sockets of a specific user
app.post("/notify/appointment", (req, res) => {
  const { recipientId, message } = req.body;

  const sockets = connectedUsers.get(recipientId);
  if (sockets && sockets.size > 0) {
    sockets.forEach((socketId) => {
      io.to(socketId).emit("notification", { message });
    });
    console.log(`📩 Sent to all sessions of user: ${recipientId}`);
  } else {
    console.log("⚠️ Recipient not connected:", recipientId);
  }

  res.json({ success: true });
});

server.listen(4000, () => {
  console.log("✅ Socket.IO server running on http://localhost:4000");
});
