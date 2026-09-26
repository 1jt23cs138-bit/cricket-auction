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

let state = JSON.parse(fs.readFileSync(DATA, "utf8"));

const save = () => {
  fs.writeFileSync(DATA, JSON.stringify(state, null, 2));
};

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ==================================================
// ADMIN SECURITY
// ==================================================

let adminToken = null;
let adminSocketId = null;

function createAdminToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isAdmin(socket) {
  return (
    socket.data.admin === true &&
    socket.data.adminToken &&
    socket.data.adminToken === adminToken &&
    socket.id === adminSocketId
  );
}

// ==================================================
// LAST SALE / UNDO
// ==================================================

let lastSale = null;

// ==================================================
// SOCKET CONNECTION
// ==================================================

io.on("connection", (s) => {

  s.emit("update", state);

  // ==================================================
  // LOGIN
  // ==================================================

  s.on("login", (data) => {

    const pin = String(data?.pin || "");
    const suppliedToken = String(data?.token || "");

    // Existing Admin browser reconnecting
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

    // Another device trying to become Admin
    if (adminToken) {

      s.emit("login", {
        ok: false,
        message:
          "Admin is already locked to the authorized device."
      });

      return;
    }

    // First Admin login
    if (pin !== PIN) {

      s.emit("login", {
        ok: false,
        message: "Wrong PIN"
      });

      return;
    }

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

  // ==================================================
  // SELECT PLAYER
  // ==================================================

  s.on("select", (i) => {

    if (!isAdmin(s)) return;

    i = Number(i);

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

  // ==================================================
  // LIVE BID
  // ==================================================

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
        `${t.name} does not have enough points.`
      );

      return;
    }

    state.liveBid = a;
    state.liveBidTeam = ti;

    save();

    io.emit("bidAnimation", {
      amount: a,
      team: t.name
    });

    io.emit("update", state);
  });

  // ==================================================
  // SOLD
  // ==================================================

  s.on("sold", (d) => {

    if (!isAdmin(s)) return;

    const playerIndex = state.current;
    const p = state.players[playerIndex];

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

    // Save sale for Undo
    lastSale = {
      playerIndex,
      teamIndex: ti,
      amount: a
    };

    // Update team
    t.spent += a;

    t.players.push({
      name: p.name,
      amount: a
    });

    // Update player
    p.status = "sold";
    p.team = t.name;
    p.amount = a;

    state.liveBid = a;
    state.liveBidTeam = ti;

    save();

    io.emit("soldAnimation", {
      player: p.name,
      team: t.name,
      amount: a
    });

    io.emit("update", state);
  });

  // ==================================================
  // UNSOLD
  // ==================================================

  s.on("unsold", () => {

    if (!isAdmin(s)) return;

    const p = state.players[state.current];

    if (!p || p.status !== "pending") {
      return;
    }

    p.status = "unsold";

    state.liveBid = 200;
    state.liveBidTeam = "";

    save();

    io.emit("unsoldAnimation", {
      player: p.name
    });

    io.emit("update", state);
  });

  // ==================================================
  // NEXT PLAYER
  // ==================================================

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

      io.emit("nextAnimation", {
        player: state.players[n].name
      });

      io.emit("update", state);
    }
  });

  // ==================================================
  // UNDO LAST SALE
  // ==================================================

  s.on("undoSale", () => {

    if (!isAdmin(s)) return;

    if (!lastSale) {

      s.emit(
        "errorMsg",
        "There is no sale available to undo."
      );

      return;
    }

    const playerIndex = lastSale.playerIndex;
    const teamIndex = lastSale.teamIndex;
    const amount = lastSale.amount;

    const p = state.players[playerIndex];
    const t = state.teams[teamIndex];

    if (!p || !t) {

      lastSale = null;

      s.emit(
        "errorMsg",
        "Unable to undo the last sale."
      );

      return;
    }

    const playerPosition =
      t.players.findIndex(player =>
        player.name === p.name &&
        Number(player.amount) === Number(amount)
      );

    if (playerPosition === -1) {

      s.emit(
        "errorMsg",
        "Player was not found in the team squad."
      );

      return;
    }

    // Remove player from squad
    t.players.splice(playerPosition, 1);

    // Return points
    t.spent -= amount;

    if (t.spent < 0) {
      t.spent = 0;
    }

    // Return player to pending
    p.status = "pending";
    p.team = "";
    p.amount = 0;

    // Return to player
    state.current = playerIndex;
    state.liveBid = 200;
    state.liveBidTeam = "";

    lastSale = null;

    save();

    io.emit("update", state);

    s.emit(
      "successMsg",
      "↩️ Last sale has been successfully undone."
    );
  });

  // ==================================================
  // EDIT SOLD PLAYER
  // ==================================================

  s.on("editSale", (data) => {

    if (!isAdmin(s)) return;

    const playerIndex = Number(data?.playerIndex);
    const newTeamIndex = Number(data?.teamIndex);
    const newAmount = Math.max(
      200,
      Number(data?.amount) || 0
    );

    const p = state.players[playerIndex];
    const newTeam = state.teams[newTeamIndex];

    if (!p) {

      s.emit(
        "errorMsg",
        "Player not found."
      );

      return;
    }

    if (p.status !== "sold") {

      s.emit(
        "errorMsg",
        "Only sold players can be edited."
      );

      return;
    }

    if (!newTeam) {

      s.emit(
        "errorMsg",
        "Invalid team selected."
      );

      return;
    }

    // Find player's current team
    const oldTeamIndex = state.teams.findIndex(
      team => team.name === p.team
    );

    if (oldTeamIndex === -1) {

      s.emit(
        "errorMsg",
        "Current team could not be found."
      );

      return;
    }

    const oldTeam = state.teams[oldTeamIndex];

    // Find player inside old team
    const oldPlayerIndex =
      oldTeam.players.findIndex(player =>
        player.name === p.name
      );

    if (oldPlayerIndex === -1) {

      s.emit(
        "errorMsg",
        "Player was not found inside the current team."
      );

      return;
    }

    // ==================================================
    // SAME TEAM
    // ==================================================

    if (oldTeamIndex === newTeamIndex) {

      const difference =
        newAmount - Number(p.amount);

      if (
        difference > 0 &&
        difference > oldTeam.budget - oldTeam.spent
      ) {

        s.emit(
          "errorMsg",
          `${oldTeam.name} does not have enough points.`
        );

        return;
      }

      oldTeam.spent += difference;

      oldTeam.players[oldPlayerIndex].amount =
        newAmount;

      p.amount = newAmount;

    }

    // ==================================================
    // DIFFERENT TEAM
    // ==================================================

    else {

      if (
        newAmount >
        newTeam.budget - newTeam.spent
      ) {

        s.emit(
          "errorMsg",
          `${newTeam.name} does not have enough points.`
        );

        return;
      }

      // Return old team's money
      oldTeam.spent -= Number(p.amount);

      if (oldTeam.spent < 0) {
        oldTeam.spent = 0;
      }

      // Remove from old team
      oldTeam.players.splice(oldPlayerIndex, 1);

      // Add to new team
      newTeam.spent += newAmount;

      newTeam.players.push({
        name: p.name,
        amount: newAmount
      });

      // Update player
      p.team = newTeam.name;
      p.amount = newAmount;
    }

    // Clear undo because sale has now been modified
    lastSale = null;

    save();

    io.emit("update", state);

    s.emit(
      "successMsg",
      "✏️ Player sale updated successfully."
    );
  });

  // ==================================================
  // DISCONNECT
  // ==================================================

  s.on("disconnect", () => {

    if (adminSocketId === s.id) {

      console.log(
        "Admin browser disconnected temporarily:",
        s.id
      );

      adminSocketId = null;
    }
  });

});

// ==================================================
// START SERVER
// ==================================================

server.listen(PORT, () => {

  console.log(
    "Cricket Auction running on port " + PORT
  );

});
