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

  // =====================
  // Register user
  // =====================
  socket.on("register", (userId) => {
    if (!userId) return;

    // Store user's socket
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    connectedUsers.get(userId).add(socket.id);

    console.log(`🟢 ${userId} registered with socket ${socket.id}`);
    console.log(`Total users online: ${connectedUsers.size}`);

    // Notify ALL connected clients about this user coming online
    // (including the user themselves for consistency)
    io.emit("user_online", { userId });

    // Also send the complete online list to the newly connected user
    const onlineUserIds = Array.from(connectedUsers.keys());
    socket.emit("online_users", { userIds: onlineUserIds });

    // Send current online status to this user for all online users
    // This ensures they see who's already online
    onlineUserIds.forEach((onlineUserId) => {
      if (onlineUserId !== userId) {
        socket.emit("user_online", { userId: onlineUserId });
      }
    });
  });

  // =====================
  // Handle request for online users
  // =====================
  socket.on("request_online_users", () => {
    const onlineUserIds = Array.from(connectedUsers.keys());
    socket.emit("online_users", { userIds: onlineUserIds });
    console.log(`Sent ${onlineUserIds.length} online users on request`);
  });

  // Handle disconnect
  // =====================
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    let userIdToCheck = null;

    // Find which user this socket belonged to
    for (const [userId, sockets] of connectedUsers.entries()) {
      if (sockets.has(socket.id)) {
        sockets.delete(socket.id);
        console.log(`Removed socket ${socket.id} from user ${userId}`);

        // If user has no more sockets connected
        if (sockets.size === 0) {
          connectedUsers.delete(userId);
          userIdToCheck = userId;
          console.log(`User ${userId} is now offline (no more sockets)`);
        }
        break;
      }
    }

    if (userIdToCheck) {
      io.emit("user_offline", { userId: userIdToCheck });
    }

    console.log(`Remaining online users: ${connectedUsers.size}`);
  });

  // =====================
  // Typing indicators
  // =====================
  socket.on("typing", ({ senderId, receiverId }) => {
    if (!senderId || !receiverId) return;

    const receiverSockets = connectedUsers.get(receiverId);
    if (!receiverSockets) return;

    receiverSockets.forEach((socketId) => {
      io.to(socketId).emit("typing", { senderId });
    });
  });

  socket.on("stop_typing", ({ senderId, receiverId }) => {
    if (!senderId || !receiverId) return;

    const receiverSockets = connectedUsers.get(receiverId);
    if (!receiverSockets) return;

    receiverSockets.forEach((socketId) => {
      io.to(socketId).emit("stop_typing", { senderId });
    });
  });

  // =====================
  // Chat messages
  // =====================
  socket.on(
    "send_message",
    ({ senderId, receiverId, content, messageId, createdAt }) => {
      if (!senderId || !receiverId || !content) return;

      const receiverSockets = connectedUsers.get(receiverId);
      if (receiverSockets) {
        receiverSockets.forEach((socketId) => {
          io.to(socketId).emit("receive_message", {
            senderId,
            content,
            messageId,
            createdAt,
          });
        });
      }
    },
  );

  // Chat media (image / voice note)
  socket.on(
    "send_media",
    ({
      senderId,
      receiverId,
      mediaType,
      data,
      filename,
      messageId,
      createdAt,
    }) => {
      if (!senderId || !receiverId || !mediaType) return;

      const receiverSockets = connectedUsers.get(receiverId);
      if (!receiverSockets) return;

      receiverSockets.forEach((socketId) => {
        io.to(socketId).emit("receive_media", {
          senderId,
          mediaType,
          data, // base64 string
          filename, // optional
          messageId,
          createdAt,
        });
      });
    },
  );

  // =====================
  // WebRTC Signaling
  // =====================

  // Caller sends offer
  socket.on("webrtc_offer", ({ receiverId, senderId, offer }) => {
    if (!receiverId || !senderId || !offer) return;

    const sockets = connectedUsers.get(receiverId);
    if (!sockets) return;

    sockets.forEach((socketId) => {
      io.to(socketId).emit("webrtc_offer", {
        senderSocketId: socket.id,
        senderId,
        offer,
      });
    });
  });

  // Receiver sends answer
  socket.on("webrtc_answer", ({ senderSocketId, answer }) => {
    if (!senderSocketId || !answer) return;

    io.to(senderSocketId).emit("webrtc_answer", {
      answer,
      receiverSocketId: socket.id,
    });
  });

  // ICE candidate exchange
  socket.on("webrtc_ice", ({ targetSocketId, candidate }) => {
    if (!targetSocketId || !candidate) return;

    io.to(targetSocketId).emit("webrtc_ice", { candidate });
  });

  // =====================
  // Debug endpoint
  // =====================
  socket.on("debug_status", () => {
    const status = {
      totalUsers: connectedUsers.size,
      connectedUsers: Array.from(connectedUsers.entries()).map(
        ([userId, sockets]) => ({
          userId,
          socketCount: sockets.size,
          socketIds: Array.from(sockets),
        }),
      ),
      socketId: socket.id,
    };
    socket.emit("debug_status_response", status);
  });
});

// REST endpoint to check current online users
app.get("/api/online-users", (req, res) => {
  const onlineUsers = Array.from(connectedUsers.keys());
  res.json({
    success: true,
    onlineUsers,
    count: onlineUsers.length,
  });
});

// =====================
// Example REST notification
// =====================
app.post("/notify/appointment", (req, res) => {
  const { recipientId, message } = req.body;

  const sockets = connectedUsers.get(recipientId);
  if (sockets) {
    sockets.forEach((socketId) => {
      io.to(socketId).emit("notification", { message });
    });
  }

  res.json({ success: true });
});

server.listen(4000, () => {
  console.log("✅ Socket.IO server running on http://localhost:4000");
});
