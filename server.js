const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Keep your Render Environment Variable ADMIN_PIN.
// If it is not set, the fallback password is 2026.
const PIN = process.env.ADMIN_PIN || "2026";

const DATA = path.join(__dirname, "auction-data.json");

let state = JSON.parse(fs.readFileSync(DATA, "utf8"));

const save = () => {
  fs.writeFileSync(DATA, JSON.stringify(state, null, 2));
};

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ----------------------------------------------------
// ADMIN CONNECTION CONTROL
// ----------------------------------------------------

let activeAdmin = null;

io.on("connection", (s) => {

  // Send current auction state to every newly connected user
  s.emit("update", state);

  // --------------------------------------------------
  // ADMIN LOGIN
  // --------------------------------------------------

  s.on("login", (pin) => {

    const ok = String(pin) === PIN;

    // Wrong password
    if (!ok) {
      s.emit("login", {
        ok: false,
        message: "Wrong PIN"
      });
      return;
    }

    // If this socket is already the active admin,
    // allow it to continue.
    if (activeAdmin === s.id) {
      s.data.admin = true;

      s.emit("login", {
        ok: true
      });

      return;
    }

    // Prevent another admin from controlling the auction
    if (activeAdmin && activeAdmin !== s.id) {
      s.emit("login", {
        ok: false,
        message: "Another admin is already controlling the auction."
      });

      return;
    }

    // Make this socket the active admin
    activeAdmin = s.id;
    s.data.admin = true;

    s.emit("login", {
      ok: true
    });
  });

  // --------------------------------------------------
  // SELECT PLAYER
  // --------------------------------------------------

  s.on("select", (i) => {

    if (!s.data.admin) return;

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

  // --------------------------------------------------
  // UPDATE LIVE BID
  // --------------------------------------------------

  s.on("bid", (d) => {

    if (!s.data.admin) return;

    const p = state.players[state.current];

    const ti = Number(d.team);

    const a = Math.max(
      200,
      Number(d.amount) || 0
    );

    const t = state.teams[ti];

    // Invalid player/team
    if (!p || p.status !== "pending" || !t) {
      return;
    }

    // Check team budget
    if (a > t.budget - t.spent) {
      return s.emit(
        "errorMsg",
        t.name + " does not have enough points."
      );
    }

    // Update current live bid
    state.liveBid = a;
    state.liveBidTeam = ti;

    save();

    io.emit("update", state);
  });

  // --------------------------------------------------
  // SELL PLAYER
  // --------------------------------------------------

  s.on("sold", (d) => {

    if (!s.data.admin) return;

    const p = state.players[state.current];

    const ti = Number(
      d?.team ?? state.liveBidTeam
    );

    const a = Math.max(
      200,
      Number(d?.amount ?? state.liveBid) || 0
    );

    const t = state.teams[ti];

    // Player does not exist or already sold/unsold
    if (!p || p.status !== "pending") {
      return;
    }

    // No winning team selected
    if (!t) {
      return s.emit(
        "errorMsg",
        "Select a winning team first."
      );
    }

    // Check budget again before final sale
    if (a > t.budget - t.spent) {
      return s.emit(
        "errorMsg",
        "Team does not have enough points."
      );
    }

    // Deduct team points
    t.spent += a;

    // Add player to team's squad
    t.players.push({
      name: p.name,
      amount: a
    });

    // Update player information
    p.status = "sold";
    p.team = t.name;
    p.amount = a;

    // Update current auction information
    state.liveBid = a;
    state.liveBidTeam = ti;

    save();

    io.emit("update", state);
  });

  // --------------------------------------------------
  // UNSOLD PLAYER
  // --------------------------------------------------

  s.on("unsold", () => {

    if (!s.data.admin) return;

    const p = state.players[state.current];

    if (!p || p.status !== "pending") {
      return;
    }

    p.status = "unsold";

    save();

    io.emit("update", state);
  });

  // --------------------------------------------------
  // NEXT PLAYER
  // --------------------------------------------------

  s.on("next", () => {

    if (!s.data.admin) return;

    let n = state.current + 1;

    // Skip players who are already sold/unsold
    while (
      n < state.players.length &&
      state.players[n].status !== "pending"
    ) {
      n++;
    }

    if (n < state.players.length) {

      state.current = n;

      // Reset live bid
      state.liveBid = 200;
      state.liveBidTeam = "";

      save();

      io.emit("update", state);
    }
  });

  // --------------------------------------------------
  // IMPORTANT: ADMIN DISCONNECT FIX
  // --------------------------------------------------

  s.on("disconnect", () => {

    // Only release admin control if the
    // disconnected socket was the active admin.
    if (activeAdmin === s.id) {

      activeAdmin = null;

      console.log(
        "Admin disconnected. Admin control released."
      );
    }
  });

});

// ----------------------------------------------------
// START SERVER
// ----------------------------------------------------

server.listen(PORT, () => {
  console.log(
    "Cricket Auction running on port " + PORT
  );
});
