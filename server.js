const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PIN = process.env.ADMIN_PIN || "1176";
const DATA = path.join(__dirname, "auction-data.json");

// --------------------------------------------------
// AUCTION DATA
// --------------------------------------------------

let state = JSON.parse(fs.readFileSync(DATA, "utf8"));

const save = () => {
  fs.writeFileSync(DATA, JSON.stringify(state, null, 2));
};

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// --------------------------------------------------
// ADMIN SECURITY
// --------------------------------------------------

// Only ONE browser can ever be the Admin at a time.

let adminToken = null;
let adminSocketId = null;

// Generate a secure random token
function createAdminToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Check whether this socket is the authorized Admin
function isAdmin(socket) {
  return (
    socket.data.admin === true &&
    socket.data.adminToken &&
    socket.data.adminToken === adminToken &&
    socket.id === adminSocketId
  );
}

// --------------------------------------------------
// SOCKET CONNECTION
// --------------------------------------------------

io.on("connection", (s) => {

  // Send current auction state
  s.emit("update", state);

  // ------------------------------------------------
  // ADMIN LOGIN / RECONNECT
  // ------------------------------------------------

  s.on("login", (data) => {

    // New frontend sends an object
    // { pin: "...", token: "..." }

    const pin = String(data?.pin || "");
    const suppliedToken = String(data?.token || "");

    // ----------------------------------------------
    // CASE 1:
    // Existing authorized Admin browser reconnecting
    // ----------------------------------------------

    if (
      suppliedToken &&
      adminToken &&
      suppliedToken === adminToken
    ) {

      adminSocketId = s.id;
      s.data.admin = true;
      s.data.adminToken = adminToken;

      s.emit("login", {
        ok: true,
        restored: true,
        token: adminToken
      });

      console.log("Admin session restored:", s.id);

      return;
    }

    // ----------------------------------------------
    // CASE 2:
    // Someone else tries to become Admin
    // ----------------------------------------------

    if (adminToken) {

      s.emit("login", {
        ok: false,
        message:
          "Admin is already locked to the authorized device."
      });

      return;
    }

    // ----------------------------------------------
    // CASE 3:
    // First Admin authorization
    // ----------------------------------------------

    if (pin !== PIN) {

      s.emit("login", {
        ok: false,
        message: "Wrong PIN"
      });

      return;
    }

    // Create permanent Admin token
    adminToken = createAdminToken();

    adminSocketId = s.id;

    s.data.admin = true;
    s.data.adminToken = adminToken;

    s.emit("login", {
      ok: true,
      restored: false,
      token: adminToken
    });

    console.log("New Admin authorized:", s.id);
  });

  // ------------------------------------------------
  // SELECT PLAYER
  // ------------------------------------------------

  s.on("select", (i) => {

    if (!isAdmin(s)) return;

    if (
      Number.isInteger(i) &&
      i >= 0 &&
      i < state.players.length
    ) {

      state.current = i;
      state.liveBid = 200;
      state.liveBidTeam = "";

      save();

      io.emit("update", state);
    }
  });

  // ------------------------------------------------
  // LIVE BID
  // ------------------------------------------------

  s.on("bid", (d) => {

    if (!isAdmin(s)) return;

    const p = state.players[state.current];

    const ti = Number(d?.team);

    const a = Math.max(
      200,
      Number(d?.amount) || 0
    );

    const t = state.teams[ti];

    if (!p || p.status !== "pending" || !t) {
      return;
    }

    if (a > t.budget - t.spent) {

      s.emit(
        "errorMsg",
        t.name + " does not have enough points."
      );

      return;
    }

    state.liveBid = a;
    state.liveBidTeam = ti;

    save();

    io.emit("update", state);
  });

  // ------------------------------------------------
  // SOLD
  // ------------------------------------------------

  s.on("sold", (d) => {

    if (!isAdmin(s)) return;

    const p = state.players[state.current];

    const ti = Number(
      d?.team ?? state.liveBidTeam
    );

    const a = Math.max(
      200,
      Number(d?.amount ?? state.liveBid) || 0
    );

    const t = state.teams[ti];

    if (!p || p.status !== "pending") {
      return;
    }

    if (!t) {

      s.emit(
        "errorMsg",
        "Select a winning team first."
      );

      return;
    }

    if (a > t.budget - t.spent) {

      s.emit(
        "errorMsg",
        "Team does not have enough points."
      );

      return;
    }

    t.spent += a;

    t.players.push({
      name: p.name,
      amount: a
    });

    p.status = "sold";
    p.team = t.name;
    p.amount = a;

    state.liveBid = a;
    state.liveBidTeam = ti;

    save();

    io.emit("update", state);
  });

  // ------------------------------------------------
  // UNSOLD
  // ------------------------------------------------

  s.on("unsold", () => {

    if (!isAdmin(s)) return;

    const p = state.players[state.current];

    if (!p || p.status !== "pending") {
      return;
    }

    p.status = "unsold";

    save();

    io.emit("update", state);
  });

  // ------------------------------------------------
  // NEXT PLAYER
  // ------------------------------------------------

  s.on("next", () => {

    if (!isAdmin(s)) return;

    let n = state.current + 1;

    while (
      n < state.players.length &&
      state.players[n].status !== "pending"
    ) {
      n++;
    }

    if (n < state.players.length) {

      state.current = n;
      state.liveBid = 200;
      state.liveBidTeam = "";

      save();

      io.emit("update", state);
    }
  });

  // ------------------------------------------------
  // DISCONNECT
  // ------------------------------------------------

  s.on("disconnect", () => {

    // IMPORTANT:
    // Do NOT delete adminToken here.
    //
    // This allows the same browser to refresh
    // and reconnect as Admin.

    if (adminSocketId === s.id) {

      console.log(
        "Admin browser disconnected temporarily:",
        s.id
      );

      adminSocketId = null;
    }
  });

});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

server.listen(PORT, () => {

  console.log(
    "Cricket Auction running on port " + PORT
  );

});
